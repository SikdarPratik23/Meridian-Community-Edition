/**
 * Turn coordinates into a human place name + a short blurb and photo, using the
 * same public sources the map already relies on:
 *   - reverse geocoding via BigDataCloud's keyless client endpoint (place name)
 *   - Wikipedia geosearch + REST summary (a 1–2 line description and a thumbnail)
 *
 * These are read-only lookups; only the approximate coordinates are sent. Every
 * call fails soft (returns null) so the welcome screen degrades to coordinates
 * when offline or blocked — nothing here is required for the app to work.
 */

import { pickFresh } from '../../utils/pickFresh';

export interface NearbyInfo {
  title: string;
  extract: string;
  thumbnail?: string;
  url: string;
}

/** Keep the first `max` sentences of a blurb (and cap the length). */
function trimSentences(text: string, max = 2): string {
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  const joined = sentences ? sentences.slice(0, max).join(' ').trim() : text;
  return joined.length > 220 ? joined.slice(0, 217).trimEnd() + '…' : joined;
}

/**
 * Reverse-geocode to a readable label.
 *   - 'full'     → "Erlangen, Bavaria, Germany" (welcome screen)
 *   - 'locality' → "Erlangen" (concise, for an entry's place name)
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
  mode: 'full' | 'locality' = 'full',
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal },
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (mode === 'locality') {
      return d.locality || d.city || d.principalSubdivision || d.countryName || null;
    }
    const parts = [d.locality || d.city, d.principalSubdivision, d.countryName].filter(
      (p: unknown): p is string => typeof p === 'string' && p.length > 0,
    );
    const unique = parts.filter((p, i) => parts.indexOf(p) === i);
    return unique.length ? unique.join(', ') : null;
  } catch {
    return null;
  }
}

/** Country + (when available) primary-subdivision code for a coordinate, e.g.
 *  { country: 'DE', state: 'BY' }. Used to pick which region's public holidays
 *  to mark on the calendar. Same keyless BigDataCloud endpoint as reverseGeocode;
 *  fails soft to null so holidays simply don't show when offline/blocked. */
export interface RegionCode {
  country: string;       // ISO-3166-1 alpha-2, e.g. "DE"
  state?: string;        // ISO-3166-2 subdivision suffix, e.g. "BY" (Bavaria)
}

/** The device's current location via the browser Geolocation API, or null if
 *  unavailable/denied/timed out. Resolves (never rejects) so callers can fall
 *  back cleanly. `maximumAge` lets it reuse a recent fix (e.g. the one the
 *  welcome screen already obtained) instead of forcing a fresh GPS lock. Needs
 *  a secure context (HTTPS); fine on the deployed app. */
export function getCurrentPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 600_000 },
    );
  });
}

export async function reverseGeocodeRegion(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<RegionCode | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal },
    );
    if (!res.ok) return null;
    const d = await res.json();
    const country = typeof d.countryCode === 'string' ? d.countryCode.toUpperCase() : null;
    if (!country) return null;
    // principalSubdivisionCode arrives as "DE-BY"; keep just the subdivision part.
    const sub = typeof d.principalSubdivisionCode === 'string' ? d.principalSubdivisionCode : '';
    const state = sub.includes('-') ? sub.split('-').pop()!.toUpperCase() : undefined;
    return { country, state: state || undefined };
  } catch {
    return null;
  }
}

export interface NearbyPlace {
  title: string;
  /** Distance from the query point, in kilometres. */
  km: number;
  url: string;
  /** The place's own coordinates — used to plot it on the map and compute its
   *  bearing from the user for the compass radar. */
  lat: number;
  lon: number;
}

/**
 * A list of notable places near a point, from Wikipedia geosearch (up to 50,
 * nearest first). Read-only — only the approximate coordinates are sent — and
 * fails soft to an empty list offline / when blocked. Powers the "Places of
 * interest nearby" welcome card.
 */
export async function nearbyPlacesOfInterest(
  lat: number,
  lon: number,
  radiusMeters = 10000,
  signal?: AbortSignal,
): Promise<NearbyPlace[]> {
  try {
    // Wikipedia geosearch requires gsradius in 10..10000 metres.
    const r = Math.max(10, Math.min(10000, Math.round(radiusMeters)));
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}` +
        `&gsradius=${r}&gslimit=50&format=json&origin=*`,
      { signal },
    );
    if (!res.ok) return [];
    const json = await res.json();
    const hits: { title?: string; dist?: number; lat?: number; lon?: number }[] =
      json?.query?.geosearch ?? [];
    return hits
      .filter((h): h is { title: string; dist: number; lat: number; lon: number } =>
        typeof h.title === 'string' && h.title.length > 0 && typeof h.dist === 'number' &&
        typeof h.lat === 'number' && typeof h.lon === 'number')
      .map((h) => ({
        title: h.title,
        km: h.dist / 1000,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
        lat: h.lat,
        lon: h.lon,
      }));
  } catch {
    return [];
  }
}

/**
 * Fetch the Wikipedia REST summary (a trimmed blurb + thumbnail + canonical URL)
 * for one article title. Read-only, fails soft to null. Used to hydrate a place
 * for the "Today's focus" card as it rotates through nearby articles.
 */
export async function placeSummary(
  title: string,
  signal?: AbortSignal,
): Promise<NearbyInfo | null> {
  try {
    const sumRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal },
    );
    if (!sumRes.ok) return null;
    const s = await sumRes.json();
    return {
      title: s.title || title,
      extract: trimSentences(s.extract || ''),
      thumbnail: s.thumbnail?.source,
      url: s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}

/**
 * Surface a notable place near the user from Wikipedia. We pull a list of nearby
 * articles and rotate through them across visits (via `pickFresh`), so it isn't
 * always the single closest one — there's something new to read each time.
 */
export async function nearbyPlaceInfo(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<NearbyInfo | null> {
  try {
    const geoRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}` +
        `&gsradius=10000&gslimit=20&format=json&origin=*`,
      { signal },
    );
    if (!geoRes.ok) return null;
    const geoJson = await geoRes.json();
    const titles: string[] = (geoJson?.query?.geosearch ?? [])
      .map((h: { title?: string }) => h.title)
      .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0);
    if (!titles.length) return null;

    // Rotate the featured place; bucket by a coarse location so a different area
    // gets its own rotation rather than sharing one global "seen" list.
    const bucket = `nearby:${lat.toFixed(1)},${lon.toFixed(1)}`;
    const title = pickFresh(bucket, titles) ?? titles[0];
    return placeSummary(title, signal);
  } catch {
    return null;
  }
}
