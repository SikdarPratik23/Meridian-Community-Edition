/**
 * Full-resolution originals live only on the PC (the sync server's `media/`
 * folder). Entries sync a downscaled copy inline (see `utils/image.ts`); this
 * module is the side-channel that:
 *   - ships an original to the PC when a photo is attached,
 *   - fetches an original on demand when you want to view/save it, and
 *   - queues uploads made while the PC was unreachable, completing them once
 *     it's back (so a photo taken on the phone offline isn't lost).
 *
 * The PC server keeps the originals as files; nothing here is stored on Vercel
 * or any cloud — the app only ever moves bytes between your own two devices.
 */

// Same localStorage keys `httpSync.ts` uses. Read directly here (not imported)
// to keep this module free of any import cycle with the sync layer.
const URL_KEY = 'meridian_http_url';
const TOKEN_KEY = 'meridian_http_token';

function serverBase(): string {
  try { return (localStorage.getItem(URL_KEY) || '').replace(/\/+$/, ''); } catch { return ''; }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* ignore */ }
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** True when a PC server address is configured (originals only live on the PC). */
export function canUseOriginals(): boolean {
  return Boolean(serverBase());
}

/** The PC media URL for an attachment id, or null if no server is configured. */
export function mediaUrl(id: string): string | null {
  const base = serverBase();
  return base ? `${base}/media/${encodeURIComponent(id)}` : null;
}

/** Upload an original to the PC. Returns false if the server is unreachable. */
export async function uploadOriginal(id: string, blob: Blob, mime: string, name: string): Promise<boolean> {
  const url = mediaUrl(id);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: authHeaders({
        'Content-Type': mime || 'application/octet-stream',
        'X-Filename': encodeURIComponent(name || ''),
      }),
      body: blob,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch an original from the PC as an object URL (for viewing/downloading), or
 * null if the PC is off or doesn't have it. Caller must URL.revokeObjectURL it.
 */
export async function fetchOriginal(id: string): Promise<string | null> {
  const url = mediaUrl(id);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

// --- Offline upload queue --------------------------------------------------
// Originals captured while the PC is unreachable are parked in their own tiny
// IndexedDB database and flushed when the server comes back.

const QUEUE_DB = 'meridian-media';
const QUEUE_STORE = 'pending';

interface PendingUpload { id: string; blob: Blob; mime: string; name: string; }

function openQueue(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(QUEUE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function queueOriginal(rec: PendingUpload): Promise<void> {
  try {
    const db = await openQueue();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).put(rec);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  } catch {
    // Best effort: if we can't even queue it, the downscaled copy still exists.
  }
}

async function listPending(): Promise<PendingUpload[]> {
  try {
    const db = await openQueue();
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const out = await new Promise<PendingUpload[]>((res) => {
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => res((req.result as PendingUpload[]) || []);
      req.onerror = () => res([]);
    });
    db.close();
    return out;
  } catch {
    return [];
  }
}

async function removePending(id: string): Promise<void> {
  try {
    const db = await openQueue();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).delete(id);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  } catch {
    /* best effort */
  }
}

/**
 * Store an original for `id`: upload it to the PC now, or park it in the offline
 * queue if the PC is unreachable. Safe to call fire-and-forget from the editor.
 */
export async function storeOriginal(id: string, file: File): Promise<void> {
  const ok = await uploadOriginal(id, file, file.type, file.name);
  if (!ok) await queueOriginal({ id, blob: file, mime: file.type, name: file.name });
}

let flushing = false;

/**
 * Try to upload every queued original. Stops at the first failure (server just
 * went away) and leaves the rest for next time. Returns how many succeeded.
 * Called after a sync connects/completes, so queued uploads drain automatically.
 */
export async function flushPendingUploads(): Promise<number> {
  if (flushing || !canUseOriginals()) return 0;
  flushing = true;
  let done = 0;
  try {
    for (const p of await listPending()) {
      const ok = await uploadOriginal(p.id, p.blob, p.mime, p.name);
      if (!ok) break; // server unreachable again — retry on a later pass
      await removePending(p.id);
      done++;
    }
  } finally {
    flushing = false;
  }
  return done;
}
