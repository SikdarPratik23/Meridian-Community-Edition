import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { formatDate, getDayGroup, getDayKey, isDateTitle } from '../../utils';
import { computeTrips } from '../trips/trips';
import { MAP_STYLE_OPTIONS } from '../map/mapStyle';
import { highlightParts, rank, type Rankable } from './commandSearch';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';
import { stagger } from '../../utils/motion';
import { toast } from '../../components/ui/toasts';
import type { AnyEvent } from '../../types';

/**
 * The command palette — one place to jump anywhere or do anything.
 *
 * A journal accumulates hundreds of entries, at which point "find the thing" stops
 * being a browsing problem and becomes a typing problem. The palette answers it
 * directly: type a few characters and get entries, days, trips and actions ranked
 * together, then Enter.
 *
 * It complements rather than replaces the Search tab, which is a different tool —
 * search filters and *stays* on screen with its chips and result list, for
 * questions like "everything with a photo near here". The palette is transient and
 * keyboard-first, for "take me to Zugspitze".
 *
 * Works on both form factors, deliberately:
 *   - **Desktop:** ⌘K / Ctrl+K opens it as a centred dialog; ↑↓ move, Enter runs,
 *     Escape closes.
 *   - **Phone:** no keyboard shortcut is reachable, so there's a 🔍 button in the
 *     sidebar header, and the panel renders as a bottom sheet with the input at the
 *     TOP of the sheet, above the on-screen keyboard rather than behind it.
 *
 * The candidate list is derived, never persisted, and rebuilt from the store — so it
 * can't go stale relative to the journal.
 */

type CommandGroup = 'Actions' | 'Settings' | 'Trips' | 'Days' | 'Entries';

interface Command extends Rankable {
  id: string;
  group: CommandGroup;
  /** Shown right-aligned, dimmed — a date, a place, a hint. */
  detail?: string;
  glyph: string;
  /** If true, only appears in search results when a search query is typed (keeps default open list clean) */
  searchOnly?: boolean;
  run: () => void;
}

/** How many entries to offer. Everything is searchable via ranking; this only
 *  bounds the DEFAULT (unfiltered) list, which nobody scrolls past anyway. */
const RECENT_ENTRIES = 60;

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectDay = useAtlasStore((s) => s.selectDay);
  const selectTrip = useAtlasStore((s) => s.selectTrip);
  const startComposing = useAtlasStore((s) => s.startComposing);
  const setYearReviewOpen = useAtlasStore((s) => s.setYearReviewOpen);
  const navigateTab = useAtlasStore((s) => s.navigateTab);
  const update = useSettings((s) => s.update);
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const mapStyle = useSettings((s) => s.mapStyle);
  const tempUnit = useSettings((s) => s.tempUnit);
  const coordFormat = useSettings((s) => s.coordFormat);
  const fontSize = useSettings((s) => s.fontSize);
  const motionSetting = useSettings((s) => s.motion);
  const graphicsQuality = useSettings((s) => s.graphicsQuality);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const motion = useEffectiveMotion();
  // M38: the highlighted-row indicator's rect, measured from the active row's
  // OWN offsetTop/offsetHeight rather than getBoundingClientRect() — unlike
  // the segmented control / sidebar tabs (`useSlidingIndicator`), this list
  // scrolls, and offsetTop is the one measurement that stays correct
  // regardless of scroll position (see index.css for the longer version).
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  // Rows stagger in once, on open — not on every keystroke's re-filter, or
  // fast typing would replay the cascade continuously. ~stagger(8)+entrance.
  const [justOpened, setJustOpened] = useState(true);
  useEffect(() => {
    if (motion === 'off') {
      // Synchronous by design: motion being off means there's nothing to wait
      // out — same rationale as Presence.tsx's own documented exception.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJustOpened(false);
      return;
    }
    const t = setTimeout(() => setJustOpened(false), 600);
    return () => clearTimeout(t);
  }, [motion]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // Plays the exit animation before actually unmounting — unlike `run()` below,
  // which closes INSTANTLY on purpose (see its own comment): a plain dismissal
  // has nothing else competing for the screen, so it's free to animate.
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(onClose, motion === 'off' ? 0 : 160);
  }, [closing, motion, onClose]);

  const commands = useMemo<Command[]>(() => {
    const live = events.filter((e) => !e.deleted_at);
    const list: Command[] = [];

    // ── Primary Actions (visible in clean default list) ──
    list.push({
      id: 'action:new',
      group: 'Actions',
      label: 'New entry',
      glyph: '＋',
      keywords: ['write', 'compose', 'add', 'journal'],
      run: () => startComposing('journal'),
    });
    list.push({
      id: 'action:year',
      group: 'Actions',
      label: 'Year in review',
      glyph: '🗓',
      keywords: ['stats', 'retrospective', 'summary', 'wrapped'],
      run: () => setYearReviewOpen(true),
    });
    list.push({
      id: 'action:theme',
      group: 'Actions',
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      glyph: theme === 'dark' ? '☀' : '☾',
      detail: `now: ${theme}`,
      keywords: ['dark', 'light', 'night', 'appearance', 'theme'],
      run: () => update('theme', theme === 'dark' ? 'light' : 'dark'),
    });
    const at = Math.max(0, MAP_STYLE_OPTIONS.findIndex((o) => o.id === mapStyle));
    const nextStyle = MAP_STYLE_OPTIONS[(at + 1) % MAP_STYLE_OPTIONS.length];
    list.push({
      id: 'action:mapstyle',
      group: 'Actions',
      label: `Use the ${nextStyle.label.toLowerCase()} basemap`,
      glyph: '🗺',
      detail: `now: ${MAP_STYLE_OPTIONS[at].label.toLowerCase()}`,
      keywords: ['map', 'basemap', 'tiles', 'style', 'satellite', 'imagery', 'hybrid', 'parchment', 'osm'],
      run: () => update('mapStyle', nextStyle.id),
    });
    list.push({
      id: 'action:sync',
      group: 'Actions',
      label: 'Sync now',
      glyph: '🔄',
      searchOnly: true,
      keywords: ['sync', 'synchronize', 'backup', 'file link', 'cloud', 'push', 'pull'],
      run: async () => {
        const { runSync } = await import('../../data/sync');
        const r = await runSync();
        if (r.ok) {
          toast.success('Journal synced');
        } else {
          toast.error('Sync failed — check Data → Sync folder');
        }
      },
    });

    // ── Search-Only Settings & Preferences (only reveal when searching) ──
    list.push({
      id: 'settings:open',
      group: 'Settings',
      label: 'Open Settings',
      glyph: '⚙',
      searchOnly: true,
      keywords: ['settings', 'preferences', 'configuration', 'options', 'setup', 'tools'],
      run: () => navigateTab('settings'),
    });
    list.push({
      id: 'settings:theme-light',
      group: 'Settings',
      label: 'Theme: Light (Cartographer)',
      glyph: '☀',
      detail: theme === 'light' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['theme', 'light', 'appearance', 'day', 'white', 'parchment', 'settings'],
      run: () => update('theme', 'light'),
    });
    list.push({
      id: 'settings:theme-dark',
      group: 'Settings',
      label: 'Theme: Dark (Nocturnal)',
      glyph: '☾',
      detail: theme === 'dark' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['theme', 'dark', 'night', 'appearance', 'black', 'slate', 'settings'],
      run: () => update('theme', 'dark'),
    });
    list.push({
      id: 'settings:theme-system',
      group: 'Settings',
      label: 'Theme: Follow System OS',
      glyph: '🌓',
      detail: theme === 'system' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['theme', 'system', 'automatic', 'os', 'appearance', 'settings'],
      run: () => update('theme', 'system'),
    });
    list.push({
      id: 'settings:lang-en',
      group: 'Settings',
      label: 'Language: English',
      glyph: '🌐',
      detail: language === 'en' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['language', 'english', 'locale', 'i18n', 'translation', 'settings'],
      run: () => update('language', 'en'),
    });
    list.push({
      id: 'settings:lang-bn',
      group: 'Settings',
      label: 'Language: বাংলা (Bengali)',
      glyph: '🌐',
      detail: language === 'bn' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['language', 'bengali', 'bangla', 'বাংলা', 'locale', 'i18n', 'translation', 'settings'],
      run: () => update('language', 'bn'),
    });
    // Font / text size settings
    list.push({
      id: 'settings:font:small',
      group: 'Settings',
      label: 'Text size: Small (Compact)',
      glyph: 'Aa',
      detail: fontSize === 'small' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['font size', 'text size', 'compact', 'small', 'typography', 'scale', 'settings'],
      run: () => update('fontSize', 'small'),
    });
    list.push({
      id: 'settings:font:medium',
      group: 'Settings',
      label: 'Text size: Medium (Default)',
      glyph: 'Aa',
      detail: fontSize === 'medium' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['font size', 'text size', 'medium', 'default', 'typography', 'scale', 'settings'],
      run: () => update('fontSize', 'medium'),
    });
    list.push({
      id: 'settings:font:large',
      group: 'Settings',
      label: 'Text size: Large',
      glyph: 'Aa',
      detail: fontSize === 'large' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['font size', 'text size', 'large', 'big text', 'typography', 'scale', 'settings'],
      run: () => update('fontSize', 'large'),
    });
    list.push({
      id: 'settings:font:xlarge',
      group: 'Settings',
      label: 'Text size: Extra Large',
      glyph: 'Aa',
      detail: fontSize === 'x-large' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['font size', 'text size', 'extra large', 'xl', 'huge text', 'typography', 'scale', 'settings'],
      run: () => update('fontSize', 'x-large'),
    });
    // Animation / motion settings
    list.push({
      id: 'settings:motion:full',
      group: 'Settings',
      label: 'Interface motion: Full animations',
      glyph: '✨',
      detail: motionSetting === 'full' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['motion', 'animation', 'smooth', 'transitions', 'full animations', 'effects', 'settings'],
      run: () => update('motion', 'full'),
    });
    list.push({
      id: 'settings:motion:reduced',
      group: 'Settings',
      label: 'Interface motion: Reduced motion',
      glyph: '✨',
      detail: motionSetting === 'reduced' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['motion', 'animation', 'reduced motion', 'subtle', 'settings'],
      run: () => update('motion', 'reduced'),
    });
    list.push({
      id: 'settings:motion:off',
      group: 'Settings',
      label: 'Interface motion: Off (Instant)',
      glyph: '⚡',
      detail: motionSetting === 'off' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['motion', 'animation', 'disable animation', 'instant', 'no motion', 'off', 'settings'],
      run: () => update('motion', 'off'),
    });
    // Graphics quality settings
    list.push({
      id: 'settings:graphics:low',
      group: 'Settings',
      label: 'Graphics: Low (Battery saver)',
      glyph: '🔋',
      detail: graphicsQuality === 'low' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['graphics', 'quality', 'low', 'battery', 'saver', 'performance', 'backdrop', 'scene', 'settings'],
      run: () => update('graphicsQuality', 'low'),
    });
    list.push({
      id: 'settings:graphics:medium',
      group: 'Settings',
      label: 'Graphics: Medium',
      glyph: '🖥',
      detail: graphicsQuality === 'medium' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['graphics', 'quality', 'medium', 'balanced', 'backdrop', 'scene', 'settings'],
      run: () => update('graphicsQuality', 'medium'),
    });
    list.push({
      id: 'settings:graphics:high',
      group: 'Settings',
      label: 'Graphics: High',
      glyph: '🌟',
      detail: graphicsQuality === 'high' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['graphics', 'quality', 'high', 'atmosphere', 'particles', 'backdrop', 'scene', 'settings'],
      run: () => update('graphicsQuality', 'high'),
    });
    list.push({
      id: 'settings:graphics:ultra',
      group: 'Settings',
      label: 'Graphics: Ultra (WebGL atmosphere)',
      glyph: '✨',
      detail: graphicsQuality === 'ultra' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['graphics', 'quality', 'ultra', 'webgl', 'atmosphere', 'particles', 'backdrop', 'scene', 'settings'],
      run: () => update('graphicsQuality', 'ultra'),
    });
    // Map basemap style options
    for (const opt of MAP_STYLE_OPTIONS) {
      list.push({
        id: `settings:mapstyle:${opt.id}`,
        group: 'Settings',
        label: `Map Style: ${opt.label}`,
        glyph: '🗺',
        detail: mapStyle === opt.id ? 'active' : undefined,
        searchOnly: true,
        keywords: ['map', 'basemap', 'style', 'satellite', 'hybrid', 'parchment', 'osm', 'tiles', opt.label.toLowerCase(), 'settings'],
        run: () => update('mapStyle', opt.id),
      });
    }
    // Temperature unit settings
    list.push({
      id: 'settings:temp-c',
      group: 'Settings',
      label: 'Temperature Unit: Celsius (°C)',
      glyph: '🌡',
      detail: tempUnit === 'C' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['temperature', 'celsius', 'degrees', 'weather', 'unit', 'settings'],
      run: () => update('tempUnit', 'C'),
    });
    list.push({
      id: 'settings:temp-f',
      group: 'Settings',
      label: 'Temperature Unit: Fahrenheit (°F)',
      glyph: '🌡',
      detail: tempUnit === 'F' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['temperature', 'fahrenheit', 'degrees', 'weather', 'unit', 'settings'],
      run: () => update('tempUnit', 'F'),
    });
    // Coordinates format settings
    list.push({
      id: 'settings:coords:dd',
      group: 'Settings',
      label: 'Coordinates Format: Decimal Degrees (DD)',
      glyph: '📍',
      detail: coordFormat === 'decimal' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['coordinates', 'format', 'gps', 'location', 'decimal', 'latitude', 'longitude', 'settings'],
      run: () => update('coordFormat', 'decimal'),
    });
    list.push({
      id: 'settings:coords:dms',
      group: 'Settings',
      label: 'Coordinates Format: Degrees, Minutes, Seconds (DMS)',
      glyph: '📍',
      detail: coordFormat === 'dms' ? 'active' : undefined,
      searchOnly: true,
      keywords: ['coordinates', 'format', 'gps', 'location', 'dms', 'degrees', 'latitude', 'longitude', 'settings'],
      run: () => update('coordFormat', 'dms'),
    });
    // Data & Export
    list.push({
      id: 'settings:data',
      group: 'Settings',
      label: 'Data, Backup & Export options',
      glyph: '🗃',
      searchOnly: true,
      keywords: ['data', 'export', 'backup', 'import', 'sync', 'geojson', 'gpx', 'markdown', 'settings'],
      run: () => navigateTab('data'),
    });

    // ── Trips ──
    for (const trip of computeTrips(live)) {
      list.push({
        id: `trip:${trip.id}`,
        group: 'Trips',
        label: trip.name,
        glyph: '🧳',
        detail: `${trip.events.length} ${trip.events.length === 1 ? 'entry' : 'entries'}`,
        keywords: trip.placeNames,
        run: () => selectTrip(trip.id),
      });
    }

    // ── Days ── (distinct calendar days, newest first)
    const seenDays = new Set<string>();
    const byNewest = [...live].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    for (const event of byNewest) {
      const key = getDayKey(event.timestamp);
      if (seenDays.has(key)) continue;
      seenDays.add(key);
      const count = live.filter((ev) => getDayKey(ev.timestamp) === key).length;
      list.push({
        id: `day:${key}`,
        group: 'Days',
        label: formatDate(event.timestamp),
        glyph: '📅',
        detail: `${getDayGroup(event.timestamp)} · ${count} ${count === 1 ? 'entry' : 'entries'}`,
        keywords: [key],
        run: () => selectDay(key),
      });
    }

    // ── Entries ── newest first
    for (const event of byNewest.slice(0, RECENT_ENTRIES)) {
      const dated = isDateTitle(event.title, event.timestamp);
      list.push({
        id: `entry:${event.id}`,
        group: 'Entries',
        label: dated ? formatDate(event.timestamp) : event.title,
        glyph: event.type === 'journal' ? '📓' : '📍',
        detail: event.location_name || (dated ? undefined : formatDate(event.timestamp)),
        // Body text is searchable but not shown, so typing a remembered phrase
        // finds the entry without the label becoming a wall of prose.
        keywords: [
          ...event.tags,
          event.location_name ?? '',
          event.trip ?? '',
          event.type === 'journal' ? ((event as { content_markdown?: string }).content_markdown ?? '').slice(0, 400) : '',
        ].filter(Boolean),
        run: () => selectEvent(event as AnyEvent),
      });
    }

    return list;
  }, [events, theme, language, mapStyle, tempUnit, coordFormat, fontSize, motionSetting, graphicsQuality, startComposing, setYearReviewOpen, navigateTab, update, selectTrip, selectDay, selectEvent]);

  const results = useMemo(() => {
    if (!query.trim()) {
      return commands.filter((c) => !c.searchOnly).map((item) => ({ item, score: 0, indices: [] }));
    }
    return rank(commands, query, 50);
  }, [commands, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keep the highlighted row in view when moving by keyboard — smooth now
  // (M39), except under reduced motion where a jump-scroll is more legible
  // than a slow glide and matches every other exit/entrance in the app.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: motion === 'off' ? 'auto' : 'smooth' });
  }, [active, motion]);

  // Measure the active row for the travelling highlight (M38). Re-measures on
  // resize (the phone bottom sheet reflows when the on-screen keyboard opens)
  // in addition to whenever the active row or result set itself changes.
  useEffect(() => {
    const measure = () => {
      const activeEl = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
      setIndicator(activeEl ? { top: activeEl.offsetTop, height: activeEl.offsetHeight } : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [active, results]);

  const run = (index: number) => {
    const chosen = results[index];
    if (!chosen) return;
    // Close first: several commands swap the whole main pane, and doing that while
    // the palette is still mounted makes the view transition fight the overlay.
    onClose();
    chosen.item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[95] flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-start sm:p-4 sm:pt-[12vh] ${closing ? 'dialog-fade-out' : 'animate-dialog-fade'}`}
      onClick={requestClose}
      role="presentation"
    >
      <div
        className={`palette-panel flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl border border-water bg-surface shadow-2xl sm:max-w-xl sm:rounded-2xl ${closing ? 'dialog-pop-out' : 'animate-dialog-pop'}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* The input sits at the top of the sheet so the phone's on-screen keyboard
            rises underneath it rather than over it. */}
        <div className="flex items-center gap-2 border-b border-water px-3 py-2.5">
          <span className="text-ink/35" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            // Reset the highlighted row here rather than in an effect on `query`:
            // an effect would be a second render pass for something already known
            // at the moment of the keystroke.
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Jump to an entry, day, trip — or run a command"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink/35"
            aria-label="Search entries and commands"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={requestClose}
            className="shrink-0 text-xs text-ink/40 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div ref={listRef} className="palette-list min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {indicator && (
            <div
              aria-hidden="true"
              className="palette-row-indicator"
              style={{ '--cmdk-y': `${indicator.top}px`, '--cmdk-h': `${indicator.height}px` } as React.CSSProperties}
            />
          )}
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink/40">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((result, index) => {
              // A group heading is printed whenever the group changes, which gives
              // grouping for free without pre-bucketing the ranked list (and so
              // without disturbing the ranking).
              const previous = results[index - 1]?.item.group;
              const showHeading = result.item.group !== previous;
              return (
                <div
                  key={result.item.id}
                  className={justOpened ? 'animate-fade-in-up' : undefined}
                  style={justOpened ? stagger(index) : undefined}
                >
                  {showHeading && <div className="u-label px-3 pb-1 pt-2">{result.item.group}</div>}
                  <button
                    type="button"
                    data-active={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => run(index)}
                    className={`relative z-[1] flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                      index === active ? 'text-ink' : 'text-ink/75 hover:bg-land'
                    }`}
                  >
                    <span className="w-5 shrink-0 text-center" aria-hidden="true">{result.item.glyph}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {highlightParts(result.item.label, result.indices).map((part, i) =>
                        part.match ? (
                          <mark key={i} className="bg-transparent font-semibold text-terracotta">{part.text}</mark>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </span>
                    {result.item.detail && (
                      <span className="shrink-0 text-[11px] text-ink/40">{result.item.detail}</span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Keyboard hints, desktop only — they'd be noise on a touch device. */}
        <div className="hidden items-center gap-3 border-t border-water px-3 py-1.5 text-[10px] text-ink/35 sm:flex">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          <span className="ml-auto">{results.length} {results.length === 1 ? 'result' : 'results'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
