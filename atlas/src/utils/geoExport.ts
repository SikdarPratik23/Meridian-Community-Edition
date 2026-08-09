import type { AnyEvent, JournalEntry } from '../types';

/**
 * Export located entries to GIS formats. Meridian stores coordinates as
 * `[longitude, latitude]` (GeoJSON / EPSG:4326) already, so GeoJSON is a near
 * pass-through; GPX is generated for Google Earth / handheld GPS tools.
 *
 * Unlocated entries (the `0,0` sentinel Meridian uses when no pin is set) are
 * skipped — a point at Null Island would be misleading in a GIS. Callers can
 * check `locatedCount` first to tell the user how many will be included.
 */

/** True when an entry has a real pin (not the unset `0,0` sentinel). */
export function isLocated(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

/** How many of these entries carry a real location (and so will export). */
export function locatedCount(events: AnyEvent[]): number {
  return events.filter(isLocated).length;
}

/** Escape the five XML-significant characters for safe GPX text nodes. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a GeoJSON FeatureCollection from located entries. Each feature is a
 * Point with the entry's metadata as properties (the Markdown body is included
 * for journal entries so notes survive the round-trip into a GIS).
 */
export function toGeoJSON(events: AnyEvent[]): string {
  const features = events.filter(isLocated).map((e) => {
    const props: Record<string, unknown> = {
      id: e.id,
      type: e.type,
      title: e.title,
      timestamp: e.timestamp,
      location_name: e.location_name ?? null,
      tags: e.tags,
    };
    if (e.type === 'journal') {
      const j = e as JournalEntry;
      props.content = j.content_markdown;
      props.mood = j.mood ?? null;
      props.weather = j.weather_condition ?? null;
      props.temperature_c = j.weather_temperature ?? null;
    }
    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.longitude, e.latitude] },
      properties: props,
    };
  });
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

/**
 * Build a GPX 1.1 document of located entries as waypoints (`<wpt>`), ordered
 * by time. `name` is the entry title, `time` its timestamp, and `desc` carries
 * the place name plus (for journal entries) the note body.
 */
export function toGPX(events: AnyEvent[]): string {
  const located = events
    .filter(isLocated)
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const wpts = located
    .map((e) => {
      const descParts: string[] = [];
      if (e.location_name) descParts.push(e.location_name);
      if (e.type === 'journal') {
        const body = (e as JournalEntry).content_markdown?.trim();
        if (body) descParts.push(body);
      }
      const desc = descParts.join('\n\n');
      return [
        `  <wpt lat="${e.latitude}" lon="${e.longitude}">`,
        `    <time>${xmlEscape(e.timestamp)}</time>`,
        `    <name>${xmlEscape(e.title)}</name>`,
        desc ? `    <desc>${xmlEscape(desc)}</desc>` : '',
        `  </wpt>`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Meridian" xmlns="http://www.topografix.com/GPX/1/1">',
    wpts,
    '</gpx>',
    '',
  ].join('\n');
}
