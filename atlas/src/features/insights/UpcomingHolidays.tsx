import { useEffect, useMemo, useState } from 'react';
import { useHolidays } from './useHolidays';
import { holidaysForYear, type DayHoliday } from './holidays';

/**
 * A welcome-screen card that answers "is anything happening around me right now?"
 * from the SAME offline `date-holidays` data the calendar uses (no network, no
 * API key). It surfaces today's holiday/festival for your detected region and a
 * short "coming up" list — so the home screen carries a little current-affairs
 * flavour keyed to WHERE YOU ARE, not just static almanac facts.
 *
 * Region comes from `useHolidays` (manual Settings choice → else auto-detected
 * from your entries/GPS). With location/online-lookups off there's no region, so
 * the card simply doesn't render — consistent with the offline-first design.
 *
 * NOTE on scope: this covers holidays/observances (which capture the major
 * festivals in most countries — Diwali, Christmas, Eid, etc.). Live one-off local
 * events (a concert, a market) would need an online events source and aren't part
 * of this offline card.
 */

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 45; // how far ahead "coming up" looks

interface Upcoming { name: string; type: string; inDays: number }

/** Calendar keys are `${year}-${monthIndex0}-${day}` (see holidays.ts). */
function keyToDate(key: string): Date | null {
  const [y, m0, d] = key.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m0) || !Number.isFinite(d)) return null;
  return new Date(y, m0, d);
}

function scan(map: Map<string, DayHoliday[]>, midnight: number, out: Upcoming[]) {
  for (const [key, list] of map) {
    const dt = keyToDate(key);
    if (!dt) continue;
    const inDays = Math.round((dt.getTime() - midnight) / DAY_MS);
    if (inDays < 0 || inDays > WINDOW_DAYS) continue;
    for (const h of list) out.push({ name: h.name, type: h.type, inDays });
  }
}

export default function UpcomingHolidays({ className = '' }: { className?: string }) {
  const now = new Date();
  const year = now.getFullYear();
  const { holidays, region } = useHolidays(year);
  const [nextYearMap, setNextYearMap] = useState<Map<string, DayHoliday[]>>(() => new Map());

  // Near year-end the 45-day window spills into January, so pull next year's
  // holidays too — otherwise "coming up" goes blank every December.
  const needNextYear = useMemo(
    () => Math.round((new Date(year, 11, 31).getTime() - now.getTime()) / DAY_MS) <= WINDOW_DAYS,
    [year], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    // Only fetch when the window actually spills into next year. A stale map from
    // a previous region is never read while `needNextYear` is false, and a region
    // change re-runs this and overwrites it (holidaysForYear is memoised).
    if (!region.country || !needNextYear) return;
    let alive = true;
    void holidaysForYear(region.country, region.state, year + 1).then((m) => { if (alive) setNextYearMap(m); });
    return () => { alive = false; };
  }, [region.country, region.state, year, needNextYear]);

  const items = useMemo(() => {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: Upcoming[] = [];
    scan(holidays, midnight, out);
    if (needNextYear) scan(nextYearMap, midnight, out);
    out.sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
    // Collapse duplicates (a day can carry the same name in overlapping regions).
    const seen = new Set<string>();
    return out.filter((u) => {
      const k = `${u.inDays}|${u.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidays, nextYearMap, needNextYear]);

  // No region resolved (location off / lookups disabled) → nothing to show.
  if (region.source === 'none') return null;

  const today = items.filter((u) => u.inDays === 0);
  const soon = items.filter((u) => u.inDays > 0).slice(0, 3);
  const regionLabel = region.state ? `${region.country} · ${region.state}` : region.country;

  return (
    <div className={`welcome-card rounded-lg border border-water p-3 animate-card-in [animation-delay:200ms] ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">Holidays &amp; festivals</span>
        <span className="shrink-0 text-[10px] text-ink/35" title="Region used for holidays">{regionLabel}</span>
      </div>

      {today.length > 0 && (
        <p className="font-serif text-sm font-medium text-ink/80 leading-relaxed">
          🎉 Today — {today.map((t) => t.name).join(', ')}
        </p>
      )}

      {soon.length > 0 ? (
        <ul className={`space-y-0.5 text-sm text-ink/60 ${today.length ? 'mt-1.5' : ''}`}>
          {soon.map((u) => (
            <li key={`${u.inDays}-${u.name}`} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{u.name}</span>
              <span className="shrink-0 text-[11px] text-ink/40">
                {u.inDays === 1 ? 'tomorrow' : `in ${u.inDays} days`}
              </span>
            </li>
          ))}
        </ul>
      ) : today.length === 0 ? (
        <p className="text-sm text-ink/50 leading-relaxed">Nothing marked in the next {WINDOW_DAYS} days here.</p>
      ) : null}
    </div>
  );
}
