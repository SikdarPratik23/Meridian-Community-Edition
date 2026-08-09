/**
 * Public-holiday lookup for the calendar, powered by the offline `date-holidays`
 * library (no network, no API key — the rules are bundled). Which region's
 * holidays to show is decided by the calendar/settings: either auto-detected
 * from where you journal (see useHolidays) or set by hand in Settings.
 *
 * The library is a fair chunk of data, so it's loaded lazily on first use and
 * each (country, state, year) result is memoised — opening the calendar costs
 * one import the first time and nothing thereafter.
 */

// date-holidays ships its own (loose) types; we narrow to what we use.
interface HolidayItem { date: string; name: string; type: string }
interface HolidaysInstance { getHolidays(year: number): HolidayItem[] }
interface HolidaysCtor {
  new (country?: string, state?: string): HolidaysInstance & {
    getCountries(lang?: string): Record<string, string>;
    getStates(country: string, lang?: string): Record<string, string> | undefined;
  };
}

let libPromise: Promise<HolidaysCtor> | null = null;
function lib(): Promise<HolidaysCtor> {
  if (!libPromise) {
    libPromise = import('date-holidays').then(
      (m) => (m.default ?? m) as unknown as HolidaysCtor,
    );
  }
  return libPromise;
}

export interface DayHoliday {
  name: string;
  /** 'public' | 'bank' | 'optional' — public ones are emphasised most. */
  type: string;
}

/** Which holiday kinds to surface. Observances (Valentine's, etc.) and
 *  school-only days are intentionally excluded to keep the calendar uncluttered. */
const SHOWN_TYPES = new Set(['public', 'bank', 'optional']);

// (country|state|year) → (dayKey → holidays). dayKey matches CalendarHeatmap's
// `${year}-${monthIndex}-${day}` (month is 0-based there).
const cache = new Map<string, Map<string, DayHoliday[]>>();

/** Holidays for a region and year, keyed by the calendar's own day key. */
export async function holidaysForYear(
  country: string,
  state: string | undefined,
  year: number,
): Promise<Map<string, DayHoliday[]>> {
  const cacheKey = `${country}|${state ?? ''}|${year}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const Holidays = await lib();
  let inst: HolidaysInstance;
  try {
    inst = state ? new Holidays(country, state) : new Holidays(country);
  } catch {
    // A bad/unsupported state code shouldn't lose the country's holidays.
    inst = new Holidays(country);
  }

  const map = new Map<string, DayHoliday[]>();
  for (const h of inst.getHolidays(year) ?? []) {
    if (!SHOWN_TYPES.has(h.type)) continue;
    const ymd = String(h.date).slice(0, 10); // "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DD"
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) continue;
    const key = `${y}-${m - 1}-${d}`;
    const arr = map.get(key);
    if (arr) arr.push({ name: h.name, type: h.type });
    else map.set(key, [{ name: h.name, type: h.type }]);
  }

  cache.set(cacheKey, map);
  return map;
}

/** All supported countries as { CODE: "Name" }, for the Settings picker. */
export async function listCountries(): Promise<Record<string, string>> {
  const Holidays = await lib();
  return new Holidays().getCountries('en');
}

/** Subdivisions for a country (e.g. German Bundesländer), or null if none. */
export async function listStates(country: string): Promise<Record<string, string> | null> {
  const Holidays = await lib();
  try {
    return new Holidays().getStates(country, 'en') ?? null;
  } catch {
    return null;
  }
}
