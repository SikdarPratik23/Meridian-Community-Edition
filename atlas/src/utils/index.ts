export function generateId(): string {
  // `crypto.randomUUID()` only exists in a secure context (HTTPS or localhost).
  // On a phone reaching the app over plain `http://192.168.x.x` it's undefined —
  // exactly the LAN case the sync feature targets — so fall back to a v4 UUID
  // built from `getRandomValues` (available in non-secure contexts), and finally
  // to a non-crypto id so saving an entry can never throw.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  return `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/**
 * True when an entry's title is just its auto-generated date (i.e. the user
 * never gave it a custom name). The editor titles a nameless entry by its date
 * (`formatDate(happenedAt)`), so this mirrors that check. Used to avoid repeating
 * the date where it's already shown (day headers) and lead with the time instead.
 */
export function isDateTitle(title: string, iso: string): boolean {
  return title === formatDate(iso);
}

export function getMonthGroup(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export function getYearGroup(iso: string): string {
  return new Date(iso).getFullYear().toString();
}

/**
 * Stable local-calendar-day key (`YYYY-MM-DD`) used to gather every entry made
 * on the same day into one group. Built from the *local* date parts (not the UTC
 * ISO prefix) so an entry made at 11pm doesn't land on the next day's bucket.
 */
export function getDayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Human label for a day group within a month, e.g. `Thursday 26`. The month is
 *  already shown in the parent header, so this stays short. */
export function getDayGroup(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric' });
}

/** Full day label, e.g. `Thursday, 26 June 2026` — for the day-detail header. */
export function formatFullDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Great-circle distance between two [lon, lat] points, in kilometres. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371; // mean Earth radius, km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A compact distance label: metres under 1 km, else km with one decimal. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

import { useSettings, type CoordFormat, type TempUnit } from '../store/settings';

/** Format a Celsius temperature in the user's unit, e.g. `18°C` or `64°F`. */
export function formatTemperature(celsius: number, unit?: TempUnit): string {
  const u = unit ?? useSettings.getState().tempUnit;
  const value = u === 'F' ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°${u}`;
}

/** One axis as degrees/minutes/seconds, e.g. `49°27′08″ N`. */
function toDMS(value: number, positive: string, negative: string): string {
  const dir = value >= 0 ? positive : negative;
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = Math.round((abs - deg - min / 60) * 3600);
  if (sec === 60) { sec = 0; min += 1; }
  if (min === 60) { min = 0; deg += 1; }
  return `${deg}°${String(min).padStart(2, '0')}′${String(sec).padStart(2, '0')}″ ${dir}`;
}

/**
 * Format coordinates the way a geographer reads them. Internally we always keep
 * the GeoJSON [longitude, latitude] convention; this is display-only. The format
 * follows the user's setting (decimal degrees or DMS) unless one is passed in:
 *   - decimal: `49.4521° N, 11.0767° E`
 *   - dms:     `49°27′08″ N, 11°04′36″ E`
 */
export function formatLatLng(longitude: number, latitude: number, format?: CoordFormat): string {
  const fmt = format ?? useSettings.getState().coordFormat;
  if (fmt === 'dms') {
    return `${toDMS(latitude, 'N', 'S')}, ${toDMS(longitude, 'E', 'W')}`;
  }
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lng}`;
}
