import { saveEvent } from './db';
import { scheduleSync } from './sync';
import { reverseGeocode } from '../features/welcome/locationInfo';
import type { AnyEvent } from '../types';

/** Located entry (not at 0,0) that has no place name yet — a backfill candidate. */
export function needsPlaceName(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0) && !e.location_name?.trim();
}

/** Pause that resolves early if aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export interface BackfillResult {
  updated: number;
  attempted: number;
}

/**
 * Reverse-geocode every located entry that lacks a place name, filling it in.
 * Runs one lookup at a time with a short gap so we stay polite to the free
 * geocoder, and fails soft per entry (a miss just leaves that one blank).
 * `onUpdated` fires per saved entry so the UI can refresh live; `signal` lets the
 * caller stop midway. Returns how many were attempted and how many got a name.
 */
export async function backfillPlaceNames(
  events: AnyEvent[],
  opts: {
    onUpdated?: (e: AnyEvent) => void;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<BackfillResult> {
  const candidates = events.filter(needsPlaceName);
  let updated = 0;
  let done = 0;

  for (const e of candidates) {
    if (opts.signal?.aborted) break;
    const name = await reverseGeocode(e.latitude, e.longitude, opts.signal, 'locality').catch(() => null);
    if (name) {
      const next = { ...e, location_name: name, updated_at: new Date().toISOString() } as AnyEvent;
      saveEvent(next);
      opts.onUpdated?.(next);
      updated++;
    }
    done++;
    opts.onProgress?.(done, candidates.length);
    // Brief gap between requests (skipped after the last one).
    if (done < candidates.length) await delay(600, opts.signal);
  }

  if (updated > 0) scheduleSync(); // propagate the filled-in names to the other device
  return { updated, attempted: candidates.length };
}
