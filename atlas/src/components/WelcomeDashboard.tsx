import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../store/atlas';
import { useSettings } from '../store/settings';
import { useDialogs } from './ui/dialogs';
import { useGeolocation } from '../hooks/useGeolocation';
import { formatLatLng, formatTemperature } from '../utils';
import { pickFresh } from '../utils/pickFresh';
import { stagger } from '../utils/motion';
import { reverseGeocode } from '../features/welcome/locationInfo';
import { fetchCurrentWeather, type CurrentWeather } from '../features/welcome/weather';
import { seasonFor } from '../features/welcome/season';
import { geoFacts } from '../features/welcome/geoFacts';
import OnThisDayRibbon from '../features/insights/OnThisDayRibbon';
import CalendarHeatmap from '../features/insights/CalendarHeatmap';
import Stats from '../features/insights/Stats';
import UpcomingHolidays from '../features/insights/UpcomingHolidays';
import { reconcileOrder, type WelcomeCardId } from '../features/welcome/cards';
import NearbyPOICard from '../features/welcome/NearbyPOICard';
import DailyFocus from '../features/welcome/DailyFocus';

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// A small "time of day" chip from the offline day/night phase.
const PHASE_CHIP: Record<string, string> = {
  day: '☀ Daytime',
  golden: '🌅 Golden hour',
  night: '🌙 Night',
};

/**
 * The greeting hero, daily focus, "on this day" ribbon, card grid and
 * phone-only stats/calendar — everything the welcome screen shows, minus the
 * scroll shell around it. Extracted from `WelcomeState.tsx` (MOTION_PLAN.md
 * Part II, P1) so the SAME component can be the desktop main-pane's own
 * screen (`WelcomeState.tsx`, unchanged in effect) AND embed at the top of
 * the phone Timeline tab (`features/timeline/Timeline.tsx`), which absorbs
 * this content on phones instead of showing it as a separate destination —
 * every tab is a tap away now that the drawer's gone, so there's no longer a
 * separate "go home" gesture to reach it through.
 */
export default function WelcomeDashboard() {
  const startComposing = useAtlasStore((s) => s.startComposing);
  const events = useAtlasStore((s) => s.events);
  const setWeatherCode = useAtlasStore((s) => s.setWeatherCode);
  const setCoords = useAtlasStore((s) => s.setCoords);
  const setWindKph = useAtlasStore((s) => s.setWindKph);
  const dayPhase = useAtlasStore((s) => s.dayPhase);
  const geo = useGeolocation();

  const name = useSettings((s) => s.name);
  const title = useSettings((s) => s.title);
  const coordFormat = useSettings((s) => s.coordFormat);
  const tempUnit = useSettings((s) => s.tempUnit);
  const onlineLookups = useSettings((s) => s.onlineLookups);
  const cardOpacity = useSettings((s) => s.cardOpacity);
  const showFocus = useSettings((s) => s.showFocus);
  const cardOrder = useSettings((s) => s.welcomeCardOrder);
  const cardHidden = useSettings((s) => s.welcomeCardHidden);
  const updateSetting = useSettings((s) => s.update);
  const { prompt: promptDialog } = useDialogs();

  // Looked-up place name + weather (null until/unless they resolve).
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  // Mobile only: the calendar is tucked behind a tap so it doesn't dangle at the
  // bottom of the welcome screen (desktop shows it in the insights rail instead).
  const [showCalendar, setShowCalendar] = useState(false);

  useEffect(() => {
    geo.requestPosition();
  }, []);

  // Re-check location whenever you return to the app, so the day/night cycle
  // follows you if you've travelled. Silent once permission is granted.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') geo.requestPosition(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [geo.requestPosition]);

  // Share coordinates app-wide (day/night cycle, POI lookups, etc.).
  useEffect(() => {
    if (geo.latitude != null && geo.longitude != null) {
      setCoords({ lat: geo.latitude, lon: geo.longitude });
    }
  }, [geo.latitude, geo.longitude, setCoords]);

  // Resolve coordinates → a place name + current weather (read-only public
  // sources; fails soft). Skipped entirely when online lookups are off.
  useEffect(() => {
    if (geo.latitude == null || geo.longitude == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!onlineLookups) { setLookupDone(true); return; }
    const ctrl = new AbortController();
    const lat = geo.latitude;
    const lon = geo.longitude;
    Promise.all([
      reverseGeocode(lat, lon, ctrl.signal),
      fetchCurrentWeather(lat, lon, ctrl.signal),
    ])
      .then(([nm, wx]) => {
        setPlaceName(nm);
        setWeather(wx);
        setWeatherCode(wx?.code ?? null);
        setWindKph(wx?.windKph ?? null);
      })
      .catch(() => {})
      .finally(() => setLookupDone(true));
    return () => ctrl.abort();
  }, [geo.latitude, geo.longitude, onlineLookups, setWeatherCode, setWindKph]);

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const season = seasonFor(now, geo.latitude);

  // Geographer's almanac — a fresh fact each visit, avoiding recently-shown ones.
  const [fact, setFact] = useState(() => pickFresh('almanac', geoFacts(null, null)) ?? '');
  const geoFactReady = useRef(false);
  useEffect(() => {
    if (geo.latitude != null && geo.longitude != null && !geoFactReady.current) {
      geoFactReady.current = true;
      setFact(pickFresh('almanac', geoFacts(geo.latitude, geo.longitude)) ?? '');
    }
  }, [geo.latitude, geo.longitude]);
  const reshuffleFact = () => setFact(pickFresh('almanac', geoFacts(geo.latitude, geo.longitude)) ?? '');

  // Journal stats (all local — no network).
  const stats = useMemo(() => {
    const located = events.filter((e) => !(e.longitude === 0 && e.latitude === 0)).length;
    const earliest = events.reduce<string | null>(
      (min, e) => (!min || e.timestamp < min ? e.timestamp : min),
      null,
    );
    const since = earliest
      ? new Date(earliest).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : null;
    return { total: events.length, located, since };
  }, [events]);

  const editName = async () => {
    const next = await promptDialog({
      title: name ? 'Edit your name' : 'What should we call you?',
      label: 'Name',
      placeholder: 'Your name',
      defaultValue: name,
      confirmLabel: 'Save',
    });
    if (next !== null) updateSetting('name', next.trim());
  };

  // The smaller welcome cards, in the user's saved order, minus hidden ones. (The
  // writing prompt is not among these — it lives in the "Today's focus" card up
  // top, so it isn't duplicated in the grid.)
  const hiddenSet = useMemo(() => new Set(cardHidden), [cardHidden]);
  const visibleCards = useMemo(
    () => reconcileOrder(cardOrder).filter((id) => !hiddenSet.has(id)),
    [cardOrder, hiddenSet],
  );

  const renderCard = (id: WelcomeCardId): React.ReactNode => {
    switch (id) {
      case 'almanac':
        return (
          <div className="welcome-card rounded-lg border border-water p-3 animate-card-in">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">Geographer's almanac</span>
              <button
                onClick={reshuffleFact}
                className="icon-spin text-ink/40 hover:text-terracotta text-sm leading-none"
                title="Show another fact"
                aria-label="Show another fact"
              >
                ↻
              </button>
            </div>
            <p className="font-serif text-sm text-ink/70 leading-relaxed">{fact}</p>
          </div>
        );
      case 'holidays': return <UpcomingHolidays />;
      case 'poi': return <NearbyPOICard />;
      default: return null;
    }
  };

  const locationLine =
    geo.latitude == null || geo.longitude == null
      ? geo.loading
        ? '📍 Finding where you are…'
        : '📍 Location off — entries can still be written'
      : placeName
        ? `📍 You're in ${placeName}`
        : !lookupDone
          ? '📍 Looking up where you are…'
          : `📍 You're near ${formatLatLng(geo.longitude, geo.latitude, coordFormat)}`;

  return (
    // The animated weather backdrop is a single app-wide layer; cards stay
    // semi-transparent (--card-alpha) so that shared scene shows through them,
    // regardless of whether this is embedded in the desktop welcome screen's
    // own scroll region or the phone Timeline tab's.
    <div
      className="mx-auto w-full max-w-md px-4 pt-4 pb-6 sm:max-w-2xl sm:px-6 sm:py-8 lg:max-w-3xl"
      style={{ '--card-alpha': cardOpacity } as React.CSSProperties}
    >

      {/* ── Hero band — greeting, identity, place, weather and time-of-day as
          one cohesive strip that anchors the whole screen. Each top-level
          section below carries its own entrance + stagger index, so the
          welcome screen cascades in (hero → focus → ribbon → cards →
          stats/calendar) instead of the whole thing appearing at once. ── */}
      <div className="welcome-card rounded-xl border border-water p-4 sm:p-5 animate-fade-in-up" style={stagger(0)}>
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="shrink-0 text-3xl animate-floaty">🧭</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-xl font-bold leading-tight sm:text-2xl">
              {greetingFor(now.getHours())}{name ? `, ${name}` : ''}
              <button
                onClick={editName}
                className="ml-2 align-middle text-xs font-normal text-ink/30 hover:text-ink"
                title={name ? 'Edit your name' : 'Add your name'}
              >
                {name ? '✎' : '+ name'}
              </button>
            </h2>
            {title && <p className="mt-0.5 text-xs text-ink/45">{title}</p>}
            <p className="mt-1 text-sm text-ink/55">
              {dateLabel} · <span title={`${season.label} (local season)`}>{season.emoji} {season.label}</span>
              {PHASE_CHIP[dayPhase] ? <> · {PHASE_CHIP[dayPhase]}</> : null}
            </p>
            <p className="mt-0.5 text-xs text-ink/45">{locationLine}</p>
            {weather && (
              <p className="mt-0.5 text-xs text-ink/45" title={`Current weather · ${weather.label}`}>
                {weather.emoji} {weather.label} · {formatTemperature(weather.temperatureC, tempUnit)}
              </p>
            )}
          </div>
        </div>

        {/* Action row. On phones the button leads (order-1) and the caption
            follows, packed left. On wider cards the caption sits left and the
            button moves flush-right (justify-between) so it doesn't dangle in
            the lower-left with empty space beside it. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-between">
          <button
            onClick={() => startComposing('journal')}
            className="btn btn-primary btn-lg order-1 sm:order-2"
          >
            + New entry
          </button>
          <span className="text-xs text-ink/55 order-2 sm:order-1">
            {stats.total === 0 ? (
              'Your first entry starts the map.'
            ) : (
              <>
                <span className="font-medium text-ink/80">{stats.total}</span>{' '}
                {stats.total === 1 ? 'entry' : 'entries'}
                {stats.located > 0 && <> · <span className="font-medium text-ink/80">{stats.located}</span> pinned</>}
                {stats.since && <> · since {stats.since}</>}
              </>
            )}
          </span>
        </div>
      </div>

      {/* ── Daily focal point — one large rotating card (prompt / nearby place).
          Toggleable via the "Today's focus card" setting. ── */}
      {showFocus && (
        <div className="animate-fade-in-up" style={stagger(1)}>
          <DailyFocus className="mt-4" />
        </div>
      )}

      {/* ── "On this day" story ribbon. ── */}
      <div className="animate-fade-in-up" style={stagger(2)}>
        <OnThisDayRibbon className="mt-4" />
      </div>

      {/* ── Everything else flows in a masonry grid rather than one long column. ── */}
      <div className="mt-4 gap-3 [column-gap:0.75rem] sm:columns-2 animate-fade-in-up" style={stagger(3)}>
        {visibleCards.map((id) => {
          const el = renderCard(id);
          return el ? <div key={id} className="mb-3 break-inside-avoid">{el}</div> : null;
        })}
      </div>

      {/* Stats + calendar — phone only; on desktop these live in the insights
          rail beside the map (see MainPane). The calendar is collapsed behind a
          tap so it doesn't dangle at the bottom of the welcome screen. */}
      <div className="animate-fade-in-up" style={stagger(4)}>
        <Stats className="mt-3 md:hidden" />
        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setShowCalendar((v) => !v)}
            className="welcome-card mt-3 flex w-full items-center justify-between rounded-lg border border-water p-3 text-left"
            aria-expanded={showCalendar}
          >
            <span className="flex items-center gap-2 text-sm text-ink/80">📅 Calendar</span>
            <span className={`text-ink/40 transition-transform ${showCalendar ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
          </button>
          {showCalendar && <CalendarHeatmap className="mt-2" />}
        </div>
      </div>
    </div>
  );
}
