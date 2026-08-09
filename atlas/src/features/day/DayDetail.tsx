import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useDeleteEntry, useDeleteDay } from '../journal/useDeleteEntry';
import { getDayKey, formatFullDay, formatTime, haversineKm, formatDistance } from '../../utils';
import { useScrollElevation } from '../../hooks/useScrollElevation';
import Presence from '../../components/ui/Presence';
import type { AnyEvent, JournalEntry, MediaAttachment } from '../../types';

const DayMap = lazy(() => import('./DayMap'));

function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

function firstImage(e: AnyEvent): string | undefined {
  const media = 'media_attachments' in e && Array.isArray(e.media_attachments)
    ? (e.media_attachments as MediaAttachment[])
    : [];
  return media.find((m) => m.kind === 'image')?.data;
}

/** A short plain-text preview of an entry's body (markdown stripped roughly). */
function snippet(e: AnyEvent): string {
  if (e.type !== 'journal') return '';
  const text = (e as JournalEntry).content_markdown || '';
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/[#>*_`~-]/g, '')            // common markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 140 ? plain.slice(0, 137).trimEnd() + '…' : plain;
}

/** Parse a `YYYY-MM-DD` key into a local Date (avoids the UTC shift of `new Date(str)`). */
function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const dotClass = (e: AnyEvent) => (e.type === 'journal' ? 'bg-terracotta' : 'bg-[#8B7355]');

/**
 * One whole day on a single page: a route map of where you went, the day's
 * distance and place count, and every entry in the order it happened. Opened by
 * tapping a day header in the timeline. Each entry is still its own record —
 * this is a reading view over them, not a merged entry.
 */
export default function DayDetail() {
  const selectedDay = useAtlasStore((s) => s.selectedDay);
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectDay = useAtlasStore((s) => s.selectDay);
  const deleteEntry = useDeleteEntry();
  const deleteDay = useDeleteDay();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, [menuOpen]);

  const [prevDayKey, setPrevDayKey] = useState(selectedDay);
  if (selectedDay !== prevDayKey) {
    setPrevDayKey(selectedDay);
    setMenuOpen(false);
  }

  // The day's entries in the order they happened (oldest → newest).
  const dayEvents = useMemo(() => {
    if (!selectedDay) return [];
    return events
      .filter((e) => getDayKey(e.timestamp) === selectedDay)
      .slice()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [events, selectedDay]);

  const located = useMemo(() => dayEvents.filter(hasLocation), [dayEvents]);

  // 1-based position on the map for each located entry, so list rows and pins match.
  const mapIndex = useMemo(() => {
    const m = new Map<string, number>();
    located.forEach((e, i) => m.set(e.id, i + 1));
    return m;
  }, [located]);

  const { distanceKm, places } = useMemo(() => {
    let dist = 0;
    for (let i = 1; i < located.length; i++) {
      dist += haversineKm(
        [located[i - 1].longitude, located[i - 1].latitude],
        [located[i].longitude, located[i].latitude],
      );
    }
    const names = new Set(
      located.map((e) => e.location_name?.trim() || `${e.latitude.toFixed(3)},${e.longitude.toFixed(3)}`),
    );
    return { distanceKm: dist, places: names.size };
  }, [located]);

  // M22: the header picks up a shadow once the body has actually scrolled.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sentinelRef, elevated } = useScrollElevation(scrollRef);

  if (!selectedDay) return null;

  const headingDate = dayEvents.length
    ? formatFullDay(dayEvents[0].timestamp)
    : formatFullDay(dateFromKey(selectedDay).toISOString());

  // Delete every entry of this day, then step back out of the day view.
  const handleDeleteDay = async () => {
    const removed = await deleteDay(dayEvents, headingDate);
    if (removed > 0) selectDay(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 safe-pt px-3 pb-3 border-b border-water ${elevated ? 'mo-header-elevated mo-header-elevated-tint' : ''}`}>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-ink/50 font-semibold hidden sm:block">Day</div>
          <h2 className="font-serif text-lg font-bold leading-tight truncate">{headingDate}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {dayEvents.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More options"
                className="btn btn-secondary btn-sm"
                title="More options"
              >
                ⋯
              </button>
              <Presence
                when={menuOpen}
                exitMs={120}
                enterClassName="mo-rise-in"
                exitClassName="mo-fade-out"
                className="absolute right-0 top-full mt-1 z-50"
              >
                <div className="flex flex-col min-w-[140px] rounded-lg border border-water bg-surface p-1 shadow-lg">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      handleDeleteDay();
                    }}
                    className="flex items-center gap-2 w-full rounded px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                  >
                    <span>🗑</span>
                    <span>{dayEvents.length === 1 ? 'Delete day' : `Delete ${dayEvents.length} entries`}</span>
                  </button>
                </div>
              </Presence>
            </div>
          )}
          <button onClick={() => selectDay(null)} className="btn btn-secondary btn-sm" title="Close this day">
            ✕ <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
        <div ref={sentinelRef} aria-hidden="true" />
        {/* At-a-glance stats for the day. */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-land px-3 py-1">
            📓 {dayEvents.length} {dayEvents.length === 1 ? 'entry' : 'entries'}
          </span>
          {places > 0 && <span className="rounded-full bg-land px-3 py-1">📍 {places} {places === 1 ? 'place' : 'places'}</span>}
          {located.length > 1 && <span className="rounded-full bg-land px-3 py-1">↦ {formatDistance(distanceKm)}</span>}
        </div>

        {/* Route map of the day's located entries. */}
        {located.length > 0 ? (
          <div className="h-56 overflow-hidden rounded-lg border border-water">
            <Suspense fallback={<div className="h-full w-full bg-land" />}>
              <DayMap events={located} onSelect={selectEvent} />
            </Suspense>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-water bg-land/40 p-4 text-center text-xs text-ink/40">
            No locations pinned this day.
          </div>
        )}

        {/* Every entry of the day, in order. */}
        <div className="relative space-y-2 pl-6 border-l-2 border-water">
          {dayEvents.map((event) => {
            const num = mapIndex.get(event.id);
            const img = firstImage(event);
            const preview = snippet(event);
            return (
              <div key={event.id} className="group/card relative">
                <button
                  onClick={() => selectEvent(event)}
                  className="flex w-full gap-3 rounded-lg border border-water bg-surface p-3 pr-9 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-terracotta/50 hover:shadow-md active:scale-[0.99]"
                >
                  {img && <img src={img} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs text-ink/50">
                      {num ? (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-terracotta text-[9px] font-bold text-white">{num}</span>
                      ) : (
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass(event)}`} />
                      )}
                      <span>{formatTime(event.timestamp)}</span>
                    </span>
                    <span className="mt-0.5 block font-medium text-sm">{event.title}</span>
                    {event.location_name && <span className="block text-xs text-ink/40">📍 {event.location_name}</span>}
                    {preview && <span className="mt-0.5 block text-xs text-ink/50 line-clamp-2">{preview}</span>}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void deleteEntry(event); }}
                  title="Delete this entry"
                  aria-label="Delete this entry"
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-md border border-water bg-surface/80 text-sm text-ink/50 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-500 active:scale-95 md:opacity-0 md:group-hover/card:opacity-100"
                >
                  🗑
                </button>
              </div>
            );
          })}
          {dayEvents.length === 0 && (
            <p className="py-6 text-center text-sm text-ink/40">No entries left for this day.</p>
          )}
        </div>
      </div>
    </div>
  );
}
