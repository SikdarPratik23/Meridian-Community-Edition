import type { AnyEvent } from '../../types';
import { haversineKm } from '../../utils';

/**
 * Trip/expedition grouping — driven by an explicit trip name the user sets on
 * each entry (editor checkbox → name), NOT by time proximity. Entries that share
 * a trip name are gathered into one trip; every entry still appears normally in
 * the timeline. Derived on the fly, nothing extra persisted beyond the entry's
 * own `trip` field.
 */

const DAY_MS = 86_400_000;

export interface Trip {
  /** The trip name — also its stable id (grouping key). */
  id: string;
  name: string;
  startTs: string;
  endTs: string;
  /** Whole-number days the trip spans (inclusive), min 1. */
  spanDays: number;
  /** All entries in the trip, oldest → newest. */
  events: AnyEvent[];
  /** The located subset, oldest → newest (for the route map + distance). */
  located: AnyEvent[];
  /** Sum of consecutive located hops, km. */
  distanceKm: number;
  /** Distinct place names, in first-appearance order. */
  placeNames: string[];
}

function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

/** The distinct trip names in use (for editor autocomplete), most-recent first. */
export function tripNames(events: AnyEvent[]): string[] {
  const seen = new Map<string, string>(); // name → latest timestamp
  for (const e of events) {
    if (e.deleted_at) continue;
    const nm = e.trip?.trim();
    if (!nm) continue;
    const prev = seen.get(nm);
    if (!prev || e.timestamp > prev) seen.set(nm, e.timestamp);
  }
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([nm]) => nm);
}

/** Group entries into trips by their `trip` name (newest trip first). */
export function computeTrips(events: AnyEvent[]): Trip[] {
  const groups = new Map<string, AnyEvent[]>();
  for (const e of events) {
    if (e.deleted_at) continue;
    const name = e.trip?.trim();
    if (!name) continue;
    const arr = groups.get(name);
    if (arr) arr.push(e);
    else groups.set(name, [e]);
  }

  const trips: Trip[] = [];
  for (const [name, evs] of groups) {
    const ordered = evs.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const located = ordered.filter(hasLocation);

    let distanceKm = 0;
    for (let i = 1; i < located.length; i++) {
      distanceKm += haversineKm(
        [located[i - 1].longitude, located[i - 1].latitude],
        [located[i].longitude, located[i].latitude],
      );
    }

    const startTs = ordered[0].timestamp;
    const endTs = ordered[ordered.length - 1].timestamp;
    const spanDays = Math.max(1, Math.round((new Date(endTs).getTime() - new Date(startTs).getTime()) / DAY_MS) + 1);

    const placeNames: string[] = [];
    for (const e of ordered) {
      const nm = e.location_name?.trim();
      if (nm && !placeNames.includes(nm)) placeNames.push(nm);
    }

    trips.push({ id: name, name, startTs, endTs, spanDays, events: ordered, located, distanceKm, placeNames });
  }

  return trips.sort((a, b) => b.endTs.localeCompare(a.endTs)); // newest first
}

/** A concise date-range label for a trip, e.g. "12–15 Aug 2026" or "3 Aug 2026". */
export function tripDateRange(trip: Trip): string {
  const start = new Date(trip.startTs);
  const end = new Date(trip.endTs);
  const sameDay = start.toDateString() === end.toDateString();
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (sameDay) return start.toLocaleDateString(undefined, opts);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) return `${start.getDate()}–${end.toLocaleDateString(undefined, opts)}`;
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}
