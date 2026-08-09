import { useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSettings, type EntryLayout } from '../../store/settings';
import { useDeleteEntry } from '../journal/useDeleteEntry';
import { getMonthGroup, getDayKey, getDayGroup, formatTime, isDateTitle } from '../../utils';
import { stagger } from '../../utils/motion';
import EmptyState, { MapGlyph } from '../../components/ui/EmptyState';
import Presence from '../../components/ui/Presence';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';
import { useFlipReflow } from '../../hooks/useFlipReflow';
import { useScrollElevation } from '../../hooks/useScrollElevation';
import type { AnyEvent, MediaAttachment } from '../../types';

/** How long the outgoing layout's crossfade plays before this component stops
 *  rendering it (M18 — the list↔tiles fallback; see index.css). */
const LAYOUT_TRANSITION_MS = 200;

/** A single calendar day's worth of entries within a month. */
interface DayGroup {
  key: string;   // stable YYYY-MM-DD, for React keys
  label: string; // human label, e.g. "Thursday 26"
  items: AnyEvent[];
}

/**
 * Bucket entries into months, and within each month into days, so several
 * entries made on the same day read as one day rather than separate timeline
 * points. `events` arrives newest-first (timestamp DESC), so months and days
 * come out newest-first too; within a day we reverse to chronological order so
 * a single day reads like a diary (morning → evening). Each entry keeps its own
 * timestamp — nothing here merges or mutates the underlying entries.
 */
function groupByMonthAndDay(events: AnyEvent[]): { month: string; days: DayGroup[] }[] {
  const months: { month: string; days: DayGroup[] }[] = [];
  const monthIndex = new Map<string, number>();
  const dayIndex = new Map<string, number>(); // `${month}|${dayKey}` -> index in that month's days

  for (const e of events) {
    const month = getMonthGroup(e.timestamp);
    let mi = monthIndex.get(month);
    if (mi === undefined) {
      mi = months.length;
      monthIndex.set(month, mi);
      months.push({ month, days: [] });
    }

    const dayKey = getDayKey(e.timestamp);
    const dayMapKey = `${month}|${dayKey}`;
    let di = dayIndex.get(dayMapKey);
    if (di === undefined) {
      di = months[mi].days.length;
      dayIndex.set(dayMapKey, di);
      months[mi].days.push({ key: dayKey, label: getDayGroup(e.timestamp), items: [] });
    }
    months[mi].days[di].items.push(e);
  }

  // Within each day, oldest → newest so the day reads in the order it happened.
  for (const m of months) for (const d of m.days) d.items.reverse();
  return months;
}

function firstImage(e: AnyEvent): string | undefined {
  const media = 'media_attachments' in e && Array.isArray(e.media_attachments)
    ? (e.media_attachments as MediaAttachment[])
    : [];
  return media.find((m) => m.kind === 'image')?.data;
}

/** 0,0 ("null island") means the entry was saved without a real location. */
function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

/** How many distinct places a day's entries touched — by name when available,
 *  else by rounded coordinates so two pins at the same spot count once. */
function distinctPlaces(items: AnyEvent[]): number {
  const seen = new Set<string>();
  for (const e of items) {
    if (!hasLocation(e)) continue;
    seen.add(e.location_name?.trim() || `${e.latitude.toFixed(3)},${e.longitude.toFixed(3)}`);
  }
  return seen.size;
}

const dotClass = (e: AnyEvent) => (e.type === 'journal' ? 'bg-terracotta' : 'bg-[#8B7355]');

/** Small trash affordance shown on each timeline card (hover on desktop, always
 *  faintly visible on touch) so a single entry can be removed without opening it. */
function DeleteButton({ onDelete }: { onDelete: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onDelete}
      title="Delete this entry"
      aria-label="Delete this entry"
      className="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-water bg-surface/80 text-sm text-ink/50 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 active:scale-95 md:opacity-0 md:group-hover/card:opacity-100"
    >
      🗑
    </button>
  );
}

function LayoutToggle({ value, onChange }: { value: EntryLayout; onChange: (v: EntryLayout) => void }) {
  const opts: { value: EntryLayout; label: string; title: string }[] = [
    { value: 'list', label: '☰', title: 'List' },
    { value: 'tiles', label: '▦', title: 'Tiles' },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-water">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.title}
          aria-pressed={value === o.value}
          className={`px-2.5 py-1 text-sm transition-colors ${
            value === o.value ? 'bg-ink text-parchment' : 'bg-surface text-ink/70 hover:bg-land'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function TimelineView() {
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectDay = useAtlasStore((s) => s.selectDay);
  const layout = useSettings((s) => s.entryLayout);
  const update = useSettings((s) => s.update);
  const deleteEntry = useDeleteEntry();
  // The id mid-exit-animation, so its card plays `animate-entry-out` before the
  // record is actually dropped from the store.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const motion = useEffectiveMotion();

  const groups = useMemo(() => groupByMonthAndDay(events), [events]);

  // M16: every rendered card's id, in document order across all days/months —
  // FLIP needs the flat set, since removing one entry shifts everything below
  // it, not just its own day. The exit animation itself already existed
  // (`entry-out` + the 220ms `beforeCommit` gate below) — this adds the
  // reflow of the survivors, not a replacement for it. Arriving individually
  // already worked before this wave: each card's key is `event.id`, stable
  // across renders, so a newly-synced entry mounts (and plays its own
  // `animate-fade-in-up`) without remounting its unrelated siblings.
  const flatIds = useMemo(
    () => groups.flatMap((g) => g.days.flatMap((d) => d.items.map((e) => e.id))),
    [groups],
  );
  const cardRef = useFlipReflow(flatIds, motion === 'off');

  // M18: list ↔ tiles crossfades — the plan's own sanctioned fallback to a
  // true FLIP (see index.css's note on why: a transform between a square tile
  // and a full-width row would visibly stretch text/images, and this session
  // has no browser to confirm it doesn't). The outgoing layout keeps
  // rendering, faded out and absolutely positioned, for LAYOUT_TRANSITION_MS.
  const [prevLayout, setPrevLayout] = useState<EntryLayout | null>(null);
  const layoutTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const changeLayout = (next: EntryLayout) => {
    if (next === layout) return;
    if (motion !== 'off') {
      setPrevLayout(layout);
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      layoutTimer.current = setTimeout(() => setPrevLayout(null), LAYOUT_TRANSITION_MS);
    }
    update('entryLayout', next);
  };

  // M22: the toolbar picks up a shadow once the list has actually scrolled —
  // driven by a sentinel just below it, not a scroll listener.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sentinelRef, elevated } = useScrollElevation(scrollRef);

  // Confirm, then briefly animate the card out before committing the delete.
  const handleDelete = (event: AnyEvent) => (e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteEntry(event, {
      beforeCommit: () =>
        new Promise<void>((resolve) => {
          setRemovingId(event.id);
          window.setTimeout(() => { setRemovingId(null); resolve(); }, 220);
        }),
    });
  };

  // Renders the whole grouped list for ONE layout mode — factored out so
  // M18's crossfade can render both the outgoing snapshot and the live view
  // from the same markup. `attachRefs` is false for the outgoing snapshot:
  // two elements sharing the same event id can't both register with
  // `useFlipReflow` at once.
  const renderGroups = (layoutMode: EntryLayout, attachRefs: boolean) => (
    <div className="px-4 pb-6">
      {groups.map(({ month, days }) => (
        <div key={month} className="mb-6">
          {/* A self-sized solid-surface pill (same fill as the entry cards) so
              the month reads clearly over the hazy backdrop. Deliberately
              CONTAINED, not a full-width band: an earlier full-width translucent
              parchment band mismatched the frosted panel (worst at night) and
              was reverted — a solid `bg-surface` chip that hugs the text reads
              as an intentional label instead. */}
          <div className="pt-1 pb-2">
            <h3 className="inline-block rounded-lg border border-water bg-surface px-3 py-1 font-serif text-lg font-bold text-terracotta shadow-sm">{month}</h3>
          </div>

          {days.map((day) => {
            const places = distinctPlaces(day.items);
            return (
            <div key={day.key} className="mb-4">
              {/* One header per calendar day; entries below keep their own time.
                  Tapping it opens the whole day on its own page (route map + stats).
                  The day's at-a-glance stats sit alongside: how many entries and
                  how many distinct places you touched that day. */}
              {/* Solid-surface day header — same card fill as the entries below
                  it, so "14 Tuesday · 3 entries · 1 place" stays legible over the
                  hazy backdrop, and it reads (and hovers) like the tappable card
                  it is: opening the whole day. */}
              <button
                onClick={() => selectDay(day.key)}
                title="Open this whole day (route map + all entries)"
                className="group/day mb-2 flex w-full items-baseline gap-2 rounded-lg border border-water bg-surface-raised px-3 py-2 text-left shadow-sm transition duration-200 hover:border-terracotta/50 hover:shadow-md active:scale-[0.99]"
              >
                <h4 className="text-sm font-bold text-ink group-hover/day:text-terracotta transition-colors">{day.label}</h4>
                {day.items.length > 1 && (
                  <span className="text-[11px] font-medium text-ink/55">{day.items.length} entries</span>
                )}
                {places > 0 && (
                  <span className="text-[11px] font-medium text-ink/55">· 📍 {places} {places === 1 ? 'place' : 'places'}</span>
                )}
                <span className="ml-auto rounded border border-water bg-land px-1.5 py-0.5 text-[11px] font-semibold text-ink/60 opacity-0 transition-opacity group-hover/day:opacity-100">open →</span>
              </button>

              {layoutMode === 'tiles' ? (
                <div className="grid grid-cols-2 gap-2">
                  {day.items.map((event, i) => {
                    const img = firstImage(event);
                    return (
                      <div
                        key={event.id}
                        ref={attachRefs ? cardRef(event.id) : undefined}
                        style={stagger(i)}
                        className={`mo-flip-item animate-fade-in-up group/card relative ${removingId === event.id ? 'animate-entry-out' : ''}`}
                      >
                        <button
                          onClick={() => selectEvent(event)}
                          className="group flex w-full flex-col text-left bg-surface-raised rounded-lg border border-water hover:border-terracotta/50 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] transition duration-200 shadow-sm overflow-hidden"
                        >
                          {img ? (
                            <img src={img} alt="" className="h-20 w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          ) : (
                            <div className="h-20 w-full bg-land flex items-center justify-center text-lg text-ink/30">🗺️</div>
                          )}
                          <div className="p-2">
                            {/* The day header already carries the date, so a date-titled entry
                                leads with its time instead of repeating the date. */}
                            {isDateTitle(event.title, event.timestamp) ? (
                              <div className="flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${dotClass(event)}`} />
                                <span className="font-semibold text-xs text-ink">{formatTime(event.timestamp)}</span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1 text-[10px] text-ink/50">
                                  <span className={`w-1.5 h-1.5 rounded-full ${dotClass(event)}`} />
                                  <span>{formatTime(event.timestamp)}</span>
                                </div>
                                <div className="font-medium text-xs mt-0.5 line-clamp-2">{event.title}</div>
                              </>
                            )}
                            {event.location_name && (
                              <div className="text-[10px] text-ink/40 mt-0.5 truncate">📍 {event.location_name}</div>
                            )}
                          </div>
                        </button>
                        <DeleteButton onDelete={handleDelete(event)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="relative pl-6 border-l-2 border-water">
                  {day.items.map((event, i) => (
                    <div
                      key={event.id}
                      ref={attachRefs ? cardRef(event.id) : undefined}
                      style={stagger(i)}
                      className={`mo-flip-item animate-fade-in-up group/card relative mb-3 ${removingId === event.id ? 'animate-entry-out' : ''}`}
                    >
                      <button
                        onClick={() => selectEvent(event)}
                        className="block w-full text-left p-3 pr-9 bg-surface-raised rounded-lg border border-water hover:border-terracotta/50 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] transition duration-200 shadow-sm"
                      >
                        {/* The day header already carries the date, so a date-titled entry
                            leads with its time as the most prominent text rather than
                            repeating the date. Custom-named entries keep their title. */}
                        {isDateTitle(event.title, event.timestamp) ? (
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${dotClass(event)}`} />
                            <span className="font-semibold text-sm text-ink">{formatTime(event.timestamp)}</span>
                            <span className="text-[11px] uppercase tracking-wider text-ink/40">{event.type}</span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-xs text-ink/50 mb-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${dotClass(event)}`} />
                              <span>{formatTime(event.timestamp)}</span>
                              <span className="uppercase tracking-wider">{event.type}</span>
                            </div>
                            <div className="font-medium text-sm">{event.title}</div>
                          </>
                        )}
                        {event.location_name && (
                          <div className="text-xs text-ink/40 mt-0.5">📍 {event.location_name}</div>
                        )}
                      </button>
                      <DeleteButton onDelete={handleDelete(event)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={scrollRef} className="overflow-y-auto h-full">
      {/* The phone's Welcome dashboard used to be embedded HERE (P1), making the
          Timeline tab double as the home screen. Removed 2026-08-08: tapping
          "Timeline" then showed the greeting rather than the journal, which is
          the opposite of what the label promises. Home is its own tab now (see
          `store/atlas.ts`'s `View`), and this pane shows entries and nothing
          else, on every form factor. */}

      {/* Toolbar: list / tiles. Kept sticky so the toggle stays reachable, but
          with no fill or backdrop blur — those paint a faint mismatched band on
          the frosted sidebar (worst at night). The toggle is a self-contained
          bordered control, so it stays legible over scrolling content.
          M22: picks up a shadow (no fill — see above) once actually scrolled. */}
      <div className={`sticky top-0 z-20 flex items-center justify-between px-4 py-2 ${elevated ? 'mo-header-elevated' : ''}`}>
        <span className="text-[11px] uppercase tracking-wider text-ink/40">Timeline</span>
        <LayoutToggle value={layout} onChange={changeLayout} />
      </div>
      <div ref={sentinelRef} aria-hidden="true" />

      {/* M21: empty ↔ populated crossfades instead of snapping. */}
      <Presence when={events.length === 0} exitMs={160} enterClassName="mo-fade-in-plain" exitClassName="mo-fade-out-plain">
        <EmptyState
          glyph={<MapGlyph className="mo-glyph-drift" />}
          title="Your journal is a blank map"
          // Deliberately doesn't name a button: the way to start writing is
          // "＋ New entry" on desktop and the ✍️ Write bar on a phone, and this
          // one string is shown on both.
          message="Write your first entry and pin it where you are — it becomes the first mark on your map."
        />
      </Presence>
      {events.length > 0 && (
        <div className="relative">
          {prevLayout && (
            <div className="absolute inset-0 mo-fade-out-plain" aria-hidden="true">
              {renderGroups(prevLayout, false)}
            </div>
          )}
          <div className={prevLayout ? 'mo-fade-in-plain' : ''}>
            {renderGroups(layout, true)}
          </div>
        </div>
      )}
    </div>
  );
}
