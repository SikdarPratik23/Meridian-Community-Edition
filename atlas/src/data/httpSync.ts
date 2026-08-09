import {
  type SyncTransport, setActiveTransport, fileTransport,
} from './sync';
import { useSyncLink } from './fileLink';
import { flushPendingUploads } from './media';

/**
 * HTTP transport: talks to the tiny Node sync server running on the PC
 * (see /server/sync-server.mjs). Works on the phone too as long as both devices
 * are on the same WiFi network — the phone uses the PC's LAN IP address.
 *
 * Two addresses are supported: a PRIMARY (typically the Tailscale HTTPS URL, so
 * it reaches the PC from anywhere) and an optional FALLBACK (the same-WiFi LAN
 * address, e.g. http://192.168.x.x:8787). Every request tries the primary first
 * and drops to the fallback automatically when the primary can't be reached —
 * so leaving home / a Tailscale hiccup silently switches to the local network
 * and back without touching settings. The last address that worked is preferred
 * for the next request to avoid a wasted round-trip.
 *
 * Caveat (browser rule, not ours): a page loaded over HTTPS (e.g. the Vercel
 * build) may NOT call an http:// address — "mixed content" is blocked. So an
 * http LAN fallback only actually connects when Meridian itself is opened over
 * http (i.e. from the PC's local address). Tailscale's URL is https, so it works
 * from either origin.
 *
 * The syncPass logic in sync.ts runs unchanged on top of this.
 */

const URL_KEY = 'meridian_http_url';
const URL_FALLBACK_KEY = 'meridian_http_url_fallback';
const TOKEN_KEY = 'meridian_http_token';

const cleanUrl = (url: string) => url.trim().replace(/\/+$/, '');

export function getServerUrl(): string {
  return localStorage.getItem(URL_KEY) || '';
}
export function setServerUrl(url: string): void {
  // Store without a trailing slash so path-joins stay clean.
  localStorage.setItem(URL_KEY, cleanUrl(url));
}
/** Optional same-WiFi (LAN) address used when the primary is unreachable. */
export function getServerUrlFallback(): string {
  return localStorage.getItem(URL_FALLBACK_KEY) || '';
}
export function setServerUrlFallback(url: string): void {
  localStorage.setItem(URL_FALLBACK_KEY, cleanUrl(url));
}
export function getServerToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setServerToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

let connected = false;
// The address that last responded, tried first next time (primary or fallback).
let activeBase: string | null = null;

function headers(extra: Record<string, string> = {}): HeadersInit {
  const token = getServerToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** Configured addresses to try, in order: last-good first, then primary, then fallback. */
function candidateBases(): string[] {
  const primary = getServerUrl();
  const fallback = getServerUrlFallback();
  const list: string[] = [];
  for (const b of [activeBase, primary, fallback]) {
    if (b && !list.includes(b)) list.push(b);
  }
  return list;
}

/**
 * Fetch `path` from the first reachable configured address. A server that
 * answers at all (any HTTP status) counts as reachable and becomes `activeBase`;
 * only a network-level failure (unreachable / DNS / blocked) falls through to
 * the next address. Throws if none respond.
 */
async function fetchBase(path: string, init?: RequestInit): Promise<Response> {
  const bases = candidateBases();
  if (!bases.length) throw new Error('No server address configured.');
  let lastErr: unknown;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, init);
      activeBase = base; // reachable — prefer it next time
      return res;
    } catch (e) {
      lastErr = e;
      if (activeBase === base) activeBase = null; // this one just went away
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('No reachable server address.');
}

export const httpTransport: SyncTransport = {
  label: () => 'Local server',
  isReady: () => connected && candidateBases().length > 0,
  read: async () => {
    try {
      const res = await fetchBase('/sync', { headers: headers() });
      if (!res.ok) throw new Error(`Server read failed (${res.status}).`);
      return await res.text();
    } catch (e) {
      useSyncLink.getState().set({ error: (e as Error).message });
      return null;
    }
  },
  write: async (text) => {
    try {
      const res = await fetchBase('/sync', {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: text,
      });
      if (!res.ok) throw new Error(`Server write failed (${res.status}).`);
      return true;
    } catch (e) {
      useSyncLink.getState().set({ error: (e as Error).message });
      return false;
    }
  },
  modifiedAt: async () => {
    try {
      const res = await fetchBase('/meta', { headers: headers() });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.modifiedTime === 'number' ? data.modifiedTime : null;
    } catch {
      return null;
    }
  },
  // The server is the warehouse (keeps full data incl. photos as a backup) —
  // don't strip photo bytes from what we send it.
  trims: false,
};

/**
 * Explain a connect failure in plain language — and catch the #1 gotcha: a page
 * served over https CANNOT call an http:// address. The browser blocks it as
 * "mixed content", which otherwise surfaces only as a cryptic "Load failed". We
 * detect that from the page protocol + configured addresses and say exactly what
 * to do, rather than leaving the user guessing.
 */
function connectErrorMessage(err: Error): string {
  const bases = candidateBases();
  const pageHttps = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const httpBase = bases.find((b) => b.toLowerCase().startsWith('http://'));
  const hasHttps = bases.some((b) => b.toLowerCase().startsWith('https://'));

  // Page is https and the ONLY address is http → it can never connect from here.
  if (pageHttps && httpBase && !hasHttps) {
    return `This app is open over https, and browsers block an https page from calling an http address `
      + `(${httpBase}) — that's the "Load failed", not a server problem. Fix: open Meridian over http on `
      + `the same WiFi (e.g. http://192.168.x.x:5173) to use the LAN address, or set your Tailscale `
      + `https:// address as the primary.`;
  }
  // Page is https, an https primary AND an http fallback are set, and both failed:
  // the https one is genuinely unreachable, and the http fallback is mixed-content-blocked.
  if (pageHttps && httpBase && hasHttps) {
    return `Couldn't connect. The https address wasn't reachable — is the sync server running on the PC `
      + `(use the Tailscale/"Internet" launcher for the https address)? — and the http fallback (${httpBase}) `
      + `can't be used from this https app (browser mixed-content block). Fix: start the server, or open `
      + `Meridian over http on the same WiFi to use the LAN address directly.`;
  }
  return `Couldn't reach the server at ${bases.join(' or ')}. ${err.message}`;
}

/**
 * Connect to the local server: verify one of the configured addresses is
 * reachable (/health), then make it the active sync transport. `fallback` is the
 * optional same-WiFi (LAN) address tried when the primary can't be reached.
 * Returns false (with a message in the store) on failure.
 */
export async function connectHttp(url: string, token: string, fallback = ''): Promise<boolean> {
  setServerUrl(url);
  setServerUrlFallback(fallback);
  setServerToken(token);
  activeBase = null; // re-probe from scratch on an explicit connect
  if (!candidateBases().length) {
    useSyncLink.getState().set({ error: 'Enter the server address first.' });
    return false;
  }
  try {
    const res = await fetchBase('/health', { headers: headers() });
    if (!res.ok) throw new Error(`Server responded ${res.status}.`);
    connected = true;
    setActiveTransport(httpTransport);
    useSyncLink.getState().set({ fileName: 'Local server', permitted: true, needsReconnect: false, error: null });
    // Server is reachable — drain any photo originals queued while it was off.
    void flushPendingUploads();
    return true;
  } catch (e) {
    connected = false;
    useSyncLink.getState().set({ error: connectErrorMessage(e as Error) });
    return false;
  }
}

/**
 * On app start: if a server address was saved before, silently re-verify one of
 * the configured addresses is reachable and make it the active transport — no
 * user gesture needed (it's just a fetch on the local network). This is what lets
 * sync "stay connected" across sessions on both PC and phone. Returns true if
 * reconnected.
 */
export async function initHttpSync(): Promise<boolean> {
  activeBase = null;
  if (!candidateBases().length) return false;
  try {
    const res = await fetchBase('/health', { headers: headers() });
    if (!res.ok) return false;
    connected = true;
    setActiveTransport(httpTransport);
    useSyncLink.getState().set({ fileName: 'Local server', permitted: true, needsReconnect: false, error: null });
    void flushPendingUploads();
    return true;
  } catch {
    // Server not running / off-network this session — stay quiet; the Data tab
    // still shows the saved address so the user can reconnect when it's up.
    return false;
  }
}

/** Disconnect the local server and revert to the file-link transport. */
export function disconnectHttp(): void {
  connected = false;
  activeBase = null;
  setActiveTransport(fileTransport);
  useSyncLink.getState().set({ fileName: null, permitted: false, lastSync: null, error: null });
}

/** True once a server URL is saved, so the UI can offer a quick reconnect. */
export function hasHttpConfig(): boolean {
  return candidateBases().length > 0;
}
