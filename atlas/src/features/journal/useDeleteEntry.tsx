import { useCallback } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useDialogs } from '../../components/ui/dialogs';
import { deleteEvent, saveEvent } from '../../data/db';
import { scheduleSync } from '../../data/sync';
import { toast } from '../../components/ui/toasts';
import type { AnyEvent } from '../../types';

/**
 * Put a deleted entry back.
 *
 * This works because deletion is a TOMBSTONE, not an erasure: the row survives with
 * `deleted_at` set. Re-saving the original record with a fresh `updated_at` makes it
 * strictly newer than the tombstone, so the newest-wins merge in `merge.ts` revives
 * it on this device AND propagates the revival to the other one — the sync engine
 * already has an explicit test for exactly this ("a newer edit after delete
 * intentionally revives"). No new sync concept is needed.
 */
function restoreEntry(
  event: AnyEvent,
  addOrUpdate: (e: AnyEvent) => void,
  opts?: { quiet?: boolean },
): void {
  const revived = { ...event, deleted_at: undefined, updated_at: new Date().toISOString() };
  saveEvent(revived);
  addOrUpdate(revived);
  scheduleSync();
  // `quiet` is for a bulk restore, which raises one summary toast of its own
  // rather than one per entry.
  if (!opts?.quiet) toast.success('Entry restored');
}

/**
 * Delete a single entry — and only that entry. Centralises the confirm → soft-delete
 * → drop-from-store → push-to-sync flow so both the open reader (EventCard) and the
 * inline timeline trash button behave identically. Each entry is its own record, so
 * removing "the evening note" never touches the morning's; the day grouping in the
 * timeline is display-only.
 *
 * The optional `beforeCommit` runs after the user confirms but before the record is
 * actually removed — the timeline uses it to play a brief exit animation so the card
 * slides out instead of blinking away.
 */
export function useDeleteEntry() {
  const removeEvent = useAtlasStore((s) => s.removeEvent);
  const addOrUpdateEvent = useAtlasStore((s) => s.addOrUpdateEvent);
  const { confirm } = useDialogs();

  return useCallback(
    async (event: AnyEvent, opts?: { beforeCommit?: () => Promise<void> | void }): Promise<boolean> => {
      const ok = await confirm({
        title: 'Delete this entry?',
        message: (
          <>
            <strong>{event.title || 'Untitled entry'}</strong> will be removed from your
            journal. You'll get a moment to undo it.
          </>
        ),
        confirmLabel: 'Delete',
        variant: 'danger',
      });
      if (!ok) return false;
      if (opts?.beforeCommit) await opts.beforeCommit();
      deleteEvent(event.id);
      removeEvent(event.id);
      scheduleSync(); // push the deletion to the other device
      // The way back. Only offered for a few seconds, but that covers the case
      // this is really for: realising immediately that you hit the wrong entry.
      toast.undoable('Entry deleted', () => restoreEntry(event, addOrUpdateEvent));
      return true;
    },
    [confirm, removeEvent, addOrUpdateEvent],
  );
}

/**
 * Delete a whole day at once — every entry that falls on the given calendar day.
 * Each entry is still removed as its own record (so the deletions sync exactly
 * like single ones); this just bundles the confirm + the loop so the user can
 * clear a day in one action instead of trashing entries one by one. Returns the
 * number removed (0 if cancelled or the day was already empty).
 */
export function useDeleteDay() {
  const removeEvent = useAtlasStore((s) => s.removeEvent);
  const addOrUpdateEvent = useAtlasStore((s) => s.addOrUpdateEvent);
  const { confirm } = useDialogs();

  return useCallback(
    async (events: AnyEvent[], dayLabel: string): Promise<number> => {
      if (events.length === 0) return 0;
      const n = events.length;
      const ok = await confirm({
        title: n === 1 ? 'Delete this day?' : `Delete all ${n} entries from this day?`,
        message: (
          <>
            Every entry from <strong>{dayLabel}</strong>
            {n > 1 ? <> — all {n} of them</> : null} will be removed. You'll get a moment
            to undo it.
          </>
        ),
        confirmLabel: n === 1 ? 'Delete' : `Delete ${n} entries`,
        variant: 'danger',
      });
      if (!ok) return 0;
      // Snapshot before mutating, so undo restores exactly what was there.
      const deleted = [...events];
      for (const e of deleted) {
        deleteEvent(e.id);
        removeEvent(e.id);
      }
      scheduleSync(); // one push covers all the deletions
      toast.undoable(
        n === 1 ? 'Entry deleted' : `${n} entries deleted`,
        () => {
          for (const e of deleted) restoreEntry(e, addOrUpdateEvent, { quiet: true });
          toast.success(n === 1 ? 'Entry restored' : `${n} entries restored`);
        },
      );
      return n;
    },
    [confirm, removeEvent, addOrUpdateEvent],
  );
}
