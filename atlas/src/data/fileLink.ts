import { create } from 'zustand';

/**
 * Optional link between the journal and a real file on disk, using the
 * File System Access API (Chromium browsers).
 *
 * When linked, every database save is mirrored to that file atomically, so your
 * data lives in a normal file you can see, back up, or move — not only inside
 * the browser's IndexedDB. IndexedDB is still written too, as a fallback copy.
 *
 * Security model: the browser hands us a handle only after *you* pick the file
 * through the OS dialog, and it re-asks permission (one click) on a fresh
 * session. We never get silent access to anything else on disk.
 *
 * This module owns the low-level file plumbing and a small UI-state store. It
 * deliberately does NOT import the database module, so `db.ts` can mirror to it
 * without a circular dependency; the components wire the two together.
 */

const HANDLE_DB = 'atlas-fs';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'dbFile';
// A second, independent handle for the JSON "sync folder" file (Drive etc.).
// Kept separate from the .db mirror above: the .db is a full local backup, the
// sync file is a small courier shared with another device. See sync.ts.
const SYNC_HANDLE_KEY = 'syncFile';

type PermState = 'granted' | 'denied' | 'prompt';

/** Permission methods aren't in lib.dom yet; describe just what we call. */
interface PermissibleHandle {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermState>;
}

// Source of truth for the mirror write path (read synchronously by db.ts).
let handle: FileSystemFileHandle | null = null;
let permitted = false;

export function isFileLinkSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

// --- UI-facing state -------------------------------------------------------

interface FileLinkState {
  supported: boolean;
  fileName: string | null;
  /** Permission granted this session — mirror writes are live. */
  permitted: boolean;
  /** A file is remembered but needs a one-click reconnect this session. */
  needsReconnect: boolean;
  lastWrite: string | null;
  error: string | null;
  set: (patch: Partial<FileLinkState>) => void;
}

export const useFileLink = create<FileLinkState>((set) => ({
  supported: isFileLinkSupported(),
  fileName: null,
  permitted: false,
  needsReconnect: false,
  lastWrite: null,
  error: null,
  set: (patch) => set(patch),
}));

// --- IndexedDB persistence of the handle -----------------------------------

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(HANDLE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(HANDLE_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function saveHandle(h: FileSystemFileHandle): Promise<void> {
  const dbs = await openHandleDb();
  const tx = dbs.transaction(HANDLE_STORE, 'readwrite');
  tx.objectStore(HANDLE_STORE).put(h, HANDLE_KEY);
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  dbs.close();
}

async function readHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const dbs = await openHandleDb();
    const tx = dbs.transaction(HANDLE_STORE, 'readonly');
    const val = await new Promise<FileSystemFileHandle | undefined>((res) => {
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => res(req.result as FileSystemFileHandle | undefined);
      req.onerror = () => res(undefined);
    });
    dbs.close();
    return val ?? null;
  } catch {
    return null;
  }
}

async function clearHandle(): Promise<void> {
  try {
    const dbs = await openHandleDb();
    const tx = dbs.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); });
    dbs.close();
  } catch {
    // non-fatal
  }
}

// --- Low-level file ops ----------------------------------------------------

async function ensurePermission(h: FileSystemFileHandle, interactive: boolean): Promise<boolean> {
  const p = h as unknown as PermissibleHandle;
  if (!p.queryPermission) return true; // older implementation: assume usable
  if ((await p.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (interactive && p.requestPermission) {
    return (await p.requestPermission({ mode: 'readwrite' })) === 'granted';
  }
  return false;
}

async function readBytes(h: FileSystemFileHandle): Promise<Uint8Array> {
  const file = await h.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeBytes(h: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  // createWritable() writes to a swap file and atomically renames on close, so a
  // crash mid-write can't corrupt the existing file.
  const w = await h.createWritable();
  // Copy into a fresh ArrayBuffer-backed view so the type matches the writer.
  await w.write(bytes.slice());
  await w.close();
}

// --- Public API ------------------------------------------------------------

/** Mirror the current DB bytes to the linked file. No-op unless live. */
export async function mirrorToFile(bytes: Uint8Array): Promise<void> {
  if (!handle || !permitted) return;
  try {
    await writeBytes(handle, bytes);
    useFileLink.getState().set({ lastWrite: new Date().toISOString(), error: null });
  } catch (e) {
    useFileLink.getState().set({ error: `Couldn't write the file: ${(e as Error).message}` });
  }
}

/**
 * On app start: recall any remembered file. If permission is already granted
 * (often within the same session), mark it ready; otherwise flag that a
 * one-click reconnect is needed. Returns the handle (or null).
 */
export async function initFileLink(): Promise<FileSystemFileHandle | null> {
  const store = useFileLink.getState();
  if (!isFileLinkSupported()) { store.set({ supported: false }); return null; }
  const h = await readHandle();
  if (!h) return null;
  handle = h;
  const granted = await ensurePermission(h, false);
  permitted = granted;
  store.set({ fileName: h.name, permitted: granted, needsReconnect: !granted });
  return h;
}

/** Re-grant permission for the remembered file (needs a user gesture). */
export async function reconnect(): Promise<boolean> {
  if (!handle) return false;
  const granted = await ensurePermission(handle, true);
  permitted = granted;
  useFileLink.getState().set({ permitted: granted, needsReconnect: !granted });
  return granted;
}

/** Pick/create a new file and seed it with the current DB bytes. */
export async function connectNewFile(currentBytes: Uint8Array): Promise<boolean> {
  const picker = (window as unknown as {
    showSaveFilePicker(opts: object): Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  try {
    const h = await picker({
      suggestedName: 'meridian-journal.db',
      types: [{ description: 'Meridian journal (SQLite)', accept: { 'application/x-sqlite3': ['.db'] } }],
    });
    handle = h;
    permitted = true;
    await writeBytes(h, currentBytes);
    await saveHandle(h);
    useFileLink.getState().set({ fileName: h.name, permitted: true, needsReconnect: false, lastWrite: new Date().toISOString(), error: null });
    return true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false; // user cancelled the dialog
    useFileLink.getState().set({ error: (e as Error).message });
    return false;
  }
}

/** Open an existing file; returns its bytes for the caller to load into the DB. */
export async function openExistingFile(): Promise<Uint8Array | null> {
  const picker = (window as unknown as {
    showOpenFilePicker(opts: object): Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker;
  try {
    const [h] = await picker({
      types: [{ description: 'Meridian journal (SQLite)', accept: { 'application/x-sqlite3': ['.db', '.sqlite'] } }],
      multiple: false,
    });
    if (!h) return null;
    handle = h;
    permitted = true;
    const bytes = await readBytes(h);
    await saveHandle(h);
    useFileLink.getState().set({ fileName: h.name, permitted: true, needsReconnect: false, error: null });
    return bytes;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    useFileLink.getState().set({ error: (e as Error).message });
    return null;
  }
}

/** Read the linked file's bytes (after permission is granted). */
export async function readLinkedBytes(): Promise<Uint8Array | null> {
  if (!handle || !permitted) return null;
  try {
    return await readBytes(handle);
  } catch {
    return null;
  }
}

/** Forget the file link (does not delete the file itself). */
export async function disconnectFile(): Promise<void> {
  handle = null;
  permitted = false;
  await clearHandle();
  useFileLink.getState().set({ fileName: null, permitted: false, needsReconnect: false, lastWrite: null, error: null });
}

// ===========================================================================
// Sync-folder file (JSON). A SECOND, independent linked file used as the
// cross-device courier. Mirrors the structure above but reads/writes text and
// can be polled for external changes (the other device writing to it via Drive).
// ===========================================================================

let syncHandle: FileSystemFileHandle | null = null;
let syncPermitted = false;

interface SyncLinkState {
  supported: boolean;
  fileName: string | null;
  permitted: boolean;
  needsReconnect: boolean;
  lastSync: string | null;
  error: string | null;
  set: (patch: Partial<SyncLinkState>) => void;
}

export const useSyncLink = create<SyncLinkState>((set) => ({
  supported: isFileLinkSupported(),
  fileName: null,
  permitted: false,
  needsReconnect: false,
  lastSync: null,
  error: null,
  set: (patch) => set(patch),
}));

async function saveSyncHandle(h: FileSystemFileHandle): Promise<void> {
  const dbs = await openHandleDb();
  const tx = dbs.transaction(HANDLE_STORE, 'readwrite');
  tx.objectStore(HANDLE_STORE).put(h, SYNC_HANDLE_KEY);
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  dbs.close();
}

async function readSyncHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const dbs = await openHandleDb();
    const tx = dbs.transaction(HANDLE_STORE, 'readonly');
    const val = await new Promise<FileSystemFileHandle | undefined>((res) => {
      const req = tx.objectStore(HANDLE_STORE).get(SYNC_HANDLE_KEY);
      req.onsuccess = () => res(req.result as FileSystemFileHandle | undefined);
      req.onerror = () => res(undefined);
    });
    dbs.close();
    return val ?? null;
  } catch {
    return null;
  }
}

async function clearSyncHandle(): Promise<void> {
  try {
    const dbs = await openHandleDb();
    const tx = dbs.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete(SYNC_HANDLE_KEY);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); });
    dbs.close();
  } catch { /* non-fatal */ }
}

export function isSyncLinked(): boolean {
  return syncHandle !== null && syncPermitted;
}

/** Pick (or create) the JSON sync file and remember it. */
export async function connectSyncFile(): Promise<boolean> {
  const picker = (window as unknown as {
    showSaveFilePicker(opts: object): Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  try {
    const h = await picker({
      suggestedName: 'meridian-journal.json',
      types: [{ description: 'Meridian sync file (JSON)', accept: { 'application/json': ['.json'] } }],
    });
    syncHandle = h;
    syncPermitted = true;
    await saveSyncHandle(h);
    useSyncLink.getState().set({ fileName: h.name, permitted: true, needsReconnect: false, error: null });
    return true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    useSyncLink.getState().set({ error: (e as Error).message });
    return false;
  }
}

/** Open an existing JSON sync file (e.g. one already in your Drive folder). */
export async function openSyncFile(): Promise<boolean> {
  const picker = (window as unknown as {
    showOpenFilePicker(opts: object): Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker;
  try {
    const [h] = await picker({
      types: [{ description: 'Meridian sync file (JSON)', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    if (!h) return false;
    syncHandle = h;
    syncPermitted = true;
    await saveSyncHandle(h);
    useSyncLink.getState().set({ fileName: h.name, permitted: true, needsReconnect: false, error: null });
    return true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    useSyncLink.getState().set({ error: (e as Error).message });
    return false;
  }
}

/** Recall a remembered sync file on startup; one-click reconnect if needed. */
export async function initSyncLink(): Promise<boolean> {
  const store = useSyncLink.getState();
  if (!isFileLinkSupported()) { store.set({ supported: false }); return false; }
  const h = await readSyncHandle();
  if (!h) return false;
  syncHandle = h;
  const granted = await ensurePermission(h, false);
  syncPermitted = granted;
  store.set({ fileName: h.name, permitted: granted, needsReconnect: !granted });
  return granted;
}

/** Re-grant permission for the remembered sync file (needs a user gesture). */
export async function reconnectSync(): Promise<boolean> {
  if (!syncHandle) return false;
  const granted = await ensurePermission(syncHandle, true);
  syncPermitted = granted;
  useSyncLink.getState().set({ permitted: granted, needsReconnect: !granted });
  return granted;
}

/** Forget the sync file link (file itself is kept). */
export async function disconnectSync(): Promise<void> {
  syncHandle = null;
  syncPermitted = false;
  await clearSyncHandle();
  useSyncLink.getState().set({ fileName: null, permitted: false, needsReconnect: false, lastSync: null, error: null });
}

/** Read the sync file's text (empty string if the file is new/empty). */
export async function readSyncText(): Promise<string | null> {
  if (!syncHandle || !syncPermitted) return null;
  try {
    const file = await syncHandle.getFile();
    return await file.text();
  } catch (e) {
    useSyncLink.getState().set({ error: `Couldn't read the sync file: ${(e as Error).message}` });
    return null;
  }
}

/** Write text back to the sync file (atomic via the writable swap). */
export async function writeSyncText(text: string): Promise<boolean> {
  if (!syncHandle || !syncPermitted) return false;
  try {
    const w = await syncHandle.createWritable();
    await w.write(text);
    await w.close();
    useSyncLink.getState().set({ lastSync: new Date().toISOString(), error: null });
    return true;
  } catch (e) {
    useSyncLink.getState().set({ error: `Couldn't write the sync file: ${(e as Error).message}` });
    return false;
  }
}

/** The file's last-modified time, used to detect the other device's writes. */
export async function syncFileModifiedAt(): Promise<number | null> {
  if (!syncHandle || !syncPermitted) return null;
  try {
    return (await syncHandle.getFile()).lastModified;
  } catch {
    return null;
  }
}
