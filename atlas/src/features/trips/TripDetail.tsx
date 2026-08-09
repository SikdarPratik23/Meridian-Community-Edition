import { lazy, Suspense, useMemo } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { formatTime, formatDistance } from '../../utils';
import { computeTrips, tripDateRange } from './trips';
import { printJournal } from '../export/printJournal';
import type { AnyEvent, JournalEntry, MediaAttachment } from '../../types';

const DayMap = lazy(() => import('../day/DayMap'));

function firstImage(e: AnyEvent): string | undefined {
  const media = 'media_attachments' in e && Array.isArray(e.media_attachments)
    ? (e.media_attachments as MediaAttachment[])
    : [];
  return media.find((m) => m.kind === 'image')?.data;
}

function snippet(e: AnyEvent): string {
  if (e.type !== 'journal') return '';
  const plain = ((e as JournalEntry).content_markdown || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 140 ? plain.slice(0, 137).trimEnd() + '…' : plain;
}

/**
 * One trip on a single page: a route map of everywhere it went, its distance /
 * places / days, every entry in order, and a one-tap print/PDF of the whole
 * journey. Opened from the Trips tab. The trip is re-derived from events by id,
 * so it stays correct as entries change (and closes itself if it dissolves).
 */
export default function TripDetail() {
  const selectedTrip = useAtlasStore((s) => s.selectedTrip);
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectTrip = useAtlasStore((s) => s.selectTrip);
  const authorName = useSettings((s) => s.name);

  const trip = useMemo(
    () => computeTrips(events).find((t) => t.id === selectedTrip) ?? null,
    [events, selectedTrip],
  );

  // 1-based map position for each located entry, so list rows match the pins.
  const mapIndex = useMemo(() => {
    const m = new Map<string, number>();
    trip?.located.forEach((e, i) => m.set(e.id, i + 1));
    return m;
  }, [trip]);

  if (!trip) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-3xl">🧳</div>
        <p className="text-sm text-ink/50">This trip is no longer available.</p>
        <button onClick={() => selectTrip(null)} className="btn btn-secondary btn-sm">Back</button>
      </div>
    );
  }

  const doPrint = () =>
    printJournal(trip.events, { title: trip.name, subtitle: tripDateRange(trip), author: authorName || undefined, glyph: '🧳' });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 safe-pt px-3 pb-3 border-b border-water">
        <div className="min-w-0">
          <div className="hidden text-[11px] font-semibold uppercase tracking-wider text-ink/50 sm:block">Trip</div>
          <h2 className="truncate font-serif text-lg font-bold leading-tight">{trip.name}</h2>
          <div className="text-xs text-ink/50">{tripDateRange(trip)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={doPrint} className="btn btn-secondary btn-sm" title="Print or save this trip as a PDF">
            🖨 <span className="hidden sm:inline">Print / PDF</span>
          </button>
          <button onClick={() => selectTrip(null)} className="btn btn-secondary btn-sm" title="Close this trip">
            ✕ <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-land px-3 py-1">📓 {trip.events.length} {trip.events.length === 1 ? 'entry' : 'entries'}</span>
          <span className="rounded-full bg-land px-3 py-1">🗓 {trip.spanDays === 1 ? '1 day' : `${trip.spanDays} days`}</span>
          {trip.placeNames.length > 0 && <span className="rounded-full bg-land px-3 py-1">📍 {trip.placeNames.length} {trip.placeNames.length === 1 ? 'place' : 'places'}</span>}
          {trip.located.length > 1 && <span className="rounded-full bg-land px-3 py-1">↦ {formatDistance(trip.distanceKm)}</span>}
        </div>

        {trip.located.length > 0 ? (
          <div className="h-56 overflow-hidden rounded-lg border border-water">
            <Suspense fallback={<div className="h-full w-full bg-land" />}>
              <DayMap events={trip.located} onSelect={selectEvent} />
            </Suspense>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-water bg-land/40 p-4 text-center text-xs text-ink/40">
            No locations pinned on this trip.
          </div>
        )}

        <div className="relative space-y-2 border-l-2 border-water pl-6">
          {trip.events.map((event) => {
            const num = mapIndex.get(event.id);
            const img = firstImage(event);
            const preview = snippet(event);
            return (
              <button
                key={event.id}
                onClick={() => selectEvent(event)}
                className="flex w-full gap-3 rounded-lg border border-water bg-surface p-3 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-terracotta/50 hover:shadow-md active:scale-[0.99]"
              >
                {img && <img src={img} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-xs text-ink/50">
                    {num ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-terracotta text-[9px] font-bold text-white">{num}</span>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-terracotta" />
                    )}
                    <span>{new Date(event.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {formatTime(event.timestamp)}</span>
                  </span>
                  <span className="mt-0.5 block text-sm font-medium">{event.title}</span>
                  {event.location_name && <span className="block text-xs text-ink/40">📍 {event.location_name}</span>}
                  {preview && <span className="mt-0.5 block text-xs text-ink/50 line-clamp-2">{preview}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
