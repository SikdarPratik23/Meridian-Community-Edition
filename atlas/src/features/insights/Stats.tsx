import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import Presence from '../../components/ui/Presence';
import { useFrozen } from '../../hooks/useFrozen';
import { useCountUp } from '../../hooks/useCountUp';
import { stagger } from '../../utils/motion';
import type { AnyEvent } from '../../types';

/** How long the one-shot streak flare (M29) plays before its class is dropped —
 *  a fixed duration matching the CSS animation's own, same accepted convention
 *  as `ToastHost`'s `EXIT_MS` and `<AsyncButton>`'s `CHECK_DRAW_MS` (Known Issue
 *  #20): not scaled by `--mo-dur`, since the gap that leaves at Reduced/Off is
 *  imperceptible and not worth a dynamic per-call calculation. */
const FLARE_MS = 950;

/** Integer day number for a date in local time — stable per calendar day, so
 *  consecutive days differ by exactly 1 (used for streak maths). */
function dayOrdinal(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

/** Entries per day for the last `days` days (oldest → newest), for the sparkline. */
function dailyCounts(events: AnyEvent[], days: number): { date: Date; count: number }[] {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const buckets = Array.from({ length: days }, (_, i) => ({
    date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    count: 0,
  }));
  const startMs = start.getTime();
  for (const e of events) {
    const t = new Date(e.timestamp);
    const idx = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - startMs) / 86_400_000);
    if (idx >= 0 && idx < days) buckets[idx].count++;
  }
  return buckets;
}

/** A tiny inline bar chart of recent journaling activity — makes the streak feel
 *  earned and shows momentum at a glance. Pure CSS bars, no chart library. */
function Sparkline({ data }: { data: { date: Date; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-7 items-end gap-px">
      {data.map((d, i) => {
        const pct = d.count === 0 ? 8 : Math.max(22, Math.round((d.count / max) * 100));
        return (
          <div
            key={i}
            title={`${d.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${d.count} ${d.count === 1 ? 'entry' : 'entries'}`}
            className="flex h-full flex-1 items-end rounded-sm bg-terracotta/10"
          >
            {/* M24: grows in from the baseline (scaleY, never height) once on
                mount, staggered left to right; a later count change just
                updates the height directly with no transition. */}
            <div
              className="mo-bar-grow w-full rounded-sm bg-terracotta"
              style={{ height: `${pct}%`, opacity: d.count === 0 ? 0.25 : 1, ...stagger(i) }}
            />
          </div>
        );
      })}
    </div>
  );
}

function computeStats(events: AnyEvent[]) {
  const days = new Set<number>();
  const places = new Set<string>();
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  let monthCount = 0;

  for (const e of events) {
    const d = new Date(e.timestamp);
    days.add(dayOrdinal(d));
    if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) monthCount++;
    if (hasLocation(e)) {
      places.add(e.location_name?.trim() || `${e.latitude.toFixed(3)},${e.longitude.toFixed(3)}`);
    }
  }

  // Current streak: consecutive days back from today (or yesterday, so a day not
  // yet journaled doesn't read as a broken streak until it's actually missed).
  const today = dayOrdinal(now);
  let current = 0;
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  while (cursor !== null && days.has(cursor)) { current++; cursor--; }

  // Longest streak ever.
  const sorted = [...days].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const o of sorted) {
    run = prev !== null && o === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = o;
  }

  return { total: events.length, current, longest, places: places.size, monthCount };
}

/** M23: every figure here counts up rather than rendering at its final value —
 *  from zero on first mount, from its previous value on every change after
 *  that (see `useCountUp`'s own doc comment). */
function Stat({ icon, value, label }: { icon: string; value: number; label: string }) {
  const display = useCountUp(value);
  return (
    <div className="flex flex-col items-center rounded-md border border-transparent bg-surface px-2 py-2 text-center transition hover:-translate-y-0.5 hover:border-water hover:shadow-sm">
      <span className="text-base leading-none">{icon}</span>
      <span className="mt-1 text-lg font-bold leading-none text-ink u-numeric">{display.toLocaleString()}</span>
      <span className="mt-0.5 text-[10px] font-medium leading-tight text-ink/55">{label}</span>
    </div>
  );
}

/**
 * A compact stats card — journaling streak, totals, and places — to make the app
 * feel alive rather than blank. Sits with the other insight cards (calendar,
 * on-this-day). Renders nothing until there's at least one entry.
 */
export default function Stats({ className = '' }: { className?: string }) {
  const events = useAtlasStore((s) => s.events);
  const setYearReviewOpen = useAtlasStore((s) => s.setYearReviewOpen);
  const stats = useMemo(() => computeStats(events), [events]);
  const spark = useMemo(() => dailyCounts(events, 21), [events]);

  // Presence needs something to render for `exitMs` after `total` hits 0 (the
  // last entry got deleted) — freeze the last non-empty snapshot rather than
  // let the card's own numbers jump to zero mid-fade-out.
  const display = useFrozen({ stats, spark }, stats.total > 0);
  const currentStreak = display.stats.current;
  const streakDisplay = useCountUp(currentStreak);

  // M29: a one-shot brighter flare over the flicker loop when the streak
  // VALUE increases — not `useFrozen` (§3.6c candidate the plan itself named):
  // that hook freezes a value while a `keep` flag holds, which answers "what
  // was it right before it went away", not "did it just go up". A plain ref
  // tracking the previous streak is the whole job; `null` on first mount so
  // the flare never fires just because a card with an existing streak
  // happened to render for the first time in this session.
  const prevStreakRef = useRef<number | null>(null);
  const [flaring, setFlaring] = useState(false);
  useEffect(() => {
    const prev = prevStreakRef.current;
    prevStreakRef.current = currentStreak;
    if (prev === null || currentStreak <= prev) return;
    setFlaring(true);
    const t = setTimeout(() => setFlaring(false), FLARE_MS);
    return () => clearTimeout(t);
  }, [currentStreak]);

  return (
    <Presence when={stats.total > 0} exitMs={200} enterClassName="animate-card-in" exitClassName="mo-fade-out" className={className}>
      <div className="panel-frost rounded-lg border border-water p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">Your journal</span>
          {currentStreak > 0 && (
            <span className="text-[11px] font-semibold text-terracotta" title={`Longest streak: ${display.stats.longest} days`}>
              <span className={`animate-flame${flaring ? ' flame-flare' : ''}`}>🔥</span> {streakDisplay}-day streak
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5 bg-land/60 rounded-md p-1.5">
          <Stat icon="📓" value={display.stats.total} label={display.stats.total === 1 ? 'entry' : 'entries'} />
          <Stat icon="📅" value={display.stats.monthCount} label="this month" />
          <Stat icon="📍" value={display.stats.places} label={display.stats.places === 1 ? 'place' : 'places'} />
          <Stat icon="🏆" value={display.stats.longest} label="best streak" />
        </div>

        {/* Recent activity — the last three weeks of journaling at a glance. */}
        <div className="mt-2">
          <Sparkline data={display.spark} />
          <div className="mt-1 flex justify-between text-[9px] text-ink/40">
            <span>3 weeks ago</span>
            <span>today</span>
          </div>
        </div>

        {/* The retrospective lives behind this card because that's where someone
            already looking at their own numbers would go next. */}
        <button
          type="button"
          onClick={() => setYearReviewOpen(true)}
          className="mt-2.5 w-full rounded-md border border-water py-1.5 text-[11px] text-ink/60 transition-colors hover:bg-land hover:text-ink"
        >
          🗓 Year in review →
        </button>
      </div>
    </Presence>
  );
}
