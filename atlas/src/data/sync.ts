import type { AnyEvent, JournalEntry, MediaAttachment } from '../types';
import { mergeEvents, stampOf, type MergeStats } from './merge';
import { getAllEvents, getAllRecords, saveEvent, flushDb } from './db';
import { flushPendingUploads } from './media';
import {
  isSyncLinked, readSyncText, writeSyncText, syncFileModifiedAt, useSyncLink,
  initSyncLink as initSyncLinkFile,
} from './fileLink';
import { useAtlasStore } from '../store/atlas';

/** Re-exported so the app boots the sync link through the sync module. */
export async function initSyncLink(): Promise<boolean> {
  return initSyncLinkFile();
}

/**
 * "Sync folder" core — the pure logic behind syncing two devices through one
 * JSON file in a cloud-synced folder (e.g. Google Drive). No I/O here; callers
 * (the PC file-link path and the phone one-tap path) supply the file bytes and
 * persist the results. That keeps every rule below unit-testable.
 *
 * The file is a COURIER, not a warehouse. The permanent copy of every entry —
 * including full photo bytes — lives in each device's local SQLite DB. The file
 * only carries the un-synced backlog. Once BOTH devices have confirmed they
 * hold an entry, its heavy image bytes are trimmed from the file so it can't
 * grow forever.
 */

export type DeviceRole = 'pc' | 'phone';

/** A media attachment in the file whose bytes have been trimmed after sync. */
interface StrippedAttachment extends Omit<MediaAttachment, 'data'> {
  data: '';
  stripped: true;
}

export interface SyncFile {
  version: 1;
  /** Latest entry-stamp each device has confirmed storing. ISO strings. */
  devices: { pc: string; phone: string };
  entries: AnyEvent[];
}

export const EMPTY_SYNC_FILE: SyncFile = {
  version: 1,
  devices: { pc: '', phone: '' },
  entries: [],
};

export function parseSyncFile(text: string): SyncFile {
  if (!text || !text.trim()) return { ...EMPTY_SYNC_FILE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Sync file is not valid JSON.');
  }
  const p = parsed as Partial<SyncFile> & { events?: AnyEvent[] };
  // Tolerate a plain export ({events:[...]}) or a bare array as a first import.
  const entries = Array.isArray(p.entries)
    ? p.entries
    : Array.isArray(p.events)
      ? p.events
      : Array.isArray(parsed)
        ? (parsed as AnyEvent[])
        : [];
  const devices = p.devices && typeof p.devices === 'object'
    ? { pc: String(p.devices.pc || ''), phone: String(p.devices.phone || '') }
    : { pc: '', phone: '' };
  return { version: 1, devices, entries };
}

export function serializeSyncFile(file: SyncFile): string {
  return JSON.stringify(file, null, 2);
}

/** The newest entry-stamp across a set (what a device "has seen up to"). */
export function maxStamp(events: AnyEvent[]): string {
  return events.reduce((max, e) => {
    const s = stampOf(e);
    return s > max ? s : max;
  }, '');
}

function isStripped(a: MediaAttachment | StrippedAttachment): a is StrippedAttachment {
  return (a as StrippedAttachment).stripped === true || a.data === '';
}

/**
 * Trim image bytes from any entry that BOTH devices have confirmed storing.
 * "Confirmed" = both device stamps are >= the entry's own stamp, so the other
 * side has already absorbed it into its local DB. The attachment record is kept
 * (marked `stripped`) so the entry is intact and never re-sent with bytes — the
 * full image still lives in each device's local DB.
 *
 * This is the safety-critical rule: never trim before both sides have it, or a
 * device that hasn't synced yet would lose the photo.
 */
export function trimConfirmed(file: SyncFile): SyncFile {
  const floor = file.devices.pc && file.devices.phone
    ? (file.devices.pc < file.devices.phone ? file.devices.pc : file.devices.phone)
    : ''; // if either device has never synced, trim nothing
  if (!floor) return file;

  const entries = file.entries.map((e) => {
    const atts = (e as JournalEntry).media_attachments;
    if (!atts?.length) return e;
    const confirmed = stampOf(e) <= floor;
    if (!confirmed) return e;
    const trimmed = atts.map((a) =>
      isStripped(a) ? a : ({ ...a, data: '', stripped: true } as StrippedAttachment),
    );
    return { ...e, media_attachments: trimmed } as AnyEvent;
  });
  return { ...file, entries };
}

/**
 * When merging the file's entries into the local DB, an entry whose bytes were
 * trimmed in transit must NOT overwrite a fuller local copy. If we already hold
 * the image bytes locally, keep ours; only take the incoming (stripped) entry's
 * non-image fields if it's genuinely newer, preserving our local bytes.
 */
function reconcileStripped(local: AnyEvent[], incoming: AnyEvent[]): AnyEvent[] {
  const localById = new Map(local.map((e) => [e.id, e]));
  return incoming.map((inc) => {
    const incAtts = (inc as JournalEntry).media_attachments;
    if (!incAtts?.some((a) => isStripped(a))) return inc; // nothing stripped
    const mine = localById.get(inc.id) as JournalEntry | undefined;
    const myAtts = mine?.media_attachments;
    if (!myAtts?.length) return inc;
    // Re-hydrate stripped attachments from our local bytes where we have them.
    const byId = new Map(myAtts.map((a) => [a.id, a]));
    const rehydrated = incAtts.map((a) => {
      if (!isStripped(a)) return a;
      const local = byId.get(a.id);
      return local && local.data ? local : a;
    });
    return { ...inc, media_attachments: rehydrated } as AnyEvent;
  });
}

export interface SyncOutcome {
  /** Entries to save into the local DB (added/updated, bytes preserved). */
  toSave: AnyEvent[];
  /** The file to write back (merged, re-stamped for this device, trimmed). */
  file: SyncFile;
  stats: MergeStats;
}

/**
 * One full sync pass for `role`, given the current file and this device's local
 * entries. Pure: returns what to save locally and what to write back to the file.
 *
 *  1. Merge the file's entries into local (newest-wins), re-hydrating any photo
 *     bytes that were trimmed in transit from our local copy.
 *  2. Build the new file = local ∪ file (so our newer entries reach the file),
 *     stamp THIS device as caught up to everything it now holds.
 *  3. Trim entries both devices have confirmed.
 */
export function syncPass(role: DeviceRole, file: SyncFile, local: AnyEvent[], trim = true): SyncOutcome {
  // 1. Bring the file's entries into local.
  const reconciled = reconcileStripped(local, file.entries);
  const intoLocal = mergeEvents(local, reconciled);

  // 2. Push our (now-merged) entries back into the file set, newest-wins.
  const intoFile = mergeEvents(file.entries, intoLocal.merged);
  const localAfter = intoLocal.merged;

  // This device is now caught up to the newest stamp it holds.
  const myStamp = maxStamp(localAfter);
  const devices = { ...file.devices };
  devices[role] = myStamp > devices[role] ? myStamp : devices[role];

  let nextFile: SyncFile = { version: 1, devices, entries: intoFile.merged };
  // 3. Trim what both sides now have — ONLY for courier transports. A warehouse
  //    backend keeps full data (photos), so it passes trim=false.
  if (trim) nextFile = trimConfirmed(nextFile);

  return { toSave: intoLocal.changed, file: nextFile, stats: intoLocal.stats };
}

// ===========================================================================
// Orchestration — wire the pure logic above to the linked file and the DB.
// ===========================================================================

/** Which device this app instance acts as in the two-device courier scheme. */
const ROLE_KEY = 'meridian_sync_role';

export function getRole(): DeviceRole {
  const saved = localStorage.getItem(ROLE_KEY);
  if (saved === 'pc' || saved === 'phone') return saved;
  // Sensible default: a touch device with no file-link support is the phone.
  const isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  return isTouch ? 'phone' : 'pc';
}

export function setRole(role: DeviceRole): void {
  localStorage.setItem(ROLE_KEY, role);
}

/** Whether to keep this device in step automatically. Persisted; defaults ON so
 *  sync resumes silently every session once a target is connected. */
const AUTOSYNC_KEY = 'meridian_autosync';

export function getAutoSync(): boolean {
  return localStorage.getItem(AUTOSYNC_KEY) !== '0'; // default ON (null → true)
}

export function setAutoSync(on: boolean): void {
  localStorage.setItem(AUTOSYNC_KEY, on ? '1' : '0');
}

export interface SyncRunResult {
  ok: boolean;
  stats?: MergeStats;
  error?: string;
}

/**
 * A sync transport is just "read the shared file text, write it back, and tell
 * me when it last changed." The file-link path (PC local Drive folder) and the
 * Google Drive API path (works on the phone too) each implement this, and the
 * proven syncPass logic above runs identically on top of either.
 */
export interface SyncTransport {
  /** Human label for status UI, e.g. the file name or "Google Drive". */
  label(): string;
  /** Ready to read/write right now (linked + permitted / authenticated). */
  isReady(): boolean;
  /** Current file text, '' if empty, or null on failure. */
  read(): Promise<string | null>;
  /** Persist file text. Returns false on failure. */
  write(text: string): Promise<boolean>;
  /** Last-modified time in ms (to detect the other device's writes), or null. */
  modifiedAt(): Promise<number | null>;
  /**
   * Whether photo bytes should be trimmed from the shared payload once both
   * devices have them. True for a cloud COURIER with limited space (Drive, a
   * Drive-folder file). False for a real backend WAREHOUSE (a server/DB) that
   * should retain full data as a backup. See trimConfirmed().
   */
  trims: boolean;
}

/** The original file-link transport (Chromium PC linking a local Drive file). */
export const fileTransport: SyncTransport = {
  label: () => useSyncLink.getState().fileName || 'linked file',
  isReady: () => isSyncLinked(),
  read: () => readSyncText(),
  write: (t) => writeSyncText(t),
  modifiedAt: () => syncFileModifiedAt(),
  // Trimming is OFF. The 2-scalar device stamp can't safely express "both devices
  // have THIS entry": a device whose stamp advanced via a local edit can trim an
  // older, not-yet-pulled entry's photo before that device stored it (confirmed
  // by stress test, 2026-07-10). Since photos now sync only as small downscaled
  // copies (full-res originals live on the PC, refetchable by id — see media.ts),
  // trimming saves little and isn't worth the data-loss risk. Keep full data.
  trims: false,
};

// Whichever transport is currently selected. Defaults to the file-link one so
// existing PC setups keep working; the Drive path installs itself when connected.
let activeTransport: SyncTransport = fileTransport;
export function setActiveTransport(t: SyncTransport): void {
  activeTransport = t;
  lastSeenMtime = null; // re-baseline polling for the new transport
}
export function getActiveTransport(): SyncTransport { return activeTransport; }

let syncing = false;

/**
 * Run one full sync against the active transport: read the shared file, merge
 * into the local DB, persist the winners, write the (trimmed, re-stamped) file
 * back, and refresh the in-memory store. Safe to call repeatedly; a run already
 * in flight is skipped.
 */
export async function runSync(): Promise<SyncRunResult> {
  const t = activeTransport;
  if (!t.isReady()) return { ok: false, error: 'No sync target connected.' };
  if (syncing) return { ok: false, error: 'Sync already in progress.' };
  syncing = true;
  try {
    const text = await t.read();
    if (text === null) return { ok: false, error: 'Could not read the sync target.' };

    const file = parseSyncFile(text);
    // Sync over ALL records, tombstones included, so local deletions reach the
    // other device and incoming deletions are applied here.
    const local = getAllRecords();
    const outcome = syncPass(getRole(), file, local, t.trims);

    // Persist entries that changed locally (added/updated) into the DB.
    for (const ev of outcome.toSave) saveEvent(ev);
    await flushDb();

    // Write the reconciled file back so the other device sees our entries and
    // the trim/stamps advance. Only write if it actually changed, to avoid
    // bumping the file's mtime (which would look like an external change).
    const nextText = serializeSyncFile(outcome.file);
    if (nextText !== text) {
      const wrote = await t.write(nextText);
      if (!wrote) return { ok: false, error: useSyncLink.getState().error || 'Write failed.' };
      lastSeenMtime = await t.modifiedAt();
    }
    useSyncLink.getState().set({ lastSync: new Date().toISOString() });

    // The server is reachable this pass — drain any photo originals that were
    // queued while it was off (no-op when nothing is queued or on the file
    // transport). Fire-and-forget so it never delays the sync result.
    void flushPendingUploads();

    // Refresh the UI from the DB if anything changed.
    if (outcome.toSave.length) {
      const live = getAllEvents();
      const store = useAtlasStore.getState();
      store.setEvents(live);
      // If the entry we're viewing/editing was deleted on the other device, it's
      // gone from `live` now — drop the stale selection so the pane doesn't show
      // a phantom entry.
      const liveIds = new Set(live.map((e) => e.id));
      if (store.selectedEvent && !liveIds.has(store.selectedEvent.id)) {
        store.selectEvent(null);
      }
    }
    return { ok: true, stats: outcome.stats };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    syncing = false;
  }
}

// --- Auto-sync: poll the target for the other device's writes --------------

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSeenMtime: number | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Push local changes out shortly after they happen, so adds/edits/deletes reach
 * the other device without waiting for the next poll or a manual Sync tap. Call
 * this from every local mutation (compose, edit, delete, import). Debounced so a
 * burst of edits coalesces into one sync, and a no-op unless auto-sync is on and
 * a target is connected. The poll loop above still handles the *other* device's
 * writes; this handles *ours*.
 */
export function scheduleSync(delayMs = 500): void {
  if (!getAutoSync() || !activeTransport.isReady()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (syncing) return; // a pass is already running; it will carry our changes
    void runSync().then(async () => { lastSeenMtime = await activeTransport.modifiedAt(); });
  }, delayMs);
}

/**
 * Start polling the active transport. When its modified-time changes (the other
 * device wrote to it), run a sync. Also syncs immediately so our latest entries
 * go out. Works for the file-link PC path and the Drive path (which can poll on
 * the phone too, while the app is open).
 */
export function startAutoSync(intervalMs = 8000): void {
  if (pollTimer || !activeTransport.isReady()) return;
  // Push our state out and pull anything waiting, right away.
  void runSync().then(async () => { lastSeenMtime = await activeTransport.modifiedAt(); });

  pollTimer = setInterval(async () => {
    if (!activeTransport.isReady()) return;
    const mtime = await activeTransport.modifiedAt();
    if (mtime == null) return;
    if (lastSeenMtime == null) { lastSeenMtime = mtime; return; }
    if (mtime !== lastSeenMtime) {
      lastSeenMtime = mtime;
      await runSync();
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
}
