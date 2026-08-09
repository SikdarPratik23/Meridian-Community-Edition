import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../store/settings';
import { useAtlasStore } from '../../store/atlas';
import { reverseGeocodeRegion, getCurrentPosition } from '../welcome/locationInfo';
import { holidaysForYear, type DayHoliday } from './holidays';
import type { AnyEvent } from '../../types';

/** Where the region came from — surfaced in Settings so the user can tell
 *  whether holidays are auto-detected or set by hand. */
export type HolidaySource = 'manual' | 'auto' | 'none';

export interface HolidayRegion {
  country: string;
  state?: string;
  source: HolidaySource;
}

// Auto-detected region, cached so we geocode at most once per device.
const CC_KEY = 'meridian_holiday_region';

// Shared "no holidays" result, so the no-region path returns a stable reference.
const EMPTY: Map<string, DayHoliday[]> = new Map();

function loadCached(): { country: string; state?: string } | null {
  try {
    const raw = localStorage.getItem(CC_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // Require a non-empty country. A cached `{ country: '' }` (from an older
    // build or a bad geocode) used to count as "resolved", which both yielded
    // an empty holiday map AND blocked re-detection forever. Reject it and drop
    // it so auto-detect runs again and self-heals.
    if (v && typeof v.country === 'string' && v.country) return v;
    localStorage.removeItem(CC_KEY);
    return null;
  } catch {
    return null;
  }
}

function saveCached(r: { country: string; state?: string }) {
  if (!r.country) return; // never cache an empty country
  try { localStorage.setItem(CC_KEY, JSON.stringify(r)); } catch { /* non-fatal */ }
}

/** The region auto-detected from your entries, if any — for showing in Settings
 *  what "Auto-detect" currently resolves to. */
export function detectedRegion(): { country: string; state?: string } | null {
  return loadCached();
}

/** 0,0 ("null island") means the entry was saved without a real location. */
function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

/**
 * Resolve which region's holidays to show, then load that year's holidays.
 *
 * Region precedence:
 *   1. A country set by hand in Settings (with an optional state) — wins always.
 *   2. A previously auto-detected region cached on this device.
 *   3. Auto-detect from your most recent *located* entry (one geocode, cached),
 *      so we use where you actually journal without prompting for GPS again.
 *
 * Detection only runs when online lookups are enabled; otherwise it stays 'none'
 * and the calendar simply shows no holidays.
 */
export function useHolidays(year: number): {
  holidays: Map<string, DayHoliday[]>;
  region: HolidayRegion;
} {
  const manualCountry = useSettings((s) => s.holidayCountry);
  const manualState = useSettings((s) => s.holidayState);
  const onlineLookups = useSettings((s) => s.onlineLookups);
  const events = useAtlasStore((s) => s.events);

  const [auto, setAuto] = useState<{ country: string; state?: string } | null>(loadCached);
  const [holidays, setHolidays] = useState<Map<string, DayHoliday[]>>(EMPTY);
  const detecting = useRef(false);

  // Effective region: manual override first, else auto-detected. Guard on a
  // *non-empty* country at each step so a blank value can't masquerade as a
  // resolved region (which would suppress the "set a country" hint and show
  // nothing at all).
  const region: HolidayRegion = manualCountry
    ? { country: manualCountry, state: manualState || undefined, source: 'manual' }
    : auto?.country
      ? { country: auto.country, state: auto.state, source: 'auto' }
      : { country: '', source: 'none' };

  // Auto-detect once: prefer the newest located entry, then fall back to the
  // device's own location. The fallback is what makes holidays appear with no
  // setup on a device that has no entries (e.g. a phone you only view on) — the
  // earlier entries-only version silently did nothing there.
  useEffect(() => {
    if (manualCountry || auto || detecting.current || !onlineLookups) return;
    detecting.current = true;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const located = events.find(hasLocation);
        const coords = located
          ? { lat: located.latitude, lon: located.longitude }
          : await getCurrentPosition();
        if (coords) {
          const r = await reverseGeocodeRegion(coords.lat, coords.lon, ctrl.signal);
          if (r) { saveCached(r); setAuto(r); }
        }
      } finally {
        detecting.current = false;
      }
    })();
    return () => ctrl.abort();
  }, [manualCountry, auto, onlineLookups, events]);

  // Load (and memoise) the holidays for the effective region + year. We never
  // clear state synchronously here — when there's no region we just return the
  // shared empty map below, so a stale region's holidays can't show.
  useEffect(() => {
    if (!region.country) return;
    let alive = true;
    void holidaysForYear(region.country, region.state, year).then((m) => {
      if (alive) setHolidays(m);
    });
    return () => { alive = false; };
  }, [region.country, region.state, year]);

  return { holidays: region.country ? holidays : EMPTY, region };
}
