import { useMemo } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { formatDistance } from '../../utils';
import { computeTrips, tripDateRange } from './trips';
import EmptyState from '../../components/ui/EmptyState';

/**
 * The list of journeys derived from the journal (runs of entries sharing a trip
 * name). Tapping one opens its detail page in the main pane. Recomputed from
 * events on every render (cheap; nothing persisted).
 *
 * No longer a tab of its own — it is what Explore shows while you aren't
 * searching (`features/explore/ExploreView.tsx`), which is why `embedded`
 * exists: inside Explore this sits in that pane's existing scroll container, so
 * it must not bring a second full-height scroller of its own.
 */
export default function TripsView({ embedded = false }: { embedded?: boolean } = {}) {
  const events = useAtlasStore((s) => s.events);
  const selectTrip = useAtlasStore((s) => s.selectTrip);
  const selectedTrip = useAtlasStore((s) => s.selectedTrip);
  const trips = useMemo(() => computeTrips(events), [events]);

  if (trips.length === 0) {
    return (
      <div className={embedded ? '' : 'p-3'}>
        <EmptyState
          glyph={<span className="text-3xl">🧳</span>}
          title="No trips yet"
          message="When writing an entry, tick “Part of a trip” and give it a name. Entries sharing that name gather here as a trip — while still showing normally in your timeline."
        />
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-2' : 'h-full space-y-2 overflow-y-auto p-3'}>
      {trips.map((t) => (
        <button
          key={t.id}
          onClick={() => selectTrip(t.id)}
          className={`block w-full rounded-lg border bg-surface p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-terracotta/50 hover:shadow-md ${
            selectedTrip === t.id ? 'border-terracotta' : 'border-water'
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{t.name}</span>
            <span className="shrink-0 text-[10px] text-ink/40">{t.spanDays === 1 ? '1 day' : `${t.spanDays} days`}</span>
          </div>
          <div className="mt-0.5 text-xs text-ink/50">{tripDateRange(t)}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-land px-2 py-0.5">📓 {t.events.length}</span>
            {t.placeNames.length > 0 && <span className="rounded-full bg-land px-2 py-0.5">📍 {t.placeNames.length}</span>}
            {t.located.length > 1 && <span className="rounded-full bg-land px-2 py-0.5">↦ {formatDistance(t.distanceKm)}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
