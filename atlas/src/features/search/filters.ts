/**
 * Search filtering — the logic behind the search panel's chips.
 *
 * Kept as a pure module (no React, no store) for two reasons: the combination of
 * text + spatial + attribute filters is the kind of thing that quietly goes wrong
 * at the edges, and it's much easier to be confident about when it can be tested
 * directly. `SearchView` owns the chips; this owns what they mean.
 *
 * Filters COMBINE with AND — each chip narrows the result set further. That's the
 * behaviour people expect from a filter bar, and it means an empty result is
 * always explainable by pointing at the chips that are lit.
 */
import type { AnyEvent, JournalEntry, MediaAttachment } from '../../types';
import { getDayKey, haversineKm } from '../../utils';

export interface SearchFilters {
  /** Free text, matched against title, body, place name and tags. */
  query: string;
  /** Only entries with at least one image attachment. */
  hasPhoto: boolean;
  /** Only entries with at least one audio attachment. */
  hasAudio: boolean;
  /** Only entries with a real pin (not the `0,0` unlocated sentinel). */
  hasLocation: boolean;
  /** Exact mood match, or null for any. */
  mood: string | null;
  /** Exact trip-name match, or null for any. */
  trip: string | null;
  /** Inclusive date range as `YYYY-MM-DD` day keys, or null for open-ended. */
  from: string | null;
  to: string | null;
  /** Restrict to `radiusKm` around a centre point supplied by the caller. */
  nearMe: boolean;
  radiusKm: number;
}

export interface SearchResult {
  event: AnyEvent;
  /** Distance from the search centre, when one is known and the entry is located. */
  distanceKm: number | null;
}

export const DEFAULT_RADIUS_KM = 5;
/** The radius chips offered in the UI. */
export const RADIUS_OPTIONS = [1, 5, 10, 25, 50];

export const EMPTY_FILTERS: SearchFilters = {
  query: '',
  hasPhoto: false,
  hasAudio: false,
  hasLocation: false,
  mood: null,
  trip: null,
  from: null,
  to: null,
  nearMe: false,
  radiusKm: DEFAULT_RADIUS_KM,
};

function mediaOf(event: AnyEvent): MediaAttachment[] {
  return 'media_attachments' in event && Array.isArray(event.media_attachments)
    ? event.media_attachments
    : [];
}

function bodyOf(event: AnyEvent): string {
  return event.type === 'journal' ? ((event as JournalEntry).content_markdown ?? '') : '';
}

function isLocated(event: AnyEvent): boolean {
  return !(event.longitude === 0 && event.latitude === 0);
}

/**
 * How many filters are narrowing the results. Drives the "N filters" badge and
 * the enabled state of "Clear all". `radiusKm` alone doesn't count — it only
 * means anything while `nearMe` is on.
 */
export function activeFilterCount(filters: SearchFilters): number {
  let n = 0;
  if (filters.query.trim()) n += 1;
  if (filters.hasPhoto) n += 1;
  if (filters.hasAudio) n += 1;
  if (filters.hasLocation) n += 1;
  if (filters.mood) n += 1;
  if (filters.trip) n += 1;
  if (filters.from) n += 1;
  if (filters.to) n += 1;
  if (filters.nearMe) n += 1;
  return n;
}

/** True when anything is filtering. An inactive search shows no results at all
 *  (rather than the whole journal), which is what the timeline is for. */
export function isFilterActive(filters: SearchFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/** Does the entry's text match this query? Case-insensitive substring search
 *  across the fields a person would expect to search. */
export function matchesQuery(event: AnyEvent, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    event.title.toLowerCase().includes(q) ||
    (event.location_name?.toLowerCase().includes(q) ?? false) ||
    (event.trip?.toLowerCase().includes(q) ?? false) ||
    event.tags.some((tag) => tag.toLowerCase().includes(q)) ||
    bodyOf(event).toLowerCase().includes(q)
  );
}

/**
 * Apply every active filter and return the surviving entries.
 *
 * `center` is the point "Near me" measures from — the caller decides whether
 * that's the GPS fix or the map centre. When `nearMe` is on but no centre is
 * known, the spatial filter is SKIPPED rather than returning nothing: silently
 * showing zero results would look like a bug to the user.
 *
 * Results are sorted nearest-first when the spatial filter is active, and
 * newest-first otherwise.
 */
export function applyFilters(
  events: AnyEvent[],
  filters: SearchFilters,
  center: [number, number] | null,
): SearchResult[] {
  if (!isFilterActive(filters)) return [];

  const spatial = filters.nearMe && center != null;

  const results: SearchResult[] = [];
  for (const event of events) {
    if (event.deleted_at) continue;
    if (!matchesQuery(event, filters.query)) continue;

    const media = mediaOf(event);
    if (filters.hasPhoto && !media.some((a) => a.kind === 'image')) continue;
    if (filters.hasAudio && !media.some((a) => a.kind === 'audio')) continue;
    if (filters.hasLocation && !isLocated(event)) continue;

    if (filters.mood) {
      const mood = event.type === 'journal' ? (event as JournalEntry).mood : undefined;
      if (mood !== filters.mood) continue;
    }
    if (filters.trip && event.trip?.trim() !== filters.trip) continue;

    // Day keys are `YYYY-MM-DD`, so a lexicographic compare is also a date
    // compare — and it uses the entry's LOCAL day, matching the timeline.
    if (filters.from || filters.to) {
      const day = getDayKey(event.timestamp);
      if (filters.from && day < filters.from) continue;
      if (filters.to && day > filters.to) continue;
    }

    const distanceKm =
      center && isLocated(event) ? haversineKm(center, [event.longitude, event.latitude]) : null;

    if (spatial && (distanceKm == null || distanceKm > filters.radiusKm)) continue;

    results.push({ event, distanceKm });
  }

  results.sort((a, b) =>
    spatial
      ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
      : b.event.timestamp.localeCompare(a.event.timestamp),
  );
  return results;
}

/** The distinct moods in use, alphabetically — for the mood chip's options. */
export function availableMoods(events: AnyEvent[]): string[] {
  const moods = new Set<string>();
  for (const event of events) {
    if (event.deleted_at || event.type !== 'journal') continue;
    const mood = (event as JournalEntry).mood?.trim();
    if (mood) moods.add(mood);
  }
  return [...moods].sort((a, b) => a.localeCompare(b));
}

/** The distinct tags in use, most-used first then alphabetically. */
export function availableTags(events: AnyEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.deleted_at) continue;
    for (const tag of event.tags) {
      const clean = tag.trim();
      if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}
