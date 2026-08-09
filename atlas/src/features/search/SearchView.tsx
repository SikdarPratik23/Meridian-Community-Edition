import { useEffect, useMemo, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { formatDistance, getDayKey } from '../../utils';
import EmptyState, { SearchGlyph } from '../../components/ui/EmptyState';
import Presence from '../../components/ui/Presence';
import Disclosure from '../../components/ui/Disclosure';
import { stagger } from '../../utils/motion';
import { tripNames } from '../trips/trips';
import { useT } from '../../i18n';
import {
  EMPTY_FILTERS,
  RADIUS_OPTIONS,
  activeFilterCount,
  applyFilters,
  availableMoods,
  isFilterActive,
  type SearchFilters,
} from './filters';

/**
 * The search panel.
 *
 * Moved out of `Sidebar.tsx` when the filter chips were added: what was a text box
 * plus a radius toggle is now a real filter bar, and it had outgrown living inside
 * the shell component. All the actual filtering logic is in `./filters.ts` (pure and
 * unit-tested); this file is only the controls.
 *
 * The chips are collapsed behind a "Filters" disclosure by default. Search is used
 * far more often to find a remembered word than to slice the journal by attribute,
 * so the eight chips stay out of the way until asked for — with a count badge so
 * it's never a mystery that a filter is still narrowing the results.
 */

/** A small toggle chip. */
function Chip({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${
        active
          ? 'mo-chip-active mo-chip-pop border-terracotta text-white'
          : 'border-water text-ink/65 hover:bg-land'
      }`}
    >
      {children}
    </button>
  );
}

export interface SearchViewProps {
  /** Focus the query field on mount. False when this is Explore's landing
   *  surface — popping the keyboard the moment you tap a tab you meant to
   *  BROWSE is the wrong default on a phone. */
  autoFocus?: boolean;
  /** What fills the pane while no query or filter is active. Explore passes the
   *  trips list; on its own, SearchView keeps its original "type to search" hint. */
  idleContent?: React.ReactNode;
}

export default function SearchView({ autoFocus = true, idleContent }: SearchViewProps = {}) {
  const t = useT();
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const searchQuery = useAtlasStore((s) => s.searchQuery);
  const setSearchQuery = useAtlasStore((s) => s.setSearchQuery);
  const coords = useAtlasStore((s) => s.coords);
  const mapCenter = useAtlasStore((s) => s.mapCenter);

  // Everything except the text lives here; the query stays in the store so the
  // map and other views can see it.
  const [extra, setExtra] = useState<Omit<SearchFilters, 'query'>>(EMPTY_FILTERS);
  const [showChips, setShowChips] = useState(false);

  // The text query is debounced ~120ms before it feeds the RESULTS (and their
  // stagger animation) — a fast typist would otherwise restart the entrance
  // animation on every keystroke as rows flicker in and out of the matched
  // set. The input itself stays instant (it reads `searchQuery` directly);
  // only what's derived from it for rendering is debounced.
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 120);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filters: SearchFilters = useMemo(() => ({ ...extra, query: searchQuery }), [extra, searchQuery]);
  const resultFilters: SearchFilters = useMemo(() => ({ ...extra, query: debouncedQuery }), [extra, debouncedQuery]);
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setExtra((prev) => ({ ...prev, [key]: value }));

  // Centre for the radius search: your GPS position if known, else wherever the
  // map is currently centred. Null when neither is available.
  const center = useMemo<[number, number] | null>(() => {
    if (coords) return [coords.lon, coords.lat];
    if (mapCenter && !(mapCenter[0] === 0 && mapCenter[1] === 0)) return mapCenter;
    return null;
  }, [coords, mapCenter]);

  const moods = useMemo(() => availableMoods(events), [events]);
  const trips = useMemo(() => tripNames(events), [events]);
  const results = useMemo(() => applyFilters(events, resultFilters, center), [events, resultFilters, center]);

  const active = isFilterActive(filters);
  const chipCount = activeFilterCount(filters) - (searchQuery.trim() ? 1 : 0);

  const clearAll = () => {
    setExtra(EMPTY_FILTERS);
    setSearchQuery('');
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <input
        type="text"
        placeholder={t('search.placeholder')}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full rounded border border-water bg-surface px-3 py-2 text-sm focus:border-terracotta focus:outline-none"
        autoFocus={autoFocus}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowChips((v) => !v)}
          className="btn btn-sm btn-secondary"
          aria-expanded={showChips}
        >
          <span className={`mo-chevron ${showChips ? 'is-open' : ''}`}>›</span>
          {/* Untranslated: the catalogue has no key for the disclosure's own label
              (only for a filter COUNT, which reads wrong as "0 filters" here). */}
          <span className="ml-1.5">Filters</span>
          {chipCount > 0 && (
            <span
              // Keyed on its own value so a CHANGE (not just appearing) replays
              // the pop — a fresh mount is exactly what a key change gives us.
              key={chipCount}
              className="mo-chip-pop ml-1.5 rounded-full bg-terracotta px-1.5 text-[10px] text-white"
              title={chipCount === 1 ? t('search.oneFilter') : t('search.nFilters', { count: chipCount })}
            >
              {chipCount}
            </span>
          )}
        </button>
        {active && (
          <button type="button" onClick={clearAll} className="text-[11px] text-ink/45 hover:text-ink">
            {t('search.clearAll')}
          </button>
        )}
      </div>

      <Disclosure open={showChips}>
        <div className="space-y-2.5 rounded border border-water bg-surface/60 p-2.5">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={filters.hasPhoto} onClick={() => set('hasPhoto', !filters.hasPhoto)}>
              📷 {t('search.hasPhoto')}
            </Chip>
            <Chip active={filters.hasAudio} onClick={() => set('hasAudio', !filters.hasAudio)}>
              🎙 {t('search.hasAudio')}
            </Chip>
            <Chip active={filters.hasLocation} onClick={() => set('hasLocation', !filters.hasLocation)}>
              📍 {t('search.hasLocation')}
            </Chip>
            <Chip
              active={filters.nearMe}
              onClick={() => set('nearMe', !filters.nearMe)}
              disabled={!center}
              title={center ? t('search.nearMeHint') : t('search.locationUnknown')}
            >
              🧭 {t('search.nearMe')}
            </Chip>
          </div>

          {filters.nearMe && center && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink/45">{t('search.within')}</span>
              {RADIUS_OPTIONS.map((r) => (
                <Chip key={r} active={filters.radiusKm === r} onClick={() => set('radiusKm', r)}>
                  {r} km
                </Chip>
              ))}
              <span className="ml-auto text-[10px] text-ink/35">
                {coords ? t('search.ofYourLocation') : t('search.ofMapCentre')}
              </span>
            </div>
          )}

          {moods.length > 0 && (
            <label className="block space-y-1">
              <span className="text-[11px] text-ink/45">{t('search.mood')}</span>
              <select
                value={filters.mood ?? ''}
                onChange={(e) => set('mood', e.target.value || null)}
                className="w-full rounded border border-water bg-surface px-2 py-1.5 text-xs focus:border-terracotta focus:outline-none"
              >
                <option value="">{t('search.anyMood')}</option>
                {moods.map((mood) => (
                  <option key={mood} value={mood}>{mood}</option>
                ))}
              </select>
            </label>
          )}

          {trips.length > 0 && (
            <label className="block space-y-1">
              <span className="text-[11px] text-ink/45">{t('search.trip')}</span>
              <select
                value={filters.trip ?? ''}
                onChange={(e) => set('trip', e.target.value || null)}
                className="w-full rounded border border-water bg-surface px-2 py-1.5 text-xs focus:border-terracotta focus:outline-none"
              >
                <option value="">{t('search.anyTrip')}</option>
                {trips.map((trip) => (
                  <option key={trip} value={trip}>{trip}</option>
                ))}
              </select>
            </label>
          )}

          <div className="flex gap-2">
            <label className="flex-1 space-y-1">
              <span className="text-[11px] text-ink/45">{t('search.dateFrom')}</span>
              <input
                type="date"
                value={filters.from ?? ''}
                max={filters.to ?? undefined}
                onChange={(e) => set('from', e.target.value || null)}
                className="w-full rounded border border-water bg-surface px-2 py-1.5 text-xs focus:border-terracotta focus:outline-none"
              />
            </label>
            <label className="flex-1 space-y-1">
              <span className="text-[11px] text-ink/45">{t('search.dateTo')}</span>
              <input
                type="date"
                value={filters.to ?? ''}
                min={filters.from ?? undefined}
                onChange={(e) => set('to', e.target.value || null)}
                className="w-full rounded border border-water bg-surface px-2 py-1.5 text-xs focus:border-terracotta focus:outline-none"
              />
            </label>
          </div>
        </div>
      </Disclosure>

      <div className="space-y-2">
        {active && (
          <div className="text-[11px] text-ink/40">
            {results.length === 1 ? t('search.oneMatch') : t('search.nMatches', { count: results.length })}
          </div>
        )}
        {results.map(({ event, distanceKm }, i) => (
          <button
            key={event.id}
            style={stagger(i)}
            onClick={() => selectEvent(event)}
            className="animate-fade-in-up block w-full rounded border border-water bg-surface p-2 text-left text-sm transition-colors hover:border-terracotta/50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{event.title}</span>
              {distanceKm != null && (
                <span className="shrink-0 text-[11px] text-ink/40 u-numeric">{formatDistance(distanceKm)}</span>
              )}
            </div>
            <div className="text-xs text-ink/50">
              {event.type} · {getDayKey(event.timestamp)}
              {event.location_name ? ` · ${event.location_name}` : ''}
            </div>
          </button>
        ))}
        <Presence when={active && results.length === 0} exitMs={160} enterClassName="mo-fade-in-plain" exitClassName="mo-fade-out-plain">
          <EmptyState
            glyph={<SearchGlyph className="mo-glyph-drift" />}
            title={t('search.noMatchesTitle')}
            message={
              filters.nearMe && center
                ? t('search.noMatchesNearby', { radius: filters.radiusKm })
                : t('search.noMatches', { query: searchQuery })
            }
          />
        </Presence>
        {/* Nothing typed, no filter set. On its own that's a hint; inside
            Explore it's the whole reason to be here — the trips to browse. */}
        {!active && (idleContent ?? (
          <p className="px-1 pt-2 text-xs leading-relaxed text-ink/40">
            Type to search your entries, or open Filters to slice the journal by photo, location,
            mood, trip or date.
          </p>
        ))}
      </div>
    </div>
  );
}
