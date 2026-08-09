import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '../store/atlas';
import { useSettings } from '../store/settings';
import WelcomeState from './WelcomeState';
import ErrorBoundary from './ErrorBoundary';
import CalendarHeatmap from '../features/insights/CalendarHeatmap';
import OnThisDay from '../features/insights/OnThisDay';
import Stats from '../features/insights/Stats';
import Presence from './ui/Presence';
import Disclosure from './ui/Disclosure';
import IconSwap from './ui/IconSwap';
import BottomSheet from './ui/BottomSheet';
import { useEffectiveMotion } from '../hooks/useEffectiveMotion';
import { useIsTwoPane } from '../hooks/useIsTwoPane';

// Heavy, interaction-gated surfaces load on demand so the initial bundle stays
// small: the map pulls in maplibre-gl, and the reader/editor pull in the Markdown
// stack. Each becomes its own chunk, fetched the first time it's actually needed.
const MapView = lazy(() => import('./map/Map'));
const EventCard = lazy(() => import('../features/journal/EventCard'));
const JournalEditor = lazy(() => import('../features/journal/JournalEditor'));
const DayDetail = lazy(() => import('../features/day/DayDetail'));
const TripDetail = lazy(() => import('../features/trips/TripDetail'));
// Named `YearReviewView` on disk so the file doesn't collide with the pure
// `yearReview.ts` module it renders — on a case-insensitive filesystem those two
// names are the same path.
const YearReview = lazy(() => import('../features/insights/YearReviewView'));

function PaneFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-ink/30">Loading…</div>;
}

/**
 * The journal-first main surface. Writing and reading happen here at full size;
 * the map is demoted to a small card in the top-right that you can expand on
 * demand. (Meridian is a journal app first — the map is a supporting view.)
 */
export default function MainPane() {
  const composing = useAtlasStore((s) => s.composing);
  const stopComposing = useAtlasStore((s) => s.stopComposing);
  const editing = useAtlasStore((s) => s.editing);
  const startEditing = useAtlasStore((s) => s.startEditing);
  const stopEditing = useAtlasStore((s) => s.stopEditing);
  const selectedEvent = useAtlasStore((s) => s.selectedEvent);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectedDay = useAtlasStore((s) => s.selectedDay);
  const selectDay = useAtlasStore((s) => s.selectDay);
  const selectedTrip = useAtlasStore((s) => s.selectedTrip);
  const selectTrip = useAtlasStore((s) => s.selectTrip);
  const yearReviewOpen = useAtlasStore((s) => s.yearReviewOpen);
  const setYearReviewOpen = useAtlasStore((s) => s.setYearReviewOpen);
  const pickingLocation = useAtlasStore((s) => s.pickingLocation);
  const setPickingLocation = useAtlasStore((s) => s.setPickingLocation);
  const showPaths = useSettings((s) => s.showPaths);
  const showHeatmap = useSettings((s) => s.showHeatmap);
  const isTwoPane = useIsTwoPane();
  const updateSetting = useSettings((s) => s.update);
  // Lives in the store, not local state, so App.tsx can tell a phone should
  // show the (now-expanded) map instead of the active tab's list — see
  // `mobileDetailOpen` there.
  const mapExpanded = useAtlasStore((s) => s.mapExpanded);
  const setMapExpanded = useAtlasStore((s) => s.setMapExpanded);

  // While picking a location, the map needs to be big enough to click accurately.
  const expanded = mapExpanded || pickingLocation;

  // Clicking the mini map opens it, alongside the ⤢ button — see MapView's
  // `onSurfaceClick`. Stable identity so it doesn't re-register on every render.
  const expandMap = useCallback(() => setMapExpanded(true), [setMapExpanded]);

  // M15: while the frame is still growing from mini to full-screen, hold off the
  // chrome (legend/readout/locate-error inside Map.tsx, the layer toggles here)
  // so it doesn't fly around mid-resize — it fades in once `.map-shell`'s own
  // `--mo-slow` grow transition (index.css) has had time to settle.
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const motion = useEffectiveMotion();
  // Syncing `settling` to `expanded` flipping true — the whole point of this
  // effect, and harmless: it only runs alongside a render this component was
  // already doing because `expanded` itself just changed.
  useEffect(() => {
    if (!expanded || motion === 'off') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettling(false);
      return;
    }
    setSettling(true);
    settleTimer.current = setTimeout(() => setSettling(false), 420);
    return () => { if (settleTimer.current) clearTimeout(settleTimer.current); };
  }, [expanded, motion]);

  return (
    <div className="h-full w-full relative overflow-hidden bg-transparent">
      {/* Journal surface. On desktop, reserve a right gutter for the mini map so
          nothing hides behind it; on mobile the map floats away (see below). */}
      <div className={`absolute inset-0 ${expanded ? '' : 'md:pr-[324px]'}`}>
        <Suspense fallback={<PaneFallback />}>
          {editing && editing.type === 'journal' && (
            <BottomSheet onDismiss={stopEditing}>
              <JournalEditor event={editing} onClose={stopEditing} />
            </BottomSheet>
          )}
          {!editing && composing === 'journal' && (
            <BottomSheet onDismiss={stopComposing}>
              <JournalEditor onClose={stopComposing} />
            </BottomSheet>
          )}
          {!editing && !composing && selectedEvent && (
            <BottomSheet onDismiss={() => selectEvent(null)}>
              <EventCard onEdit={() => startEditing(selectedEvent)} />
            </BottomSheet>
          )}
          {!editing && !composing && !selectedEvent && selectedDay && (
            <BottomSheet onDismiss={() => selectDay(null)}>
              <DayDetail />
            </BottomSheet>
          )}
          {!editing && !composing && !selectedEvent && !selectedDay && selectedTrip && (
            <BottomSheet onDismiss={() => selectTrip(null)}>
              <TripDetail />
            </BottomSheet>
          )}
          {!editing && !composing && !selectedEvent && !selectedDay && !selectedTrip && yearReviewOpen && (
            <BottomSheet onDismiss={() => setYearReviewOpen(false)} desktopClassName="">
              <YearReview onClose={() => setYearReviewOpen(false)} />
            </BottomSheet>
          )}
          {/* Desktop only: on a phone this branch would still MOUNT (App.tsx
              only CSS-hides MainPane there, via `mobileDetailOpen`), and
              WelcomeState/WelcomeDashboard runs real geolocation/weather/
              place-name network effects on mount — a second, invisible copy
              running alongside Timeline's own (P1, MOTION_PLAN.md Part II)
              would double those requests for no visible benefit. `isTwoPane`
              is the same live breakpoint check Timeline.tsx gates on. */}
          {!editing && !composing && !selectedEvent && !selectedDay && !selectedTrip && !yearReviewOpen && isTwoPane && <WelcomeState />}
        </Suspense>
      </div>

      {/* Single map instance — anchored top-right in both states so it can animate
          smoothly between the mini card and full-screen (the box stretches open
          from its corner). Mini is desktop-only; on phones it opens straight to
          full via the "Map" button below. */}
      {/* `map-shell` opts this subtree out of the pane cross-fade (see index.css):
          the map is a WebGL canvas, and snapshotting it for a view transition is
          both expensive and prone to flashing. It simply persists across the swap. */}
      <div
        className={`map-shell absolute top-0 right-0 z-30 overflow-hidden ${
          expanded
            ? 'w-full h-full rounded-none border-0 shadow-none'
            : 'map-clickable hidden md:block w-[300px] h-[216px] mt-3 mr-3 rounded-lg border border-water shadow-md'
        }`}
      >
        <ErrorBoundary
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-land p-3 text-center text-[11px] text-ink/40">
              Map unavailable on this device — your journal still works.
            </div>
          }
        >
          <Suspense fallback={<div className="h-full w-full bg-land" />}>
            {/* Click anywhere on the small map to open it; once it's full-screen a
                map click goes back to meaning nothing (the ✕ button closes it). */}
            <MapView onSurfaceClick={expanded ? undefined : expandMap} settling={settling} />
          </Suspense>
        </ErrorBoundary>
        {!pickingLocation && (
          <button
            onClick={() => setMapExpanded(!mapExpanded)}
            className="absolute top-2 left-2 z-40 flex items-center gap-1 rounded-md border border-water bg-surface/90 px-2.5 py-1.5 text-xs font-semibold text-ink/80 shadow-sm backdrop-blur transition hover:bg-land hover:text-ink active:scale-95"
          >
            <IconSwap active={expanded} on="✕" off="⤢" />
            {expanded ? 'Minimize map' : 'Expand'}
          </button>
        )}
        <Disclosure open={!expanded} className="absolute bottom-1 left-2 z-40">
          <div className="text-[10px] text-ink/50 bg-surface/70 px-1.5 rounded pointer-events-none">
            click the map to open it
          </div>
        </Disclosure>
        <Disclosure open={pickingLocation} className="absolute top-3 left-1/2 -translate-x-1/2 z-40">
          <div className="flex items-center gap-3 px-4 py-2 bg-surface/95 backdrop-blur rounded-full shadow border border-water text-sm">
            <span className="text-ink/80">📍 Click on the map to set this entry's location</span>
            <button
              onClick={() => setPickingLocation(false)}
              className="text-ink/50 hover:text-ink text-xs"
            >
              Cancel
            </button>
          </div>
        </Disclosure>

        {/* Map layer toggles — only on the expanded map, where there's room.
            Route traces your located entries in date order; the heatmap washes
            in a "where I've been" density over all of them.

            On a phone they sit one tier above the map's own bottom row (the
            coordinate readout and the locate button) — side by side there isn't
            enough width, and they used to cover the coordinates. See the
            `--map-tier-*` vars on `.map-shell` in index.css. */}
        <Presence
          when={expanded && !pickingLocation && !settling}
          exitMs={160}
          enterClassName="mo-rise-in"
          exitClassName="mo-fade-out"
          className="absolute bottom-[var(--map-tier-2)] left-3 z-40 flex gap-2 md:bottom-3"
        >
          <button
            onClick={() => updateSetting('showPaths', !showPaths)}
            title="Connect your located entries in date order"
            className={`rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur transition-colors ${
              showPaths ? 'border-terracotta bg-terracotta text-white' : 'border-water bg-surface/90 text-ink/70 hover:bg-land'
            }`}
          >
            ⤳ Route {showPaths ? 'on' : 'off'}
          </button>
          <button
            onClick={() => updateSetting('showHeatmap', !showHeatmap)}
            title="Density heatmap of everywhere you've journaled"
            className={`rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur transition-colors ${
              showHeatmap ? 'border-terracotta bg-terracotta text-white' : 'border-water bg-surface/90 text-ink/70 hover:bg-land'
            }`}
          >
            ◍ Heatmap {showHeatmap ? 'on' : 'off'}
          </button>
        </Presence>
      </div>

      {/* Insights rail — desktop only, tucked under the mini-map. A temporal
          companion to the map: a calendar of your entries and "on this day"
          memories. Hidden while the map is expanded. On phones these same cards
          live on the welcome screen instead (no rail exists there). */}
      <Presence
        when={!expanded}
        exitMs={160}
        enterClassName="mo-rise-in"
        exitClassName="mo-fade-out"
        className="hidden md:flex md:flex-col gap-3 absolute right-3 top-[232px] bottom-3 w-[300px] overflow-y-auto z-20"
      >
        <Stats />
        <CalendarHeatmap />
        <OnThisDay />
      </Presence>
      {/* The mobile "open the map" FAB used to live here, but P1 (MOTION_PLAN.md
          Part II) hides this entire component on a phone whenever the active
          tab's list is what's showing — a button inside MainPane would be
          exactly as unreachable as the thing it's meant to open. It now lives
          in App.tsx, a sibling of both MainPane and the tab bar, and just
          calls this same `setMapExpanded(true)`. */}
    </div>
  );
}
