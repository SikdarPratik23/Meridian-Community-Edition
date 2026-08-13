import { create } from 'zustand';
import type { AnyEvent, Coordinates, EventType } from '../types';
import { skyPhase, type SkyPhase } from '../features/welcome/sky';
import { withViewTransition, type ViewTransitionDirection } from '../utils/viewTransition';
import type { NearbyPlace } from '../features/welcome/locationInfo';
import type { TranslationKey } from '../i18n';

type Filter = 'all' | EventType;

/** 0,0 ("null island") means the entry was saved without a real location. */
function hasCoords(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

const TWO_PANE = '(min-width: 768px)';

/** Desktop shows the list + main pane side by side; phones show one at a time. */
function isTwoPane(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(TWO_PANE).matches
    : true;
}

/** The list destinations, shared by the desktop sidebar's own tab row and the
 *  phone bottom tab bar (MOTION_PLAN.md Part II, P1) — a single source so both
 *  stay in step with which id maps to which pane and label.
 *
 *  Reshaped 2026-08-08 into Home / Timeline / Explore. What changed and why:
 *  - **`home` is new, and phone-only.** P1 had Timeline double as the phone's
 *    home screen by embedding the welcome dashboard above the entries, which
 *    meant tapping "Timeline" showed the greeting rather than the journal. Home
 *    is now its own destination and Timeline shows entries and nothing else.
 *    Desktop never uses it — there the welcome dashboard has always been
 *    MainPane's own screen (`WelcomeState.tsx`), so a Home *tab* would be a
 *    second copy of something already on screen. `Sidebar.tsx` keeps it out of
 *    the desktop tab row and falls back to `timeline` if it ever sees it.
 *  - **`explore` replaces `trips` + `search`.** They were two destinations over
 *    the same journal — one browsing it by journey, one querying it — and the
 *    phone additionally had a 🔍 tab sitting under a 🔍 palette button in the
 *    header, which read as the same tool twice. Explore is one surface: the
 *    search field and filters on top, the trips list filling it while nothing
 *    is being searched. Nothing was dropped; see `features/explore/`. */
export type View = 'home' | 'timeline' | 'explore' | 'data' | 'settings';

/** Left-to-right reading order, used only to derive a slide direction (M12).  */
export const VIEW_ORDER: View[] = ['home', 'timeline', 'explore', 'data', 'settings'];

export const VIEW_LABELS: Record<View, TranslationKey> = {
  home: 'nav.home',
  timeline: 'nav.timeline',
  explore: 'nav.explore',
  data: 'nav.data',
  settings: 'nav.settings',
};

/** How long the outgoing tab pane's slide-out plays before the store stops
 *  tracking it — matches `--mo-base` at full motion (index.css), same value
 *  `Sidebar.tsx` used locally before this state moved into the store. */
const TAB_PANE_TRANSITION_MS = 260;

/** Cleared/reset on every tab switch; module-level because it outlives any one
 *  React render (same pattern as the rest of this file's plain helpers). */
let tabPaneTimer: ReturnType<typeof setTimeout> | undefined;

/** Reads the effective motion level straight off the DOM rather than a hook —
 *  this runs inside a plain store action, and `App.tsx` already keeps
 *  `document.documentElement.dataset.motion` in sync with the real
 *  (OS-preference-aware) effective level, so there's a single source of truth
 *  to read rather than re-deriving it here. */
function motionOff(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off';
}

/** The direction/slide bookkeeping shared by `setActiveTab` (desktop's own
 *  in-column tab row) and `navigateTab` (the phone bottom tab bar) — both need
 *  the exact same "which way did we move" logic, just different side effects
 *  around it. Returns null when the tab didn't actually change. */
function computeTabSwitch(
  current: View,
  next: View,
): { activeTab: View; prevTab: View | null; tabDirection: ViewTransitionDirection } | null {
  if (next === current) return null;
  if (motionOff()) return { activeTab: next, prevTab: null, tabDirection: 'forward' };
  return {
    activeTab: next,
    prevTab: current,
    tabDirection: VIEW_ORDER.indexOf(next) > VIEW_ORDER.indexOf(current) ? 'forward' : 'back',
  };
}

interface AtlasState {
  events: AnyEvent[];
  selectedEvent: AnyEvent | null;
  /** The calendar day (a `YYYY-MM-DD` key) opened in the day-detail view, if any. */
  selectedDay: string | null;
  /** The trip opened in the trip-detail view (a derived trip's id = its first
   *  entry's id), if any. Trips are computed on the fly, never persisted. */
  selectedTrip: string | null;
  /** The entry currently being edited in the main pane, if any. */
  editing: AnyEvent | null;
  /** What the main pane is composing, if anything (journal-first layout). */
  composing: EventType | null;
  /** Location of the entry currently being composed (GPS or hand-picked on the map). */
  draftLocation: Coordinates | null;
  /** When true, the next click on the map sets `draftLocation`. */
  pickingLocation: boolean;
  mapCenter: Coordinates;
  mapZoom: number;
  searchQuery: string;
  activeFilter: Filter;
  sidebarOpen: boolean;
  /** Which of the five list destinations is showing — read by both the desktop
   *  sidebar's own tab row and the phone bottom tab bar (P1). */
  activeTab: View;
  /** The tab mid-slide-out, so it can keep rendering (positioned absolutely,
   *  per M12) alongside the incoming one instead of the container collapsing
   *  the instant `activeTab` changes. */
  prevTab: View | null;
  tabDirection: ViewTransitionDirection;
  /** Current-weather WMO code (from the welcome lookup), shared so every panel
   *  can tint its background to the weather. null = unknown / lookups off. */
  weatherCode: number | null;
  /** Last known coordinates (from the welcome geolocation), shared so the
   *  app-wide background can compute the offline day/night cycle. null = unknown. */
  coords: { lat: number; lon: number } | null;
  /** Current wind speed (km/h) from the welcome weather lookup, shared so the
   *  backdrop can sway trees/grass and slant particles. null = unknown. */
  windKph: number | null;
  /** Current wind direction in degrees (0..360) from weather lookup. null = unknown. */
  windDir: number | null;
  /** Current time-of-day phase from the day/night cycle, published by the
   *  background so the welcome text can stay legible against a night sky. */
  dayPhase: SkyPhase;
  /** Notable places around the user (Wikipedia geosearch), published by the
   *  welcome POI card so the map can drop a pin for each. Live-only — never
   *  persisted or synced. null = not looked up yet. */
  nearbyPois: NearbyPlace[] | null;
  /** Whether the Year in Review page has taken over the main pane. Live-only —
   *  a retrospective is something you open, not a place you get left in. */
  yearReviewOpen: boolean;
  /** Whether the map (MainPane's own mini-card-or-full-screen toggle) is
   *  showing full-screen. Lives here rather than as MainPane-local state so
   *  `App.tsx` can factor it into whether a phone should show the main pane
   *  instead of the active tab's list (P1) — the mobile Map FAB otherwise
   *  becomes unreachable, since it lives inside MainPane. Live-only. */
  mapExpanded: boolean;
  /** Whether the command palette overlay is open. Live-only. */
  paletteOpen: boolean;
  /** Transient capture mode requested by the mobile Capture FAB ('photo' | 'audio' | null). */
  pendingCaptureMode: 'photo' | 'audio' | null;
  /** A photo already chosen by the Capture FAB's own file input, waiting for
   *  the editor to mount and attach it. Live-only; cleared with the mode. */
  pendingCapturePhoto: File | null;

  setEvents: (events: AnyEvent[]) => void;
  setPendingCaptureMode: (mode: 'photo' | 'audio' | null) => void;
  setPendingCapturePhoto: (file: File | null) => void;
  setYearReviewOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  selectEvent: (event: AnyEvent | null) => void;
  selectDay: (dayKey: string | null) => void;
  selectTrip: (id: string | null) => void;
  startComposing: (type: EventType) => void;
  stopComposing: () => void;
  startEditing: (event: AnyEvent) => void;
  stopEditing: () => void;
  setDraftLocation: (c: Coordinates | null) => void;
  setPickingLocation: (v: boolean) => void;
  setMapCenter: (center: Coordinates) => void;
  setMapZoom: (zoom: number) => void;
  setSearchQuery: (q: string) => void;
  setActiveFilter: (f: Filter) => void;
  toggleSidebar: () => void;
  /** Desktop's own in-column tab row: switches which list renders, with no
   *  side effects on the main pane's selection — desktop shows both at once. */
  setActiveTab: (next: View) => void;
  /** The phone bottom tab bar: switches the tab AND backs out of whatever
   *  detail/compose view — or the expanded map — is open, since a phone shows
   *  only one surface at a time. Tapping a tab always returns to that tab's
   *  list. */
  navigateTab: (next: View) => void;
  setMapExpanded: (v: boolean) => void;
  setWeatherCode: (code: number | null) => void;
  setCoords: (coords: { lat: number; lon: number } | null) => void;
  setWindKph: (kph: number | null) => void;
  setWindDir: (dir: number | null) => void;
  setDayPhase: (phase: SkyPhase) => void;
  setNearbyPois: (pois: NearbyPlace[] | null) => void;
  addOrUpdateEvent: (event: AnyEvent) => void;
  removeEvent: (id: string) => void;
}

export const useAtlasStore = create<AtlasState>((set, get) => ({
  events: [],
  selectedEvent: null,
  selectedDay: null,
  selectedTrip: null,
  editing: null,
  composing: null,
  draftLocation: null,
  pickingLocation: false,
  mapCenter: [0, 0],
  mapZoom: 2,
  searchQuery: '',
  activeFilter: 'all',
  weatherCode: null,
  coords: null,
  windKph: null,
  windDir: null,
  // Seed from the clock so the night treatment is right on first paint; the
  // background refines it from real coordinates once they're known.
  dayPhase: skyPhase(new Date(), null, null),
  nearbyPois: null,
  yearReviewOpen: false,
  mapExpanded: false,
  paletteOpen: false,
  pendingCaptureMode: null,
  pendingCapturePhoto: null,
  // Desktop opens with the list column showing; phones navigate entirely via
  // the bottom tab bar now (P1) — this flag is a desktop-only column-collapse
  // toggle ("Hide the list").
  sidebarOpen: isTwoPane(),
  // A phone starts on Home (the welcome dashboard) — "where I start". Desktop
  // starts on Timeline, because its welcome screen is MainPane's own and is
  // already on screen next to the list; a `home` tab there would show it twice.
  activeTab: isTwoPane() ? 'timeline' : 'home',
  prevTab: null,
  tabDirection: 'forward',

  setEvents: (events) => set({ events }),
  setPendingCaptureMode: (mode) => set({ pendingCaptureMode: mode }),
  setPendingCapturePhoto: (file) => set({ pendingCapturePhoto: file }),
  // NOT wrapped in a view transition: the palette is an overlay above the app, not
  // a pane replacement, so cross-fading the whole page behind it would be wrong.
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  // Opening the retrospective clears whatever else held the main pane, the same
  // way selecting an entry does.
  setYearReviewOpen: (open) =>
    withViewTransition(() =>
      set({
        yearReviewOpen: open,
        ...(open
          ? {
              selectedEvent: null,
              selectedDay: null,
              selectedTrip: null,
              composing: null,
              editing: null,
              pickingLocation: false,
            }
          : {}),
      }),
      open ? 'forward' : 'back',
    ),
  // Selecting an entry and composing are mutually exclusive in the main pane. On
  // a phone, whichever of these is set is what `App.tsx` uses (derived, not a
  // separate flag) to decide the main pane is showing instead of the active tab's
  // list — see `mobileDetailOpen` there.
  //
  // Every action below that REPLACES the main pane is wrapped in
  // `withViewTransition`, so the swap cross-fades instead of cutting (see
  // utils/viewTransition.ts). Wrapping here rather than at each call site means
  // every route into a pane — timeline, map, search, the ribbon, a keyboard
  // shortcut — animates identically. It is a no-op where the browser lacks the
  // API, the user prefers reduced motion, or the setting is off.
  // Direction: `selectEvent(null)` (the EventCard ✕ button) is the one call
  // site here that closes rather than opens, so it's the one that reads its
  // argument to decide — everything else in this block only ever opens.
  selectEvent: (event) => withViewTransition(() => set({ selectedEvent: event, selectedDay: null, selectedTrip: null, composing: null, editing: null, pickingLocation: false, yearReviewOpen: false }), event ? 'forward' : 'back'),
  // Open a whole day on its own page. Like selecting an entry, it takes over the
  // main pane (and, on a phone, the tab bar's list underneath it).
  selectDay: (dayKey) => withViewTransition(() => set({ selectedDay: dayKey, selectedEvent: null, selectedTrip: null, composing: null, editing: null, pickingLocation: false, yearReviewOpen: false }), dayKey ? 'forward' : 'back'),
  // Open a whole trip (a derived cluster of entries) on its own page.
  selectTrip: (id) => withViewTransition(() => set({ selectedTrip: id, selectedEvent: null, selectedDay: null, composing: null, editing: null, pickingLocation: false, yearReviewOpen: false }), id ? 'forward' : 'back'),
  startComposing: (type) => withViewTransition(() => set({ composing: type, selectedEvent: null, selectedDay: null, selectedTrip: null, editing: null, draftLocation: null, pickingLocation: false, yearReviewOpen: false }), 'forward'),
  stopComposing: () => withViewTransition(() => set({ composing: null, draftLocation: null, pickingLocation: false, pendingCaptureMode: null, pendingCapturePhoto: null }), 'back'),
  // Editing keeps the entry "selected" so closing the editor returns to its card.
  startEditing: (event) =>
    withViewTransition(() => set({ editing: event, selectedEvent: event, selectedDay: null, selectedTrip: null, composing: null, draftLocation: hasCoords(event) ? [event.longitude, event.latitude] : null, pickingLocation: false, yearReviewOpen: false }), 'forward'),
  stopEditing: () => withViewTransition(() => set({ editing: null, draftLocation: null, pickingLocation: false }), 'back'),
  setDraftLocation: (c) => set({ draftLocation: c }),
  setPickingLocation: (v) => set({ pickingLocation: v }),
  setMapCenter: (center) => set({ mapCenter: center }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setActiveFilter: (f) => set({ activeFilter: f }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveTab: (next) => {
    const patch = computeTabSwitch(get().activeTab, next);
    if (!patch) return;
    if (tabPaneTimer) clearTimeout(tabPaneTimer);
    if (patch.prevTab) {
      tabPaneTimer = setTimeout(() => useAtlasStore.setState({ prevTab: null }), TAB_PANE_TRANSITION_MS);
    }
    set(patch);
  },
  navigateTab: (next) => {
    const s = get();
    const patch = computeTabSwitch(s.activeTab, next);
    // Tapping the ALREADY-active tab while a detail/compose view is open (e.g.
    // reading an entry, then tapping Timeline again) doesn't change `activeTab`
    // (patch is null) but still needs to close that detail view — treat that
    // as a "back" navigation rather than defaulting to 'forward'.
    const closingDetail = !!(s.selectedEvent || s.selectedDay || s.selectedTrip || s.composing || s.editing || s.yearReviewOpen || s.mapExpanded);
    const direction = patch?.tabDirection ?? (closingDetail ? 'back' : 'forward');
    withViewTransition(() => {
      if (tabPaneTimer) clearTimeout(tabPaneTimer);
      if (patch?.prevTab) {
        tabPaneTimer = setTimeout(() => useAtlasStore.setState({ prevTab: null }), TAB_PANE_TRANSITION_MS);
      }
      set({
        ...(patch ?? {}),
        selectedEvent: null,
        selectedDay: null,
        selectedTrip: null,
        composing: null,
        editing: null,
        pickingLocation: false,
        yearReviewOpen: false,
        // The full-screen map is another MainPane-level surface a phone should
        // back out of on any tab tap, same as an open entry — otherwise
        // tapping a tab while the map is expanded would silently do nothing
        // (mobileDetailOpen, App.tsx, would stay true because of the map).
        mapExpanded: false,
        pendingCaptureMode: null,
        pendingCapturePhoto: null,
      });
    }, direction);
  },
  setMapExpanded: (v) => set({ mapExpanded: v }),
  setWeatherCode: (code) => set({ weatherCode: code }),
  setCoords: (coords) => set({ coords }),
  setWindKph: (kph) => set((s) => (s.windKph === kph ? s : { windKph: kph })),
  setWindDir: (dir) => set((s) => (s.windDir === dir ? s : { windDir: dir })),
  setDayPhase: (phase) => set((s) => (s.dayPhase === phase ? s : { dayPhase: phase })),
  setNearbyPois: (pois) => set({ nearbyPois: pois }),

  addOrUpdateEvent: (event) =>
    set((s) => {
      const idx = s.events.findIndex((e) => e.id === event.id);
      if (idx >= 0) {
        const copy = [...s.events];
        copy[idx] = event;
        return { events: copy };
      }
      return { events: [event, ...s.events] };
    }),

  removeEvent: (id) =>
    set((s) => ({
      events: s.events.filter((e) => e.id !== id),
      selectedEvent: s.selectedEvent?.id === id ? null : s.selectedEvent,
      editing: s.editing?.id === id ? null : s.editing,
    })),
}));
