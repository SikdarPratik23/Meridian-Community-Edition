/**
 * Browser storage durability helpers (StorageManager API). Two jobs:
 *
 *  1. Ask the browser to mark this origin's storage as **persistent**, so it
 *     won't be evicted when the device runs low on disk. For a local-first app
 *     where the browser *is* the database, eviction is the real data-loss path —
 *     this is the protection against it.
 *  2. Report how much is used vs available, so the Data tab can show it and warn
 *     long before any browser limit is reached.
 *
 * Everything is best-effort and fails soft: the API is unavailable on some
 * browsers (notably older Safari), and `persist()` may resolve `false` if the
 * browser declines — neither is fatal, the app works the same.
 */

export interface StorageInfo {
  /** Bytes used by this origin, or null if unknown. */
  usage: number | null;
  /** Total bytes available to this origin, or null if unknown. */
  quota: number | null;
  /** Whether storage is marked persistent (won't be evicted), or null if unknown. */
  persisted: boolean | null;
}

/**
 * Request persistent storage. Safe to call on every startup — once granted it
 * stays granted, and the browser only ever prompts (if at all) the first time.
 * Returns the resulting persisted state (or null if unsupported).
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    // If already persistent, don't ask again.
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

/** Current usage / quota / persisted state, all best-effort. */
export async function getStorageInfo(): Promise<StorageInfo> {
  const info: StorageInfo = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      info.usage = typeof est.usage === 'number' ? est.usage : null;
      info.quota = typeof est.quota === 'number' ? est.quota : null;
    }
    if (navigator.storage?.persisted) {
      info.persisted = await navigator.storage.persisted();
    }
  } catch {
    // leave nulls
  }
  return info;
}

/** Human-readable bytes, e.g. `4.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
