/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the pure `waveDelay` helper (tested standalone) alongside the default
   component, same pattern as Lightbox.tsx's `flipTransform`. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useHolidays } from './useHolidays';
import { useCountUp } from '../../hooks/useCountUp';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';
import type { AnyEvent } from '../../types';

// Monday-start week, to match the user's locale (Germany).
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** How long the outgoing month's slide-out plays before it stops rendering —
 *  matches `--mo-base` at full motion, same constant Sidebar.tsx (M12) uses
 *  for the same reason. */
const MONTH_SLIDE_MS = 260;

type Cell = { day: number; entries: AnyEvent[] } | null;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Shade a day cell by how many entries it holds. Darker empty-day text than
 *  before so the numbers stay readable without cranking screen brightness. */
function intensityClass(count: number): string {
  if (count <= 0) return 'bg-surface text-ink/70';
  if (count === 1) return 'bg-terracotta/30 text-ink';
  if (count <= 3) return 'bg-terracotta/60 text-white';
  return 'bg-terracotta text-white';
}

/** M26: the diagonal-wave entrance delay for the cell at flat index `i` in a
 *  7-column grid — `(row + col) * ~26ms`, scaled by `--mo-dur` the same way
 *  `stagger()` scales its own delay so Reduced/Off motion collapses it toward
 *  instant instead of leaving it stuck at full-motion timing. */
export function waveDelay(i: number): { animationDelay: string } {
  const row = Math.floor(i / 7);
  const col = i % 7;
  return { animationDelay: `calc(var(--mo-dur, 1) * ${(row + col) * 26}ms)` };
}

/**
 * A small month calendar where each day is shaded by how many entries it holds.
 * Navigate months with ‹ ›; clicking a day with entries opens that day's most
 * recent one (which also flies the map there). Pairs with the map as a temporal
 * counterpart to the spatial view.
 */
export default function CalendarHeatmap({ className = '' }: { className?: string }) {
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const today = new Date();
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  // The day tapped for an inline detail line (its holiday name + entry count).
  const [picked, setPicked] = useState<number | null>(null);
  const { holidays, region } = useHolidays(view.year);
  const motion = useEffectiveMotion();

  // M27: the outgoing month's grid, kept rendering (absolutely positioned,
  // sliding out) for MONTH_SLIDE_MS alongside the incoming one — the same
  // shape as Sidebar.tsx's `prevView` (M12/M13), reused here per the plan's
  // own instruction rather than inventing a second directional-pane pattern.
  const [prevGrid, setPrevGrid] = useState<{ year: number; month: number; cells: Cell[] } | null>(null);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const slideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { if (slideTimerRef.current) clearTimeout(slideTimerRef.current); }, []);

  // dayKey → entries that day. Events arrive newest-first, so entries[0] is the
  // most recent of its day.
  const byDay = useMemo(() => {
    const m = new Map<string, AnyEvent[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.timestamp));
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    return m;
  }, [events]);

  // Today's and this-week's (Mon–Sun) entry counts, for the summary line.
  const summary = useMemo(() => {
    const now = new Date();
    const todayCount = byDay.get(dayKey(now))?.length ?? 0;
    const dow = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
    const weekEnd = weekStart + 7 * 86_400_000;
    let weekCount = 0;
    for (const e of events) {
      const t = new Date(e.timestamp).getTime();
      if (t >= weekStart && t < weekEnd) weekCount++;
    }
    return { todayCount, weekCount };
  }, [events, byDay]);
  // M23: the summary line counts up rather than landing on its final value.
  const todayCountDisplay = useCountUp(summary.todayCount);
  const weekCountDisplay = useCountUp(summary.weekCount);

  const firstOfMonth = new Date(view.year, view.month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Mon=0 … Sun=6
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cells: Cell[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, entries: byDay.get(`${view.year}-${view.month}-${day}`) ?? [] });
  }

  const shiftMonth = (delta: number) => {
    // Snapshot the CURRENT (about-to-be-outgoing) month before switching, so it
    // can keep rendering — sliding out in the pressed direction — while the new
    // month slides in over it. Skipped when motion is off, same as Sidebar's
    // own navigate(): nothing to gain from the extra render/timer when the CSS
    // would collapse the slide to near-instant anyway.
    if (motion !== 'off') {
      setDirection(delta > 0 ? 'forward' : 'back');
      setPrevGrid({ year: view.year, month: view.month, cells });
      if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
      slideTimerRef.current = setTimeout(() => setPrevGrid(null), MONTH_SLIDE_MS);
    }
    const m = view.month + delta;
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 });
    setPicked(null);
  };
  const goToday = () => {
    setView({ year: today.getFullYear(), month: today.getMonth() });
    setPicked(null);
  };
  const isCurrentMonth = view.year === today.getFullYear() && view.month === today.getMonth();

  const holidayFor = (day: number) => holidays.get(`${view.year}-${view.month}-${day}`);
  const monthHasHoliday = cells.some((c) => c && holidayFor(c.day));

  // Tapping a day: toggle it off if it's already the picked one; otherwise select
  // it (replacing any previous pick) and open its entry if it has one.
  const onPick = (cell: { day: number; entries: AnyEvent[] }) => {
    if (picked === cell.day) { setPicked(null); return; }
    setPicked(cell.day);
    if (cell.entries[0]) selectEvent(cell.entries[0]);
  };

  const pickedHol = picked != null ? holidayFor(picked) : undefined;
  const pickedEntries = picked != null ? (byDay.get(`${view.year}-${view.month}-${picked}`)?.length ?? 0) : 0;
  const pickedLabel = picked != null
    ? new Date(view.year, view.month, picked).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

  // Builds one month's grid of day buttons. Shared by the live (incoming) grid
  // and, during a month-change, the outgoing snapshot rendered alongside it
  // (M27) — `live` gates everything specific to the CURRENT month: the picked
  // highlight, click-to-open, and M26's diagonal wave-in (an already-mounted
  // outgoing grid has no business re-playing its entrance while it leaves).
  const renderCells = (gridCells: Cell[], forYear: number, forMonth: number, live: boolean) =>
    gridCells.map((cell, i) => {
      if (cell === null) return <div key={i} />;
      const hol = holidays.get(`${forYear}-${forMonth}-${cell.day}`);
      const hasEntries = cell.entries.length > 0;
      const titleParts = [
        hasEntries ? `${cell.entries.length} ${cell.entries.length === 1 ? 'entry' : 'entries'}` : '',
        hol ? hol.map((h) => h.name).join(' · ') : '',
      ].filter(Boolean);
      const cellIsToday = forYear === today.getFullYear() && forMonth === today.getMonth() && cell.day === today.getDate();
      // Border priority: picked > today > holiday. Holidays get a solid
      // forest ring so they read clearly even on days that also have
      // entries (whose terracotta fill would otherwise hide them).
      const borderClass =
        live && picked === cell.day ? 'border-terracotta ring-1 ring-terracotta'
          : cellIsToday ? 'border-ink/50 ring-1 ring-ink/20'
          : hol ? 'border-forest ring-1 ring-forest/50'
          : 'border-transparent';
      // Fill: entry-count shading wins; a holiday with no entries gets a
      // clear green wash (was a barely-there /10 — invisible on phones).
      const fillClass = hasEntries
        ? intensityClass(cell.entries.length)
        : hol ? 'bg-forest/25 text-ink font-bold' : intensityClass(0);
      return (
        <button
          key={i}
          onClick={live ? () => onPick(cell) : undefined}
          title={titleParts.join(' — ') || undefined}
          className={`relative flex aspect-square items-center justify-center rounded border text-xs font-semibold ${live ? 'mo-cal-cell-in cursor-pointer transition hover:-translate-y-px hover:ring-1 hover:ring-terracotta' : ''} ${borderClass} ${fillClass}`}
          style={live ? waveDelay(i) : undefined}
        >
          {cell.day}
          {hol && (
            <span className="absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-forest ring-1 ring-surface" />
          )}
        </button>
      );
    });

  return (
    <div className={`panel-frost animate-card-in rounded-lg border border-water p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">Calendar</span>
        <div className="flex items-center gap-1">
          {!isCurrentMonth && (
            <button
              onClick={goToday}
              className="mr-0.5 rounded-md border border-water bg-surface px-1.5 py-1 text-[10px] font-semibold text-ink/70 transition hover:bg-land hover:text-ink active:scale-95"
              title="Jump to this month"
            >
              Today
            </button>
          )}
          <button
            onClick={() => shiftMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-water bg-surface text-ink/70 transition hover:bg-land hover:text-ink active:scale-95"
            aria-label="Previous month"
          >‹</button>
          <span className="w-24 text-center text-xs font-semibold text-ink">{monthLabel}</span>
          <button
            onClick={() => shiftMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-water bg-surface text-ink/70 transition hover:bg-land hover:text-ink active:scale-95"
            aria-label="Next month"
          >›</button>
        </div>
      </div>

      {/* Today / this-week summary. M23: counts up rather than landing on its
          final value on the first frame. */}
      <div className="mb-2 text-[11px] text-ink/60">
        <span className="font-semibold text-ink u-numeric">{todayCountDisplay}</span> today
        <span className="mx-1 text-ink/30">·</span>
        <span className="font-semibold text-ink u-numeric">{weekCountDisplay}</span> this week
      </div>

      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="text-[10px] font-bold text-ink/55">{d}</div>
        ))}
      </div>
      {/* M26/M27: the day grid itself. Keyed by year+month so the whole thing
          (and every cell's M26 wave-in) remounts fresh on month change or
          initial mount, and never on hover/pick, since neither touches that
          key. While `prevGrid` is set, the outgoing month keeps rendering,
          absolutely positioned, sliding out in `direction` (M27) alongside the
          incoming one sliding in — the same shape Sidebar.tsx uses for its own
          directional pane swap (M12/M13). */}
      <div className="relative overflow-hidden">
        {prevGrid && (
          <div
            className={`absolute inset-0 grid grid-cols-7 gap-1 text-center ${direction === 'forward' ? 'mo-pane-slide-out-fwd' : 'mo-pane-slide-out-back'}`}
          >
            {renderCells(prevGrid.cells, prevGrid.year, prevGrid.month, false)}
          </div>
        )}
        <div
          key={`${view.year}-${view.month}`}
          className={`grid grid-cols-7 gap-1 text-center ${prevGrid ? (direction === 'forward' ? 'mo-pane-slide-in-fwd' : 'mo-pane-slide-in-back') : ''}`}
        >
          {renderCells(cells, view.year, view.month, true)}
        </div>
      </div>

      {/* Detail panel for the tapped day (bigger, below the grid), else the legend.
          Keyed by day so it re-plays its slide-in on every pick. */}
      {picked != null ? (
        <div
          key={picked}
          className="animate-detail-in mt-3 rounded-lg border border-terracotta/30 bg-terracotta/5 p-3"
        >
          <div className="text-sm font-bold text-ink">{pickedLabel}, {view.year}</div>
          {pickedHol && (
            <div className="mt-1.5 flex items-start gap-2 text-sm font-semibold text-forest">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-forest" />
              <span className="leading-snug">{pickedHol.map((h) => h.name).join(' · ')}</span>
            </div>
          )}
          <div className="mt-1 text-xs text-ink/60">
            {pickedEntries > 0
              ? `${pickedEntries} ${pickedEntries === 1 ? 'entry' : 'entries'}`
              : 'No entries this day'}
          </div>
        </div>
      ) : monthHasHoliday ? (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink/55">
          <span className="h-2 w-2 rounded-full bg-forest ring-1 ring-surface" />
          <span>Public holiday{region.state ? ` · ${region.country}-${region.state}` : region.country ? ` · ${region.country}` : ''}</span>
        </div>
      ) : region.source === 'none' ? (
        // No region resolved (common on a fresh phone, where the auto-detect
        // cache and any manual choice live in this device's localStorage only).
        // Tell the user why the calendar is bare instead of showing nothing.
        <div className="mt-2 text-[10px] leading-snug text-ink/55">
          Set a country under <span className="font-semibold text-ink/70">Settings → Calendar</span> to mark public holidays.
        </div>
      ) : null}
    </div>
  );
}
