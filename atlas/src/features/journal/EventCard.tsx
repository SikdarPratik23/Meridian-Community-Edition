import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { useDeleteEntry } from './useDeleteEntry';
import { formatDateTime, formatLatLng, formatTemperature, formatTime, formatFullDay, getDayKey, isDateTitle } from '../../utils';
import { ATTACHMENT_SCHEME, referencedAttachmentIds } from './inlineImages';
import Lightbox from './Lightbox';
import Presence from '../../components/ui/Presence';
import { useFrozen } from '../../hooks/useFrozen';
import { useScrollElevation } from '../../hooks/useScrollElevation';
import { stagger } from '../../utils/motion';
import type { JournalEntry, Place, AnyEvent, MediaAttachment } from '../../types';
import type { LightboxOriginRect } from './Lightbox';

function mediaOf(e: AnyEvent): MediaAttachment[] {
  return ('media_attachments' in e && Array.isArray(e.media_attachments)) ? e.media_attachments : [];
}

/** 0,0 ("null island") means the entry was saved without a location. */
function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

function isJournalEntry(e: AnyEvent): e is JournalEntry {
  return (e as JournalEntry).type === 'journal';
}

export default function EventCard({ onEdit }: { onEdit?: () => void }) {
  const selectedEvent = useAtlasStore((s) => s.selectedEvent);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectDay = useAtlasStore((s) => s.selectDay);
  const coordFormat = useSettings((s) => s.coordFormat);
  const tempUnit = useSettings((s) => s.tempUnit);
  const deleteEntry = useDeleteEntry();
  const [lightbox, setLightbox] = useState<
    { src: string; alt?: string; id?: string; hasOriginal?: boolean; originalName?: string; originRect?: LightboxOriginRect } | null
  >(null);

  /**
   * Reading progress, 0–1, or null when the entry fits on screen and there is
   * nothing to track. Driven by the pane's own scroll rather than the window's,
   * because the reader is an inner scroll container.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // Last known value, so the bar fades out AT its last width instead of
  // snapping to 0 the instant `progress` itself goes null.
  const lastProgress = useFrozen(progress ?? 0, progress !== null);
  // M22: the header (already outside the scroll region by layout, not by
  // `position: sticky`) picks up a shadow once the body has actually scrolled.
  const { sentinelRef, elevated } = useScrollElevation(scrollRef);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    // A threshold rather than `> 0`: a couple of stray pixels of overflow is not a
    // long read, and a bar that appears for those would just flicker.
    if (scrollable < 48) {
      setProgress(null);
      return;
    }
    setProgress(Math.min(1, Math.max(0, el.scrollTop / scrollable)));
  }, []);

  // Re-evaluate when the entry changes: the new body may be shorter than the pane
  // (so the bar should disappear) and the pane is scrolled back to the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    onScroll();
  }, [selectedEvent?.id, onScroll]);

  // Map attachment id → bytes, so inline `attachment:<id>` images resolve.
  const attachmentMap = useMemo(() => {
    const map = new Map<string, MediaAttachment>();
    if (selectedEvent) for (const m of mediaOf(selectedEvent)) map.set(m.id, m);
    return map;
  }, [selectedEvent]);

  // Custom renderer for Markdown images: resolves attachment refs to stored
  // bytes, shows the alt text as an optional caption, and opens the lightbox.
  const mdComponents = useMemo<Components>(() => ({
    img({ src, alt }) {
      const raw = typeof src === 'string' ? src : '';
      const att = raw.startsWith(ATTACHMENT_SCHEME)
        ? attachmentMap.get(raw.slice(ATTACHMENT_SCHEME.length))
        : undefined;
      const resolved = raw.startsWith(ATTACHMENT_SCHEME) ? att?.data : raw;
      if (!resolved) return null;
      // Render inline photos as a compact, capped-height thumbnail (kept small so
      // the text stays readable). The src is still the full stored image, so a
      // click opens the lightbox at full size — resolution is never lost here.
      return (
        <figure className="my-3">
          <img
            src={resolved}
            alt={alt || ''}
            loading="lazy"
            onClick={(e) => setLightbox({ src: resolved, alt, id: att?.id, hasOriginal: att?.original, originalName: att?.originalName, originRect: e.currentTarget.getBoundingClientRect() })}
            className="max-h-56 w-auto max-w-full cursor-zoom-in rounded-lg border border-water object-contain"
          />
          {alt && <figcaption className="mt-1 text-xs italic text-ink/50">{alt}</figcaption>}
        </figure>
      );
    },
  }), [attachmentMap]);

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

  // Reset overflow menu when active event changes
  const [prevEventId, setPrevEventId] = useState(selectedEvent?.id);
  if (selectedEvent?.id !== prevEventId) {
    setPrevEventId(selectedEvent?.id);
    setMenuOpen(false);
  }

  if (!selectedEvent) return null;

  const handleDelete = async () => {
    const removed = await deleteEntry(selectedEvent);
    if (removed) selectEvent(null);
  };

  const typeColors: Record<string, string> = {
    journal: 'bg-terracotta',
    place: 'bg-[#8B7355]',
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* How far through the entry you are. Only rendered once the body is actually
          taller than the pane — on a short note a progress bar pinned at 100% is
          noise. Identical on phone and desktop.
          Opacity-only exit (`mo-fade-out-plain`): the bar's own `transform` is
          doing real work (scaleX of the live progress), so the enter/exit here
          must not also touch `transform` or the two would fight over it. */}
      <Presence when={progress !== null} exitMs={120} exitClassName="mo-fade-out-plain">
        <div
          className="read-progress"
          style={{ transform: `scaleX(${progress ?? lastProgress})` }}
          aria-hidden="true"
        />
      </Presence>
      <div className={`flex flex-wrap items-center justify-between gap-1 safe-pt px-3 pb-3 border-b border-water ${elevated ? 'mo-header-elevated mo-header-elevated-tint' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${typeColors[selectedEvent.type]}`} />
          <span className="text-xs uppercase tracking-wider text-ink/50 hidden sm:inline">{selectedEvent.type}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {/* Back to the day this entry belongs to (its route map + sibling
              entries) without closing the reading view entirely. */}
          <button
            onClick={() => selectDay(getDayKey(selectedEvent.timestamp))}
            className="btn btn-secondary btn-sm"
            title="Back to this day's entries"
          >
            ← <span className="hidden sm:inline">Back</span>
          </button>
          {onEdit && selectedEvent.type === 'journal' && (
            <button onClick={onEdit} className="btn btn-secondary btn-sm" title="Edit entry">
              ✎ <span className="hidden sm:inline">Edit</span>
            </button>
          )}
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
              <div className="flex flex-col min-w-[130px] rounded-lg border border-water bg-surface p-1 shadow-lg">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleDelete();
                  }}
                  className="flex items-center gap-2 w-full rounded px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                >
                  <span>🗑</span>
                  <span>Delete entry</span>
                </button>
              </div>
            </Presence>
          </div>
          <button onClick={() => selectEvent(null)} className="btn btn-secondary btn-sm" title="Close">
            ✕ <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 space-y-3">
        <div ref={sentinelRef} aria-hidden="true" />
        {/* A date-titled entry (no custom name) would otherwise show the date as
            the heading and repeat it in the meta line below. Lead with the full
            day as the heading and show only the time beneath it; a custom-named
            entry keeps its name + the full date-time. */}
        <h2 className="font-serif text-xl font-bold">
          {isDateTitle(selectedEvent.title, selectedEvent.timestamp)
            ? formatFullDay(selectedEvent.timestamp)
            : selectedEvent.title}
        </h2>
        <div className="text-xs text-ink/50 space-y-1">
          <div>
            {isDateTitle(selectedEvent.title, selectedEvent.timestamp)
              ? formatTime(selectedEvent.timestamp)
              : formatDateTime(selectedEvent.timestamp)}
          </div>
          {selectedEvent.location_name && <div>📍 {selectedEvent.location_name}</div>}
          {hasLocation(selectedEvent) && (
            <div>📍 {formatLatLng(selectedEvent.longitude, selectedEvent.latitude, coordFormat)}</div>
          )}
          {selectedEvent.trip && <div>🧳 {selectedEvent.trip}</div>}
          {isJournalEntry(selectedEvent) && selectedEvent.mood && <div>😌 {selectedEvent.mood}</div>}
          {isJournalEntry(selectedEvent) && (selectedEvent.weather_condition || selectedEvent.weather_temperature != null) && (
            <div>
              🌡️ {selectedEvent.weather_condition}
              {selectedEvent.weather_temperature != null && (
                <>{selectedEvent.weather_condition ? ' · ' : ''}{formatTemperature(selectedEvent.weather_temperature, tempUnit)}</>
              )}
            </div>
          )}
          {selectedEvent.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap pt-1">
              {selectedEvent.tags.map((t, i) => (
                <span key={t} style={stagger(i)} className="mo-chip-pop px-2 py-0.5 bg-land rounded text-xs">{t}</span>
              ))}
            </div>
          )}
        </div>
        {isJournalEntry(selectedEvent) && selectedEvent.content_markdown && (
          <div className="markdown text-[0.9375rem]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(url) => url}
              components={mdComponents}
            >
              {selectedEvent.content_markdown}
            </ReactMarkdown>
          </div>
        )}
        {(() => {
          const media = mediaOf(selectedEvent);
          const content = isJournalEntry(selectedEvent) ? selectedEvent.content_markdown : '';
          const placed = referencedAttachmentIds(content);
          // Images already placed inline render in the text above; only show the
          // rest (legacy/unplaced) here so nothing appears twice.
          const images = media.filter((m) => m.kind === 'image' && !placed.has(m.id));
          const audio = media.filter((m) => m.kind === 'audio');
          if (images.length === 0 && audio.length === 0) return null;
          return (
            <div className="space-y-2">
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img) => (
                    <img
                      key={img.id}
                      src={img.data}
                      alt={img.name}
                      loading="lazy"
                      onClick={(e) => setLightbox({ src: img.data, alt: img.name, id: img.id, hasOriginal: img.original, originalName: img.originalName, originRect: e.currentTarget.getBoundingClientRect() })}
                      className="h-32 w-32 cursor-zoom-in rounded-lg border border-water object-cover"
                    />
                  ))}
                </div>
              )}
              {audio.map((clip) => (
                <div key={clip.id} className="space-y-1 rounded-lg border border-water bg-surface p-2">
                  <div className="text-[11px] text-ink/50">🎙 {clip.name || 'Voice note'}</div>
                  {/* A voice note is its own content; there is no separate caption track to add. */}
                  <audio controls src={clip.data} className="w-full" />
                </div>
              ))}
            </div>
          );
        })()}
        {selectedEvent.type === 'place' && (() => {
          const place = selectedEvent as Place;
          return (
            <div className="space-y-1 text-sm">
              <div>Visited: {place.visited ? '✅ Yes' : '❌ No'}</div>
              {place.rating && <div>Rating: {'★'.repeat(place.rating)}{'☆'.repeat(5 - place.rating)}</div>}
            </div>
          );
        })()}
      </div>
      {lightbox && (
        <Lightbox
          src={lightbox.src}
          alt={lightbox.alt}
          attachmentId={lightbox.id}
          hasOriginal={lightbox.hasOriginal}
          originalName={lightbox.originalName}
          originRect={lightbox.originRect}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
