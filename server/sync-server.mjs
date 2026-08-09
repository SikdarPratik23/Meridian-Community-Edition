// Meridian local sync server — a tiny, zero-dependency store for the shared
// journal file. Your PC runs this; the phone (and the PC's browser) sync to it
// over your local WiFi network. No third-party software required.
//
// It holds ONE JSON file and offers read/write/meta.
// All the merge + photo-trim intelligence lives in the app (src/data/sync.ts);
// this server is just the rendezvous point.
//
// Run:   node sync-server.mjs            (defaults: port 8787, ./data/meridian-journal.json)
// Env:   PORT, DATA_FILE, SYNC_TOKEN     (SYNC_TOKEN optional)

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveDataFile } from './data-location.mjs';

const PORT = Number(process.env.PORT || 8787);
// Where the shared journal lives — your chosen folder (see data-location.mjs),
// or ./data by default. Change it any time with "Choose Data Folder.bat".
const DATA_FILE = resolveDataFile();
// Full-resolution photo originals live here, next to the journal, one file per
// attachment id. The app syncs only downscaled copies; the PC keeps the originals
// and serves them on demand (GET /media/<id>). See atlas/src/data/media.ts.
const MEDIA_DIR = join(dirname(DATA_FILE), 'media');
const TOKEN = process.env.SYNC_TOKEN || '';

const EMPTY = '{"version":1,"devices":{"pc":"","phone":""},"entries":[]}';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, code, obj) {
  cors(res);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(JSON.stringify(obj));
}

function authed(req) {
  if (!TOKEN) return true;
  return req.headers['authorization'] === `Bearer ${TOKEN}`;
}

/** Modified time of the data file in epoch ms, or 0 if it doesn't exist yet. */
async function modifiedMs() {
  try {
    return Math.floor((await stat(DATA_FILE)).mtimeMs);
  } catch {
    return 0;
  }
}

async function readData() {
  try {
    return await readFile(DATA_FILE, 'utf8');
  } catch {
    return EMPTY; // first run — present an empty sync file
  }
}

// Serialize journal writes. The journal is a SINGLE shared file, and several
// devices may PUT /sync at the same moment. Without serialization they'd race on
// the temp file and the rename (on Windows this rejected ~80% of concurrent
// writes). Each write now waits its turn; the last one in wins and clients
// re-merge on their next sync, so nothing is lost — just ordered.
let _writeLock = Promise.resolve();
let _tmpSeq = 0;

function writeData(text) {
  const run = async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    // Unique temp name per write (never a shared path), then atomic rename so a
    // crash mid-write can't corrupt the journal.
    const tmp = `${DATA_FILE}.${process.pid}.${_tmpSeq++}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, DATA_FILE);
  };
  const result = _writeLock.then(run, run); // run even if the previous write threw
  _writeLock = result.catch(() => {}); // keep the chain alive across failures
  return result;
}

// Max request body. Generous so a real journal with hundreds of downscaled
// photos still syncs (each PUT /sync currently carries the whole file). Photo
// ORIGINALS go through /media, not here.
const MAX_BODY = 256 * 1024 * 1024;

function readBody(req, limitBytes = MAX_BODY) {
  return readBodyBuffer(req, limitBytes).then((buf) => buf.toString('utf8'));
}

/** Like readBody, but returns the raw bytes (for binary media uploads). */
function readBodyBuffer(req, limitBytes = MAX_BODY) {
  return new Promise((res, rej) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { rej(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

/** Store/serve a full-resolution photo original, keyed by its attachment id. */
async function handleMedia(req, res, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) { json(res, 400, { error: 'Bad media id' }); return; }
  const binPath = join(MEDIA_DIR, `${id}.bin`);
  const typePath = join(MEDIA_DIR, `${id}.type`);

  if (req.method === 'PUT') {
    try {
      const buf = await readBodyBuffer(req);
      await mkdir(MEDIA_DIR, { recursive: true });
      const tmp = `${binPath}.tmp`;
      await writeFile(tmp, buf);
      await rename(tmp, binPath); // atomic, so a crash mid-write can't corrupt it
      await writeFile(typePath, String(req.headers['content-type'] || 'application/octet-stream'), 'utf8');
      json(res, 200, { ok: true, size: buf.length });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const info = await stat(binPath); // throws → 404 below
      const mime = await readFile(typePath, 'utf8').catch(() => 'application/octet-stream');
      cors(res);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
      res.writeHead(200);
      res.end(await readFile(binPath));
    } catch {
      json(res, 404, { error: 'Original not found' });
    }
    return;
  }

  json(res, 405, { error: 'Method not allowed' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (path === '/health') { json(res, 200, { ok: true, name: 'meridian-sync' }); return; }

  if (!authed(req)) { json(res, 401, { error: 'Unauthorized' }); return; }

  if (path.startsWith('/media/')) {
    await handleMedia(req, res, decodeURIComponent(path.slice('/media/'.length)));
    return;
  }

  if (path === '/meta' && req.method === 'GET') {
    json(res, 200, { modifiedTime: await modifiedMs() });
    return;
  }

  if (path === '/sync') {
    if (req.method === 'GET') {
      const text = await readData();
      cors(res);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Modified-Time', String(await modifiedMs()));
      res.writeHead(200);
      res.end(text);
      return;
    }
    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        JSON.parse(body); // reject anything that isn't valid JSON
        await writeData(body);
        json(res, 200, { ok: true, modifiedTime: await modifiedMs() });
      } catch (e) {
        json(res, 400, { error: e.message });
      }
      return;
    }
  }

  json(res, 404, { error: 'Not found' });
});

// The dev server that serves the Meridian app itself (vite) runs on this port.
// We print it next to the sync port so the phone user gets both the "open the
// app" address and the "sync to" address from one place.
const APP_PORT = Number(process.env.APP_PORT || 5173);

/** Is this a Tailscale address? Tailscale hands out IPs in 100.64.0.0/10. */
function isTailscale(ip) {
  const p = ip.split('.').map(Number);
  return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

/**
 * This PC's Tailscale MagicDNS hostname (e.g. "your-pc.tailXXXX.ts.net"), read
 * best-effort from the Tailscale CLI. Returns null if Tailscale isn't installed
 * or signed in — the caller then just shows the raw 100.x address instead. Used
 * to print the HTTPS URL that `tailscale serve` exposes for the online/installed
 * (https) app.
 */
function tailscaleDnsName() {
  const bins = process.platform === 'win32'
    ? ['C:\\Program Files\\Tailscale\\tailscale.exe', 'tailscale']
    : ['tailscale'];
  for (const bin of bins) {
    try {
      const out = execFileSync(bin, ['status', '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
      });
      const name = JSON.parse(out)?.Self?.DNSName;
      if (name) return String(name).replace(/\.$/, ''); // drop trailing dot
    } catch {
      // not this binary / not running / not signed in — try the next, else null
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  // Sort this PC's addresses into "same WiFi" (private LAN) and "anywhere"
  // (Tailscale), so we can tell the user exactly which to use and when.
  const lanIps = [];
  const tsIps = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        (isTailscale(net.address) ? tsIps : lanIps).push(net.address);
      }
    }
  }

  const line = '  ' + '-'.repeat(58);
  console.log('');
  console.log('  Meridian Sync Server  --  running. Keep this window open.');
  console.log('  ==========================================================');
  console.log(`  Your journal is stored on THIS PC, here:`);
  console.log(`    ${DATA_FILE}`);
  console.log('  (To move it, run "Choose Data Folder.bat".)');
  console.log('');
  const lan = lanIps[0];
  const ts = tsIps[0];
  const tsHost = ts ? tailscaleDnsName() : null;      // e.g. your-pc.tailXXXX.ts.net
  const tsHttps = tsHost ? `https://${tsHost}` : null; // what "tailscale serve" exposes

  // The address to suggest as the phone's PRIMARY (for "away"): the Tailscale
  // HTTPS URL if we have it, else the raw Tailscale IP, else just the LAN.
  const primary = tsHttps || (ts ? `http://${ts}:${PORT}` : (lan ? `http://${lan}:${PORT}` : ''));
  const fallback = (primary && lan && !primary.includes(lan)) ? `http://${lan}:${PORT}` : '';

  console.log('  EVERY ADDRESS FOR THIS PC');
  console.log('  (app = open in the browser · sync = server address in the app)');
  console.log(line);
  console.log('');
  console.log('  On THIS PC (nothing to set up):');
  console.log(`      app:   http://localhost:${APP_PORT}`);
  console.log(`      sync:  http://localhost:${PORT}   (used automatically)`);
  console.log('');
  if (lan) {
    console.log('  Same WiFi as this PC (no Tailscale needed):');
    console.log(`      app:   http://${lan}:${APP_PORT}`);
    console.log(`      sync:  http://${lan}:${PORT}`);
    if (lanIps.length > 1) {
      console.log(`      (other WiFi addresses: ${lanIps.slice(1).join(', ')})`);
    }
    console.log('');
  }
  if (ts) {
    console.log('  Away, over Tailscale (turn Tailscale ON on both devices):');
    console.log(`      app:   http://${ts}:${APP_PORT}`);
    console.log(`      sync:  http://${ts}:${PORT}`);
    if (tsHttps) {
      console.log('      For the online / installed (https) app, use the secure URL');
      console.log('      (needs "Start Sync Server (Internet).bat"):');
      console.log(`      sync:  ${tsHttps}`);
    }
    console.log('');
  } else {
    console.log('  Away from home: set up Tailscale once (see');
    console.log('  server\\TAILSCALE-SETUP.md) and an "away" address appears here.');
    console.log('');
  }

  console.log(line);
  console.log('  SET IT UP ONCE ON YOUR PHONE (works home AND away):');
  console.log('');
  console.log('      1) Open the app over http (NOT https) so the same-WiFi');
  console.log(`         fallback is allowed:  http://${lan || 'localhost'}:${APP_PORT}`);
  console.log('      2) Data -> Sync -> set role to "Phone"');
  console.log('      3) Enter your address(es) -- the app uses whichever is live:');
  if (primary) console.log(`           Primary address:               ${primary}`);
  if (fallback) console.log(`           Same-WiFi address (fallback):  ${fallback}`);
  else console.log('           Same-WiFi address (fallback):  (leave blank)');
  console.log('      4) Tap Connect, then tick Auto-sync. Done.');
  console.log('');
  console.log('  The app tries the primary first and drops to the same-WiFi');
  console.log('  address on its own -- so you never edit this again when you move');
  console.log('  between home and away. No Tailscale? Use the same-WiFi address as');
  console.log('  the primary and leave the fallback blank.');
  console.log('');
  console.log('  Press Ctrl+C to stop syncing.');
  console.log('');
});
