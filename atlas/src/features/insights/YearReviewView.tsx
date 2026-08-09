import { useMemo, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { formatDistance, formatFullDay } from '../../utils';
import { computeYearReview, journalYears } from './yearReview';
import { printJournal } from '../export/printJournal';
import DayMap from '../day/DayMap';
import EmptyState, { MapGlyph } from '../../components/ui/EmptyState';
import { useCountUp } from '../../hooks/useCountUp';
import { stagger } from '../../utils/motion';

/**
 * Year in Review — the journal's own retrospective.
 *
 * Everything shown here is derived from entries already on the device (see
 * `yearReview.ts`, which is pure and unit-tested); nothing is fetched and nothing
 * is computed on a server. That's the whole reason this feature was possible
 * without a backend.
 *
 * The design intent is a page you'd actually want to look at once a year, not a
 * metrics dashboard: a few large numbers, a month histogram you can read at a
 * glance, the route you covered, and the places and words that made up the year.
 * Deliberately no goals, no streak-shaming, no comparisons to last year — a
 * journal shouldn't nag.
 */

/**
 * One large figure with a caption. M23: counts up rather than landing on its
 * final value on the first frame. `value` is always the raw NUMBER (never a
 * pre-formatted string) so `useCountUp` has something to animate; `scale`
 * lets a fractional figure (distance, in km) count in tenths rather than
 * whole units — `useCountUp` itself always returns an integer (it's built
 * for counts), so a value scaled ×10 before the hook and divided back after
 * keeps one decimal place through the animation instead of visibly snapping
 * distances under 10km to a whole number. `format` renders the settled
 * number; defaults to a locale-formatted integer.
 */
function Stat({
  value,
  label,
  hint,
  format,
  scale = 1,
}: {
  value: number;
  label: string;
  hint?: string;
  format?: (n: number) => string;
  scale?: number;
}) {
  const counted = useCountUp(Math.round(value * scale)) / scale;
  const text = format ? format(counted) : Math.round(counted).toLocaleString();
  return (
    <div className="rounded-lg border border-water bg-surface p-3">
      <div className="u-display u-display-sm u-numeric leading-none">{text}</div>
      <div className="u-label mt-1.5">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink/40">{hint}</div>}
    </div>
  );
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** The per-month histogram. Bars are scaled to the busiest month, so the shape of
 *  the year reads even when the absolute counts are small. */
function MonthChart({ counts }: { counts: number[] }) {
  const peak = Math.max(1, ...counts);
  return (
    <div className="space-y-1.5">
      <div className="flex h-24 items-end gap-1" role="img" aria-label="Entries per month">
        {counts.map((count, month) => (
          <div key={month} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-ink/40 u-numeric">{count > 0 ? count : ''}</span>
            {/* M24: grows in from the baseline (scaleY), staggered left to
                right, in place of the old height transition. */}
            <div
              className="mo-bar-grow w-full rounded-t bg-terracotta/75"
              style={{ height: `${count === 0 ? 2 : Math.max(6, (count / peak) * 100)}%`, ...stagger(month) }}
              title={`${count} ${count === 1 ? 'entry' : 'entries'}`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {MONTH_INITIALS.map((initial, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-ink/35">{initial}</div>
        ))}
      </div>
    </div>
  );
}

/** A ranked list with proportional bars — used for places, tags and moods. */
function RankedList({
  title,
  items,
  emptyNote,
}: {
  title: string;
  items: Array<{ name: string; count: number }>;
  emptyNote: string;
}) {
  const peak = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="space-y-2">
      <h3 className="u-label">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink/40">{emptyNote}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((item, i) => (
            <li key={item.name} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="shrink-0 text-ink/40 u-numeric">{item.count}</span>
              </div>
              {/* M25: sweeps in from the left (scaleX), staggered — these bars
                  previously had no transition at all, so even switching year
                  snapped every one to its new length instantly. */}
              <div className="h-1 overflow-hidden rounded-full bg-land">
                <div
                  className="mo-bar-grow-x h-full rounded-full bg-forest/60"
                  style={{ width: `${(item.count / peak) * 100}%`, ...stagger(i) }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function YearReview({ onClose }: { onClose: () => void }) {
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);

  const years = useMemo(() => journalYears(events), [events]);
  const [year, setYear] = useState<number | null>(null);
  // Default to the most recent year that actually has entries, not the calendar
  // year — opening on an empty "2027" would be a poor first impression.
  const activeYear = year ?? years[0] ?? new Date().getFullYear();
  const review = useMemo(() => computeYearReview(events, activeYear), [events, activeYear]);

  if (years.length === 0) {
    return (
      <div className="panel-frost pane-frost h-full overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="u-display u-display-sm">Year in review</h2>
          <button type="button" onClick={onClose} className="btn btn-sm btn-secondary">✕ Close</button>
        </div>
        <EmptyState
          glyph={<MapGlyph />}
          title="Nothing to review yet"
          message="Once you've written a few entries, this page sums up your year — how much you wrote, where you went, and the places you kept coming back to."
        />
      </div>
    );
  }

  const averageWords = review.totalEntries > 0 ? Math.round(review.wordCount / review.totalEntries) : 0;

  return (
    <div className="panel-frost pane-frost h-full overflow-y-auto">
      <div className="space-y-5 p-4">
        {/* Header + year picker */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="u-display u-display-md leading-none">{activeYear}</h2>
            <p className="mt-1 text-xs text-ink/50">Your year in review</p>
          </div>
          <div className="flex items-center gap-2">
            {years.length > 1 && (
              <select
                value={activeYear}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded border border-water bg-surface px-2 py-1.5 text-xs focus:border-terracotta focus:outline-none"
                aria-label="Choose a year"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
            <button type="button" onClick={onClose} className="btn btn-sm btn-secondary">✕ Close</button>
          </div>
        </div>

        {review.totalEntries === 0 ? (
          <EmptyState
            glyph={<MapGlyph />}
            title={`Nothing written in ${activeYear}`}
            message="Pick another year above."
          />
        ) : (
          <>
            {/* The headline numbers */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={review.totalEntries} label="Entries" />
              <Stat value={review.daysJournaled} label="Days journaled" />
              <Stat value={review.longestStreak} label="Longest streak" hint="consecutive days" />
              <Stat value={review.distanceKm} label="Distance covered" hint="between pins" format={formatDistance} scale={10} />
            </div>

            <div className="space-y-2">
              <h3 className="u-label">Through the year</h3>
              <MonthChart counts={review.entriesPerMonth} />
            </div>

            {/* The year's route. Only worth drawing when there's a line to draw. */}
            {review.located.length > 1 && (
              <div className="space-y-2">
                <h3 className="u-label">Where you went</h3>
                <div className="h-56 overflow-hidden rounded-lg border border-water">
                  <DayMap events={review.located} onSelect={selectEvent} />
                </div>
                <p className="text-[11px] text-ink/40">
                  {review.located.length} pinned {review.located.length === 1 ? 'entry' : 'entries'} · tap a pin to open it
                </p>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <RankedList
                title="Places you returned to"
                items={review.topPlaces}
                emptyNote="No place names recorded this year."
              />
              <RankedList
                title="What you wrote about"
                items={review.topTags}
                emptyNote="No tags used this year."
              />
            </div>

            {review.moods.length > 0 && (
              <RankedList title="How you felt" items={review.moods} emptyNote="" />
            )}

            {/* Writing + media */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={review.wordCount} label="Words written" />
              <Stat value={averageWords} label="Words per entry" hint="on average" />
              <Stat value={review.photoCount} label="Photos" hint={`in ${review.entriesWithPhotos} entries`} />
              <Stat value={review.trips.length} label="Trips" />
            </div>

            {review.trips.length > 0 && (
              <div className="space-y-2">
                <h3 className="u-label">Trips</h3>
                <div className="flex flex-wrap gap-1.5">
                  {review.trips.map((trip) => (
                    <span key={trip} className="rounded-full border border-water px-2.5 py-1 text-[11px] text-ink/65">
                      🧳 {trip}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Bookends */}
            {review.firstEntry && review.lastEntry && (
              <div className="space-y-1 border-t border-water pt-3 text-xs text-ink/50">
                <div>First entry — {formatFullDay(review.firstEntry)}</div>
                <div>Last entry — {formatFullDay(review.lastEntry)}</div>
                {review.busiestDay && (
                  <div>
                    Busiest day — {review.busiestDay.dayKey} ({review.busiestDay.count}{' '}
                    {review.busiestDay.count === 1 ? 'entry' : 'entries'})
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                printJournal(
                  events.filter((e) => !e.deleted_at && new Date(e.timestamp).getFullYear() === activeYear),
                  { title: `${activeYear}`, subtitle: 'A year in the field', glyph: '🗓' },
                )
              }
              className="btn btn-secondary btn-block"
            >
              🖨 Print this year / Save as PDF
            </button>
          </>
        )}
      </div>
    </div>
  );
}
