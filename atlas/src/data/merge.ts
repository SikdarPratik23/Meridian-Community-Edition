import type { AnyEvent, JournalEntry } from '../types';

/**
 * Newest-wins merge of journal entries by id. Shared by the manual Import path
 * (DataView) and the Sync folder path (sync.ts) so they can never drift apart.
 *
 * Rules, all derived from each entry's own timestamps:
 *  - An id not present locally is ADDED.
 *  - A matching id is UPDATED only if the incoming copy is strictly newer
 *    (by `updated_at`, falling back to `created_at`).
 *  - A newer-or-equal local copy is KEPT untouched.
 *  - Structurally invalid records are SKIPPED, never stored.
 *
 * Ids are UUIDs minted per device, so this is safe to run repeatedly and in
 * both directions — every device converges on the latest version of each entry.
 */

export interface MergeStats {
  added: number;
  updated: number;
  kept: number;
  skipped: number;
}

export interface MergeResult {
  /** The merged set, keyed for callers that want to persist the winners. */
  merged: AnyEvent[];
  /** Just the entries that changed locally (added or updated) — what to save. */
  changed: AnyEvent[];
  stats: MergeStats;
}

/** A record is usable only if it has the identifying fields the DB requires. */
export function isValidEvent(raw: unknown): raw is AnyEvent {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.type === 'string' && typeof r.title === 'string';
}

/** Normalise array fields so a malformed source can't poison the DB. */
export function normalizeEvent(raw: AnyEvent): AnyEvent {
  const r = raw as unknown as Record<string, unknown>;
  return {
    ...raw,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    media_attachments: Array.isArray(r.media_attachments)
      ? (r.media_attachments as JournalEntry['media_attachments'])
      : [],
  } as AnyEvent;
}

/** The comparable timestamp for an entry (updated_at, else created_at, else ''). */
export function stampOf(e: AnyEvent): string {
  return e.updated_at || e.created_at || '';
}

/**
 * A tombstone is a deleted entry kept as a marker so the deletion can sync. It
 * merges like any other record (newest-wins by stamp); callers that display
 * entries must filter these out, and the DB writes them with `deleted_at` set.
 */
export function isTombstone(e: AnyEvent): boolean {
  return Boolean(e.deleted_at);
}

export function mergeEvents(local: AnyEvent[], incoming: unknown[]): MergeResult {
  const byId = new Map(local.map((e) => [e.id, e]));
  const merged = new Map(local.map((e) => [e.id, e]));
  const changed: AnyEvent[] = [];
  const stats: MergeStats = { added: 0, updated: 0, kept: 0, skipped: 0 };

  for (const raw of incoming) {
    if (!isValidEvent(raw)) { stats.skipped++; continue; }
    const ev = normalizeEvent(raw);
    const existing = byId.get(ev.id);
    if (existing) {
      const localStamp = stampOf(existing);
      const incomingStamp = stampOf(ev);
      if (localStamp && incomingStamp && localStamp >= incomingStamp) {
        stats.kept++; // local copy is newer or identical — leave it alone
        continue;
      }
      stats.updated++;
    } else {
      stats.added++;
    }
    merged.set(ev.id, ev);
    changed.push(ev);
  }

  return { merged: [...merged.values()], changed, stats };
}
