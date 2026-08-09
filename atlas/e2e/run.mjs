/**
 * Meridian end-to-end smoke test.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A previous session drove a headless Chrome through the whole app by hand and
 * verified 13 things about it — then threw the harness away in a scratchpad. All
 * of that evidence was lost the moment the session ended. This is that check,
 * committed, so it can be re-run by anyone at any time with `npm run test:e2e`.
 *
 * WHAT IT COVERS
 * --------------
 * The one path that no unit test can cover: a REAL production build, in a REAL
 * browser, writing a REAL journal entry, and then proving the entry is still
 * there after a full page reload. That reload is the whole point — it exercises
 * sql.js (WebAssembly) -> SQLite bytes -> IndexedDB -> sql.js again, which is
 * Meridian's entire durability story and is invisible to jsdom.
 *
 * HOW IT WORKS
 * ------------
 * No new dependencies, deliberately. Node 24's built-in `WebSocket` speaks the
 * Chrome DevTools Protocol directly, `dist/` is served by a ~60-line static file
 * server defined below, and Chrome is whatever Chrome the machine already has.
 * If there is no Chrome, the suite reports SKIPPED and exits 0 — a missing
 * browser is not a test failure.
 *
 * All outbound requests to anything other than our own local server are blocked,
 * so the run behaves identically online and offline (no map tiles, no weather,
 * no reverse-geocoding). The app is expected to degrade gracefully; those
 * failures surface as console *warnings*, which are reported but do not fail.
 */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(HERE, 'screenshots');

/** Hard ceiling on the browser phase, so a wedged page can never hang CI. */
const BROWSER_BUDGET_MS = 180_000;
/** Default per-wait timeout. Every wait carries a label, so a timeout says what. */
const WAIT_MS = 12_000;

/**
 * The phone viewport for the mobile pass (below). 390×844 matches the size
 * MOTION_PLAN.md's own manual-verification checklist already names as the
 * reference phone. Added 2026-08-08 after a real regression — the motion
 * pass's Wave 1 pinned the sidebar drawer permanently open on phones, which
 * made the ☰ Meridian button untappable — shipped past six green runs of this
 * suite because every one of them was desktop-only. See Known Issue #32.
 */
const MOBILE_METRICS = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Chrome discovery
// ---------------------------------------------------------------------------

function chromeCandidates() {
  const local = process.env.LOCALAPPDATA;
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
}

/** An executable name resolvable on PATH, or null. */
function onPath(name) {
  // One shell string rather than (cmd, args, {shell:true}) — the latter is
  // deprecated in Node 24 (DEP0190) and prints a warning on every run.
  return spawnSync(`${name} --version`, { stdio: 'ignore', shell: true }).status === 0 ? name : null;
}

function findChrome() {
  for (const candidate of chromeCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return onPath('chrome') ?? onPath('google-chrome') ?? null;
}

// ---------------------------------------------------------------------------
// Build + static server
// ---------------------------------------------------------------------------

/**
 * Produce dist/. `npm run build` is `tsc -b && vite build`, so a type error in
 * ANY file — including one the bundle never imports — stops it. When that
 * happens we still want the browser evidence, so we fall back to a bundle-only
 * `vite build` and report the typecheck failure as a failed check of its own.
 * The suite therefore never passes on a repo whose real build is broken, but it
 * also never goes silent about the app itself.
 */
function build() {
  const indexExists = () => fs.existsSync(path.join(DIST, 'index.html'));
  if (process.env.E2E_SKIP_BUILD === '1' && indexExists()) {
    console.log('· reusing existing dist/ (E2E_SKIP_BUILD=1)');
    return { ok: true, dist: true, mode: 'reused' };
  }

  const run = (cmd) => spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true }).status === 0;

  console.log('· npm run build');
  if (run('npm run build')) return { ok: true, dist: indexExists(), mode: 'npm run build' };

  console.log('');
  console.log('· npm run build failed (see above). Falling back to a bundle-only');
  console.log('  `vite build` so the browser assertions still run.');
  const bundled = run('npm exec -- vite build');
  return { ok: false, dist: bundled && indexExists(), mode: 'vite build (no typecheck)' };
}

/**
 * Static server for dist/ with an SPA fallback. `.wasm` must come back as
 * `application/wasm` or sql.js refuses to instantiate it — that is the one MIME
 * type this suite would silently break without.
 */
function startServer(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const resolved = path.join(root, path.normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!resolved.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let file = resolved;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const index = path.join(file, 'index.html');
      file = fs.existsSync(index) ? index : path.join(root, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('Not found');
      return;
    }

    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Chrome launch + DevTools Protocol client
// ---------------------------------------------------------------------------

async function launchChrome(exe, userDataDir) {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    // Software WebGL. maplibre-gl needs a working GL context or it throws into
    // the map's ErrorBoundary, which React reports via console.error — a browser
    // artefact that would otherwise read as an app failure.
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1440,1000',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-extensions',
    '--disable-component-update',
    '--no-sandbox',
    'about:blank',
  ];

  const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';

  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Chrome never printed a DevTools endpoint.\n${stderr}`)),
      30_000,
    );
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with code ${code} before starting.\n${stderr}`));
    });
  });

  return { child, endpoint };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => this.dispatch(JSON.parse(ev.data)));
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('DevTools socket closed'));
      this.pending.clear();
    });
  }

  static async connect(endpoint) {
    const ws = new WebSocket(endpoint);
    await once(ws, 'open');
    return new Cdp(ws);
  }

  dispatch(msg) {
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
      else entry.resolve(msg.result);
      return;
    }
    for (const fn of this.handlers.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/**
 * Injected into every evaluated expression:
 *   __vis(el)      — laid out and not hidden by style. Cheap; says nothing about
 *                    clipping, so it is happy with content scrolled out of a
 *                    panel (which is the right answer for "does this exist").
 *   __onscreen(el) — actually reachable by a click, via a hit test. The desktop
 *                    sidebar collapses to `width: 0` with `overflow: hidden`, and
 *                    its children keep their full 340px rects while clipped — so
 *                    only a hit test can tell open from closed.
 *   __btn(label)   — the first <button> whose text contains `label`.
 *   __body()       — visible page text, whitespace-collapsed.
 */
const PRELUDE = `
  const __vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const __onscreen = (el) => {
    if (!__vis(el)) return false;
    const r = el.getBoundingClientRect();
    const l = Math.max(r.left, 0), t = Math.max(r.top, 0);
    const rt = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
    if (rt <= l || b <= t) return false;
    const hit = document.elementFromPoint((l + rt) / 2, (t + b) / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const __btn = (label) => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.replace(/\\s+/g, ' ').trim().includes(label)) || null;
  const __body = () => (document.body.innerText || '').replace(/\\s+/g, ' ');
`;

function makePage(cdp, session) {
  /** Evaluate an EXPRESSION (may be an async IIFE) and return its JSON value. */
  async function evaluate(expression) {
    const res = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(async () => {${PRELUDE}\nreturn (${expression});})()`,
        awaitPromise: true,
        returnByValue: true,
      },
      session,
    );
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`evaluate failed: ${d.exception?.description ?? d.text}`);
    }
    return res.result.value;
  }

  /** Poll `expression` until truthy. Errors count as "not yet" (contexts churn
   *  across a reload); the label is what a timeout message reports. */
  async function waitFor(expression, { timeout = WAIT_MS, label = expression, interval = 120 } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      try {
        last = await evaluate(expression);
        if (last) return last;
      } catch (err) {
        last = err.message;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out after ${timeout}ms waiting for: ${label}` +
          (typeof last === 'string' ? ` (last: ${last})` : ''));
      }
      await sleep(interval);
    }
  }

  async function click(selector) {
    await sleep(20);
    const ok = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      })()`,
    );
    if (!ok) throw new Error(`click: no element matched ${selector}`);
  }

  async function clickButton(label) {
    await sleep(20);
    const ok = await evaluate(
      `(() => { const b = __btn(${JSON.stringify(label)});
        if (!b) return false;
        b.click();
        return true;
      })()`,
    );
    if (!ok) throw new Error(`click: no button labelled "${label}"`);
  }

  /**
   * Type into a control. Plain inputs go through React's own value setter so
   * onChange fires; contenteditable (TipTap/ProseMirror) gets a real
   * Input.insertText, because ProseMirror ignores synthetic input events.
   */
  async function type(selector, text) {
    const kind = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null; el.scrollIntoView({ block: 'center' }); el.focus();
        return el.isContentEditable ? 'contenteditable' : 'input'; })()`,
    );
    if (!kind) throw new Error(`type: no element matched ${selector}`);

    if (kind === 'contenteditable') {
      await cdp.send('Input.insertText', { text }, session);
      return;
    }
    await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value; })()`,
    );
  }

  async function screenshot(name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, session);
    const file = path.join(SHOTS, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  return { evaluate, waitFor, click, clickButton, type, screenshot };
}

// ---------------------------------------------------------------------------
// Assertion bookkeeping
// ---------------------------------------------------------------------------

const results = [];
let counter = 0;
let bailed = null;

/** Run one assertion. `number: 0` is reserved for the pre-flight build check so
 *  the thirteen page assertions keep their own 1..n numbering. */
async function step(label, fn, { critical = false, number } = {}) {
  const n = number ?? ++counter;
  if (bailed) {
    results.push({ n, label, status: 'skip' });
    console.log(`SKIP  ${n}. ${label} — earlier failure: ${bailed}`);
    return;
  }
  try {
    const note = await fn();
    results.push({ n, label, status: 'pass' });
    console.log(`PASS  ${n}. ${label}${note ? ` — ${note}` : ''}`);
  } catch (err) {
    results.push({ n, label, status: 'fail', detail: err.message });
    console.log(`FAIL  ${n}. ${label} — ${err.message}`);
    if (critical) bailed = label;
  }
}

/** Print the tally and exit. Non-zero only when something actually failed. */
function summarise() {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  console.log('');
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

function skipSuite(reason) {
  results.push({ n: 0, label: 'suite', status: 'skip' });
  console.log('');
  console.log(`SKIPPED: ${reason}`);
  summarise();
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

async function main() {
  console.log('Meridian E2E smoke test');
  console.log('');

  const chrome = findChrome();
  if (!chrome) {
    skipSuite(
      'no Chrome found. Set CHROME_PATH to a Chrome/Chromium executable, or install ' +
        'Google Chrome, then re-run `npm run test:e2e`. A missing browser is not a test failure.',
    );
  }
  console.log(`· chrome: ${chrome}`);

  const built = build();
  const BUILD_LABEL = 'the production build succeeds (`npm run build` = tsc -b && vite build)';
  console.log('');
  if (built.mode === 'reused') {
    results.push({ n: 0, label: BUILD_LABEL, status: 'skip' });
    console.log(`SKIP  0. ${BUILD_LABEL} — E2E_SKIP_BUILD=1 reused the existing dist/`);
  } else {
    await step(BUILD_LABEL, () => {
      if (!built.ok) throw new Error(`see the build output above; ran the E2E against ${built.mode}`);
      return built.mode;
    }, { number: 0 });
  }
  if (!built.dist) {
    console.log('');
    console.log('No dist/index.html was produced — there is nothing to serve, so the thirteen');
    console.log('page assertions could not run. Fix the build and re-run.');
    summarise();
  }

  const { server, origin } = await startServer(DIST);
  console.log(`· serving dist/ at ${origin}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-e2e-'));
  let child;
  let cdp;
  let watchdog;

  try {
    const launched = await launchChrome(chrome, userDataDir);
    child = launched.child;
    cdp = await Cdp.connect(launched.endpoint);

    watchdog = setTimeout(() => {
      console.log('');
      console.log(`FATAL: browser phase exceeded ${BROWSER_BUDGET_MS}ms — killing Chrome.`);
      try { cdp?.close(); } catch { /* ignore */ }
      try { child?.kill('SIGKILL'); } catch { /* ignore */ }
      try { server.close(); } catch { /* ignore */ }
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
      process.exit(1);
    }, BROWSER_BUDGET_MS);

    // ---- diagnostics: collected for the WHOLE run, across EVERY page opened
    // (desktop + the mobile pass below) — `sessionIds` is what makes that plural
    // safe: each listener fires for any tracked session, not just the first.
    const sessionIds = new Set();
    const consoleErrors = [];
    const consoleWarnings = [];
    const exceptions = [];
    const blockedHosts = new Set();

    const argText = (a) =>
      a.value !== undefined ? String(a.value) : (a.description ?? a.unserializableValue ?? a.type);

    cdp.on('Runtime.consoleAPICalled', (p, sid) => {
      if (!sessionIds.has(sid)) return;
      const text = (p.args ?? []).map(argText).join(' ');
      if (p.type === 'error' || p.type === 'assert') consoleErrors.push(text);
      else if (p.type === 'warning') consoleWarnings.push(text);
    });
    cdp.on('Runtime.exceptionThrown', (p, sid) => {
      if (!sessionIds.has(sid)) return;
      const d = p.exceptionDetails;
      exceptions.push(d.exception?.description ?? d.text ?? 'unknown exception');
    });

    // Keep the run hermetic: only our own server answers. Everything the app
    // reaches for online (tiles, weather, geocoding) must degrade gracefully.
    cdp.on('Fetch.requestPaused', async (p, sid) => {
      if (!sessionIds.has(sid)) return;
      const url = p.request.url;
      const local = url.startsWith(origin) || /^(data|blob|about|chrome):/.test(url);
      try {
        if (local) {
          await cdp.send('Fetch.continueRequest', { requestId: p.requestId }, sid);
        } else {
          blockedHosts.add(new URL(url).host);
          await cdp.send('Fetch.failRequest',
            { requestId: p.requestId, errorReason: 'BlockedByClient' }, sid);
        }
      } catch {
        // The request was already torn down (navigation); nothing to answer.
      }
    });

    /**
     * Opens a fresh tab at the given device metrics, wired into the same
     * diagnostics above, and returns its `page` helpers. Used once for the
     * desktop pass and again for the mobile pass — same profile/origin (so the
     * mobile pass sees the entry the desktop pass already saved, which is a
     * realistic "existing user, different device" scenario, not a bug).
     */
    async function openPage(metrics) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      sessionIds.add(sessionId);

      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride', metrics, sessionId);

      // The profile is brand new, which the app reads as a first install and covers
      // with its one-time Onboarding overlay. This suite is about the journal path,
      // not the intro, so present as a returning device by seeding the same
      // localStorage key Settings writes. Runs before any page script, on every
      // document (so the reload in assertion 9 is covered too), and never clobbers
      // settings the app itself changed during the run.
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `try {
          if (!localStorage.getItem('meridian_settings')) {
            // The language is seeded explicitly rather than left to the default, so
            // the suite's text assertions can't break if that default ever changes.
            localStorage.setItem('meridian_settings', JSON.stringify({ onboarded: true, language: 'en' }));
          }
        } catch (e) { /* opaque origin (about:blank) */ }`,
      }, sessionId);

      return { sessionId, page: makePage(cdp, sessionId) };
    }

    const { sessionId, page } = await openPage(
      { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    );

    const stamp = Date.now();
    const TITLE = `E2E smoke ${stamp}`;
    const BODY = `Meridian e2e body ${stamp}`;

    const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.navigate', { url: origin }, sessionId);
    await loaded;

    // -- 1 --------------------------------------------------------------------
    await step('page loads and React mounts (real UI, not the boot fallback)', async () => {
      await page.waitFor(
        `(() => {
          if (!window.__meridianBooted) return false;
          if (document.querySelector('.loader-compass')) return false;
          const t = __body();
          if (t.includes('Meridian could not start')) return false;
          if (t.includes('Failed to initialize database')) return false;
          return t.includes('field journal') && !!__btn('New entry');
        })()`,
        { timeout: 30_000, label: 'app mounted (sidebar "field journal" + a New entry button)' },
      );
      return 'compass loader gone, app shell rendered';
    }, { critical: true });

    // -- 2 --------------------------------------------------------------------
    await step('no page exceptions during boot', () => {
      if (exceptions.length) {
        throw new Error(`${exceptions.length} exception(s): ${exceptions.join(' | ').slice(0, 500)}`);
      }
      return 'clean boot';
    });

    // -- 3 --------------------------------------------------------------------
    await step('sql.js WebAssembly initialised and IndexedDB "atlas.db" exists', async () => {
      const info = await page.waitFor(
        `(async () => {
          const wasm = performance.getEntriesByType('resource')
            .filter((r) => r.name.endsWith('.wasm'))
            .map((r) => ({ name: r.name.split('/').pop(), size: r.decodedBodySize || r.transferSize }));
          const dbs = (await indexedDB.databases()).map((d) => d.name);
          const ok = wasm.some((w) => w.size > 0) && dbs.includes('atlas.db');
          return ok ? { wasm, dbs } : false;
        })()`,
        { label: 'a .wasm resource with a real body + the atlas.db IndexedDB database' },
      );
      return `${info.wasm.map((w) => `${w.name} ${w.size}B`).join(', ')}; IndexedDB: ${info.dbs.join(', ')}`;
    });

    // -- 4 --------------------------------------------------------------------
    await step('welcome screen renders its greeting', async () => {
      const greeting = await page.waitFor(
        `(() => {
          const re = /Good morning|Good afternoon|Good evening|Still up/;
          const h = [...document.querySelectorAll('h2')].find((e) => re.test(e.textContent));
          return h && __vis(h) ? h.textContent.match(re)[0] : false;
        })()`,
        { label: 'the welcome hero greeting (Good morning/afternoon/evening/Still up)' },
      );
      await page.screenshot('welcome');
      return `"${greeting}"`;
    });

    // -- 5 --------------------------------------------------------------------
    // Matched case-insensitively: the tab labels come from the i18n catalogue now
    // ("Timeline"), not the raw view id rendered through a `capitalize` class
    // ("timeline"). Case-insensitive keeps this assertion about the tabs EXISTING
    // rather than about their exact casing, which is a styling choice.
    // NOTE: these are the ENGLISH labels. The suite seeds `language: 'en'` along
    // with `onboarded: true` (see the profile seed above) so the UI is predictable;
    // running against a Bengali profile would need the bn catalogue's strings.
    // Desktop's tab row is Timeline / Explore / Data (2026-08-08): Explore
    // replaced the separate Trips and Search tabs, and Home is phone-only —
    // desktop's welcome screen is MainPane's own, not a tab. See `View` in
    // `store/atlas.ts` for the full reasoning.
    const TABS = ['timeline', 'explore', 'data'];
    const tabsVisible = `(() => {
      const want = ${JSON.stringify(TABS)};
      const found = want.filter((w) => [...document.querySelectorAll('button')]
        .some((b) => b.textContent.trim().toLowerCase() === w && __onscreen(b)));
      return found.length === want.length ? found : false;
    })()`;

    await step('sidebar/drawer opens and its navigation tabs are present', async () => {
      // Starts open on a desktop viewport, so close it first to prove the toggle
      // really drives it — the desktop sidebar stays mounted at width 0 when
      // hidden, hence the visibility check rather than a presence check.
      await page.click('button[title="Hide the list"]');
      await page.waitFor(`!(${tabsVisible})`, { label: 'sidebar to collapse after "Hide"' });
      await page.clickButton('Meridian');
      const tabs = await page.waitFor(tabsVisible, {
        label: `all sidebar tabs visible (${TABS.join(', ')})`,
      });
      return `tabs: ${tabs.join(', ')}`;
    });

    // -- 6 --------------------------------------------------------------------
    await step('clicking "New entry" opens the lazy-loaded journal editor', async () => {
      await page.click('button.btn-primary.btn-block');
      await page.waitFor(
        `(() => {
          const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim() === 'New Entry');
          const pm = document.querySelector('.rich-editor .ProseMirror');
          return !!(h && __vis(h) && pm && __vis(pm));
        })()`,
        { timeout: 20_000, label: 'the "New Entry" header + the TipTap .ProseMirror body' },
      );
      return 'editor chunk loaded, ProseMirror mounted';
    }, { critical: true });

    // -- 7 --------------------------------------------------------------------
    await step('typing into the TipTap rich-text body works', async () => {
      await page.type('.rich-editor .ProseMirror', BODY);
      const text = await page.waitFor(
        `(() => {
          const pm = document.querySelector('.rich-editor .ProseMirror');
          return pm && pm.textContent.includes(${JSON.stringify(BODY)}) ? pm.textContent.trim() : false;
        })()`,
        { label: 'the typed text to appear in the ProseMirror document' },
      );
      return `body reads "${text.slice(0, 60)}"`;
    }, { critical: true });

    // -- 8 --------------------------------------------------------------------
    await step('saving closes the editor and the entry appears in the timeline', async () => {
      await page.type('input[placeholder^="Name this entry"]', TITLE);
      await page.waitFor(
        `document.querySelector('input[placeholder^="Name this entry"]').value === ${JSON.stringify(TITLE)}`,
        { label: 'the entry name field to hold the test title' },
      );
      await page.clickButton('Save Entry');
      await page.waitFor(
        `(() => {
          const stillEditing = [...document.querySelectorAll('h2')]
            .some((e) => e.textContent.trim() === 'New Entry' && __vis(e));
          if (stillEditing) return false;
          return __body().includes(${JSON.stringify(TITLE)});
        })()`,
        { label: 'the editor to close and the saved entry to show in the timeline' },
      );
      await page.screenshot('timeline');
      return `entry "${TITLE}" listed`;
    }, { critical: true });

    // -- 9 --------------------------------------------------------------------
    await step('the entry survives a full page reload (SQLite -> IndexedDB -> sql.js)', async () => {
      // saveEvent() debounces its IndexedDB write by 200ms; give it room so the
      // reload is testing durable bytes, not a race.
      await sleep(1500);
      const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
      await cdp.send('Page.reload', { ignoreCache: false }, sessionId);
      await reloaded;

      await page.waitFor(
        `(() => window.__meridianBooted && !document.querySelector('.loader-compass')
          && __body().includes('field journal'))()`,
        { timeout: 30_000, label: 'the app to re-mount after reload' },
      );
      await page.waitFor(`__body().includes(${JSON.stringify(TITLE)})`, {
        timeout: 20_000,
        label: 'the saved entry to be read back out of IndexedDB after reload',
      });

      // Belt and braces: the persisted blob really is a SQLite file, and the
      // typed body text really is inside it.
      const blob = await page.evaluate(
        `(async () => {
          const dbs = await new Promise((res, rej) => {
            const r = indexedDB.open('atlas.db', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('db');
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          const val = await new Promise((res) => {
            const q = dbs.transaction('db', 'readonly').objectStore('db').get('data');
            q.onsuccess = () => res(q.result);
            q.onerror = () => res(null);
          });
          dbs.close();
          if (!val) return null;
          const u8 = new Uint8Array(val);
          let s = '';
          for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
          return { size: u8.length, header: s.slice(0, 15), hasBody: s.includes(${JSON.stringify(BODY)}) };
        })()`,
      );
      if (!blob) throw new Error('nothing stored under atlas.db -> db -> "data"');
      if (blob.header !== 'SQLite format 3') {
        throw new Error(`stored blob is not a SQLite file (header: ${JSON.stringify(blob.header)})`);
      }
      if (!blob.hasBody) throw new Error('the typed body text is not present in the stored SQLite file');
      return `entry re-read after reload; ${blob.size}B SQLite blob contains the body text`;
    });

    // -- 10 -------------------------------------------------------------------
    await step('insights/stats recompute after reload (entry count reflects the save)', async () => {
      const count = await page.waitFor(
        `(() => {
          const label = [...document.querySelectorAll('span')]
            .find((s) => /^(entry|entries)$/.test(s.textContent.trim()) && s.previousElementSibling);
          return label ? label.previousElementSibling.textContent.trim() : false;
        })()`,
        { label: 'the "Your journal" stats card to report an entry count' },
      );
      if (count !== '1') throw new Error(`stats card reports ${count} entries, expected 1`);
      return '📓 1 entry';
    });

    // -- 11 -------------------------------------------------------------------
    await step('settings opens and shows its controls', async () => {
      await page.click('button[aria-label="Settings"]');
      const seen = await page.waitFor(
        `(() => {
          const want = ['About you', 'Display', 'Appearance'];
          const found = want.filter((w) => [...document.querySelectorAll('h3')]
            .some((h) => h.textContent.trim().startsWith(w) && __vis(h)));
          const controls = [...document.querySelectorAll('select, input')].filter(__vis).length;
          return found.length === want.length && controls > 0 ? { found, controls } : false;
        })()`,
        { timeout: 20_000, label: 'the Settings sections (About you / Display / Appearance) + controls' },
      );
      return `${seen.found.join(', ')}; ${seen.controls} visible controls`;
    });

    // -- 12 -------------------------------------------------------------------
    await step('screenshots of the welcome screen and the timeline are written', () => {
      const files = ['welcome', 'timeline'].map((n) => path.join(SHOTS, `${n}.png`));
      for (const f of files) {
        if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
        if (fs.statSync(f).size === 0) throw new Error(`${f} is empty`);
      }
      return files.map((f) => `${path.relative(ROOT, f)} (${fs.statSync(f).size}B)`).join(', ');
    });

    // ---- mobile pass (Known Issue #32; tab bar checks added for P1) ---------
    // Everything below runs at a 390×844 phone viewport, on a FRESH tab of the
    // same profile/origin (so it sees the entry the desktop pass already
    // saved — a realistic "same journal, different device" state, not a bug).
    // Wired into the same diagnostics as the desktop pass via `sessionIds`.
    //
    // MOTION_PLAN.md Part II (P1) replaced the phone drawer + ☰ Meridian button
    // with a persistent bottom tab bar (`BottomTabBar.tsx`) — the assertions
    // below replace the old drawer-open/close checks with the equivalent for
    // the new navigation, in the same spirit: a real coordinate hit-test
    // (`__onscreen`, via `elementFromPoint`), not just a visibility check,
    // since that's the only thing that would have caught the Presence
    // stacking-context bug this file's history already ran into twice.
    // Scoped to `[role="tablist"] button[role="tab"]` rather than a plain text
    // search, because the DESKTOP sidebar's own (CSS-hidden-on-phone) tab row
    // renders EARLIER in the DOM and would otherwise shadow a same-labelled
    // lookup — `.click()` doesn't care about visibility, so a naive text-based
    // click could silently fire the wrong tab's handler.
    const MOBILE_TABS = ['home', 'timeline', 'explore', 'data', 'settings'];
    const mobileTabsVisible = `(() => {
      const want = ${JSON.stringify(MOBILE_TABS)};
      const tabs = [...document.querySelectorAll('[role="tablist"] button[role="tab"]')];
      const found = want.filter((w) => tabs.some((b) =>
        b.textContent.trim().toLowerCase().includes(w) && __onscreen(b)));
      return found.length === want.length ? found : false;
    })()`;

    async function clickTab(mobilePage, label) {
      const ok = await mobilePage.evaluate(
        `(() => { const tabs = [...document.querySelectorAll('[role="tablist"] button[role="tab"]')];
          const b = tabs.find((x) => x.textContent.trim().toLowerCase().includes(${JSON.stringify(label)}));
          if (!b) return false; b.click(); return true; })()`,
      );
      if (!ok) throw new Error(`no bottom tab labelled "${label}"`);
    }

    const mobile = await openPage(MOBILE_METRICS);
    const mobileLoaded = new Promise((resolve) => {
      cdp.on('Page.loadEventFired', (p, sid) => { if (sid === mobile.sessionId) resolve(); });
    });
    await cdp.send('Page.navigate', { url: origin }, mobile.sessionId);
    await mobileLoaded;

    await mobile.page.waitFor(
      `(() => window.__meridianBooted && !document.querySelector('.loader-compass')
        && __body().includes('field journal'))()`,
      { timeout: 30_000, label: 'the app to mount at the phone viewport' },
    );

    // -- 13 -------------------------------------------------------------------
    await step('phone viewport: the bottom tab bar is tap-reachable from the start', async () => {
      const tabs = await mobile.page.waitFor(mobileTabsVisible, {
        label: `all 5 bottom tabs to be tap-reachable (${MOBILE_TABS.join(', ')})`,
      });
      await mobile.page.screenshot('mobile-closed');
      return `tabs: ${tabs.join(', ')}`;
    }, { critical: true });

    // -- 14 -------------------------------------------------------------------
    await step('phone viewport: tapping a tab switches the visible pane (Settings)', async () => {
      await clickTab(mobile.page, 'settings');
      const seen = await mobile.page.waitFor(
        `(() => {
          const want = ['About you', 'Display', 'Appearance'];
          const found = want.filter((w) => [...document.querySelectorAll('h3')]
            .some((h) => h.textContent.trim().startsWith(w) && __vis(h)));
          return found.length === want.length ? found : false;
        })()`,
        { timeout: 20_000, label: 'the Settings sections to show after tapping the Settings tab' },
      );
      await mobile.page.screenshot('mobile-open');
      return `sections: ${seen.join(', ')}`;
    }, { critical: true });

    // -- 15 -------------------------------------------------------------------
    // Deliberately does NOT open a lazy-loaded detail view (EventCard,
    // JournalEditor, …) to test the tab bar's "closes whatever's open" side —
    // a control test found that NO `React.lazy()` chunk resolves on this
    // harness's second (mobile) CDP tab at all (confirmed with JournalEditor,
    // untouched by P1 — so it's a pre-existing dual-tab/service-worker
    // limitation of this harness, not a regression). `navigateTab`'s own
    // clearing logic (including the `mapExpanded` fix this test caught — it
    // was NOT being cleared before) is unit-tested directly in
    // `store/atlas.test.ts`, which needs no browser. What a real browser is
    // for is the map FAB itself: a NEW `<Presence>`-wrapped, absolutely
    // positioned, z-indexed tap target (App.tsx) — exactly the shape that
    // caused the ☰ Meridian stacking-context bug twice — so this checks ITS
    // tap-reachability and that tapping a tab dismisses it, using only the
    // `mapExpanded` flag (no chunk needs to finish loading for that to show).
    await step('phone viewport: the map FAB is tap-reachable, and tapping a tab dismisses the expanded map', async () => {
      const FAB = `document.querySelector('button[aria-label="Open the map"]')`;
      await clickTab(mobile.page, 'timeline');
      const fabReachable = await mobile.page.waitFor(
        `(() => { const b = ${FAB}; return !!b && __onscreen(b); })()`,
        { label: 'the mobile map FAB to be tap-reachable' },
      );
      if (!fabReachable) throw new Error('map FAB did not become tap-reachable');

      await mobile.page.click('button[aria-label="Open the map"]');
      await mobile.page.waitFor(
        `(() => { const b = ${FAB}; return !b || !__onscreen(b); })()`,
        { label: 'the map FAB to disappear once the map expands (mobileDetailOpen, App.tsx)' },
      );

      await clickTab(mobile.page, 'timeline');
      const fabBack = await mobile.page.waitFor(
        `(() => { const b = ${FAB}; return !!b && __onscreen(b); })()`,
        { label: 'the map FAB to be tap-reachable again after tapping the tab dismisses the map' },
      );
      if (!fabBack) throw new Error('map FAB did not return after dismissing the map via a tab tap');
      const tabs = await mobile.page.waitFor(mobileTabsVisible, {
        label: 'the tab bar to still be tap-reachable throughout',
      });
      return `FAB dismisses the map and reappears; tabs: ${tabs.join(', ')}`;
    }, { critical: true });

    // -- 16 -------------------------------------------------------------------
    await step('phone viewport: the capture FAB is tap-reachable, and expanding speed dial shows Photo and Voice options', async () => {
      const captureReachable = await mobile.page.waitFor(
        `(() => { const b = __btn('Write'); return !!b && __onscreen(b); })()`,
        { label: 'the mobile capture FAB to be tap-reachable' },
      );
      if (!captureReachable) throw new Error('capture FAB did not become tap-reachable');

      await mobile.page.click('button[aria-label="Quick capture"]');
      const speedDialSeen = await mobile.page.waitFor(
        `(() => {
          const photo = __btn('Photo');
          const voice = __btn('Voice Note');
          return photo && voice && __onscreen(photo) && __onscreen(voice);
        })()`,
        { label: 'Photo and Voice speed dial buttons to be tap-reachable when expanded' },
      );
      if (!speedDialSeen) throw new Error('speed dial buttons were not tap-reachable');

      return 'Write button tap-reachable; speed dial expands Photo & Voice Note options';
    }, { critical: true });

    // -- 17 -------------------------------------------------------------------
    await step('phone viewport: left-edge swipe back zone is active when detail surface opens', async () => {
      await mobile.page.clickButton('Write');
      const edgeZone = await mobile.page.waitFor(
        `(() => { const el = document.querySelector('div[aria-label="Swipe back edge"]'); return !!el; })()`,
        { label: 'the left-edge swipe back touch target zone to be mounted when detail opens' },
      );
      if (!edgeZone) throw new Error('swipe back edge zone was not mounted');
      await clickTab(mobile.page, 'timeline');
      return 'Swipe back edge zone mounted on detail surface open';
    }, { critical: true });

    // -- 18 -------------------------------------------------------------------
    await step('no page exceptions or console errors for the whole run', () => {
      const problems = [
        ...exceptions.map((e) => `exception: ${e}`),
        ...consoleErrors.map((e) => `console.error: ${e}`),
      ];
      if (problems.length) throw new Error(problems.join(' | ').slice(0, 1200));
      return 'clean';
    });

    // ---- diagnostics report -------------------------------------------------
    console.log('');
    if (blockedHosts.size) {
      console.log(`· blocked external hosts (run is hermetic): ${[...blockedHosts].sort().join(', ')}`);
    }
    if (exceptions.length) {
      console.log(`· page exceptions (${exceptions.length}):`);
      for (const e of exceptions) console.log(`    ! ${e.split('\n')[0]}`);
    }
    if (consoleErrors.length) {
      console.log(`· console errors (${consoleErrors.length}):`);
      for (const e of consoleErrors) console.log(`    ! ${e.split('\n')[0]}`);
    }
    if (consoleWarnings.length) {
      console.log(`· console warnings (${consoleWarnings.length}, reported only):`);
      for (const w of consoleWarnings) console.log(`    ~ ${w.split('\n')[0]}`);
    }
  } finally {
    clearTimeout(watchdog);
    cdp?.close();
    if (child) {
      child.kill();
      // Give Chrome a moment to release the profile directory before removing it.
      await Promise.race([once(child, 'exit'), sleep(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the profile briefly; a temp dir left behind is harmless.
    }
  }

  summarise();
}

main().catch((err) => {
  console.error('');
  console.error(`FATAL: ${err.stack ?? err.message}`);
  process.exit(1);
});
