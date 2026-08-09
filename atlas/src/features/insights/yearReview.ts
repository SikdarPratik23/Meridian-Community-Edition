import type { AnyEvent, MediaAttachment } from '../../types';
import { getDayKey, haversineKm } from '../../utils';
import { isLocated } from '../../utils/geoExport';

/**
 * Year-in-review — one year of the journal reduced to the handful of numbers
 * worth looking back on (entries, days, streak, distance, places, tags, moods,
 * photos, words). Derived on the fly from the entries the store already holds;
 * nothing is persisted, so a year recomputes correctly after an edit or a sync.
 *
 * A year means the LOCAL calendar year (`new Date(ts).getFullYear()`), matching
 * how `getDayKey` buckets days from local date parts. Using the UTC ISO prefix
 * instead would move a 1 Jan 00:30 entry in Nuremberg into the previous year —
 * the same off-by-a-day the day grouping already avoids.
 *
 * Day identity comes from `getDayKey` alone; the streak maths turns those keys
 * back into day ordinals rather than deriving days a second way, so "days
 * journaled", "busiest day" and "longest streak" can never disagree.
 */

const DAY_MS = 86_400_000;

export interface YearReview {
  year: number;
  totalEntries: number;
  /** Entries per month, always 12 numbers, index 0 = January. */
  entriesPerMonth: number[];
  /** Distinct calendar days journaled on. */
  daysJournaled: number;
  /** Longest run of consecutive days with at least one entry. */
  longestStreak: number;
  /** Sum of consecutive located hops in timestamp order, km. */
  distanceKm: number;
  /** Distinct place names, most-visited first, with counts. */
  topPlaces: Array<{ name: string; count: number }>;
  /** Distinct tags, most-used first, with counts. */
  topTags: Array<{ name: string; count: number }>;
  /** Mood counts, most-frequent first. */
  moods: Array<{ name: string; count: number }>;
  /** Trip names in the year, newest-ending first. */
  trips: string[];
  /** How many entries carry at least one photo. */
  entriesWithPhotos: number;
  /** Total photo attachments across the year. */
  photoCount: number;
  /** Total words written across all entry bodies. */
  wordCount: number;
  /** The located entries in timestamp order — for drawing a route map. */
  located: AnyEvent[];
  /** The busiest single day, or null if the year is empty. */
  busiestDay: { dayKey: string; count: number } | null;
  /** First and last entry timestamps, or null if empty. */
  firstEntry: string | null;
  lastEntry: string | null;
}

/** A `YYYY-MM-DD` key as a day number, so consecutive days differ by exactly 1. */
function dayOrdinal(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function photosOf(e: AnyEvent): number {
  // Places carry `media_attachments` optionally; audio notes are not photos.
  const media: MediaAttachment[] = e.media_attachments ?? [];
  return media.reduce((n, m) => (m.kind === 'image' ? n + 1 : n), 0);
}

function bump(counts: Map<string, number>, name: string | undefined): void {
  const key = name?.trim();
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Counts as a leaderboard. Ties break by name so the order is stable across runs. */
function rank(counts: Map<string, number>): Array<{ name: string; count: number }> {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Which years the journal has entries for, newest first. */
export function journalYears(events: AnyEvent[]): number[] {
  const years = new Set<number>();
  for (const e of events) {
    if (e.deleted_at) continue;
    years.add(new Date(e.timestamp).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

/** Compute the review for one year. */
export function computeYearReview(events: AnyEvent[], year: number): YearReview {
  const ordered = events
    .filter((e) => !e.deleted_at && new Date(e.timestamp).getFullYear() === year)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const entriesPerMonth = Array.from({ length: 12 }, () => 0);
  const dayCounts = new Map<string, number>();
  const placeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const moodCounts = new Map<string, number>();
  const tripEnds = new Map<string, string>(); // trip name → latest timestamp
  let entriesWithPhotos = 0;
  let photoCount = 0;
  let wordCount = 0;

  for (const e of ordered) {
    entriesPerMonth[new Date(e.timestamp).getMonth()]++;

    const dayKey = getDayKey(e.timestamp);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);

    bump(placeCounts, e.location_name);
    // One entry tagged `alps` twice must still count once for `alps`.
    for (const tag of new Set(e.tags.map((t) => t.trim()).filter(Boolean))) {
      bump(tagCounts, tag);
    }

    const tripName = e.trip?.trim();
    if (tripName) {
      const prev = tripEnds.get(tripName);
      if (!prev || e.timestamp > prev) tripEnds.set(tripName, e.timestamp);
    }

    const photos = photosOf(e);
    photoCount += photos;
    if (photos > 0) entriesWithPhotos++;

    if (e.type === 'journal') {
      bump(moodCounts, e.mood);
      wordCount += e.content_markdown.split(/\s+/).filter(Boolean).length;
    }
  }

  // Only real pins take part in the route: including the `0,0` sentinel would
  // add two ~5000 km legs through Null Island for every unlocated entry.
  const located = ordered.filter(isLocated);
  let distanceKm = 0;
  for (let i = 1; i < located.length; i++) {
    distanceKm += haversineKm(
      [located[i - 1].longitude, located[i - 1].latitude],
      [located[i].longitude, located[i].latitude],
    );
  }

  const ordinals = [...dayCounts.keys()].map(dayOrdinal).sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  let prev: number | null = null;
  for (const o of ordinals) {
    run = prev !== null && o === prev + 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prev = o;
  }

  let busiestDay: { dayKey: string; count: number } | null = null;
  for (const [dayKey, count] of dayCounts) {
    // Strict `>` over an ascending-by-time insertion order: a tie keeps the
    // earlier day rather than flipping with input order.
    if (!busiestDay || count > busiestDay.count) busiestDay = { dayKey, count };
  }

  return {
    year,
    totalEntries: ordered.length,
    entriesPerMonth,
    daysJournaled: dayCounts.size,
    longestStreak,
    distanceKm,
    topPlaces: rank(placeCounts),
    topTags: rank(tagCounts),
    moods: rank(moodCounts),
    trips: [...tripEnds.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name),
    entriesWithPhotos,
    photoCount,
    wordCount,
    located,
    busiestDay,
    firstEntry: ordered.length ? ordered[0].timestamp : null,
    lastEntry: ordered.length ? ordered[ordered.length - 1].timestamp : null,
  };
}
