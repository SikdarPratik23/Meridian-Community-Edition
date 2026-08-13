import { create } from 'zustand';
import {
  type WelcomeCardId, WELCOME_CARD_IDS, defaultHiddenCards,
} from '../features/welcome/cards';

export type CoordFormat = 'decimal' | 'dms';
export type TempUnit = 'C' | 'F';
export type EntryLayout = 'list' | 'tiles';
export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSize = 'small' | 'medium' | 'large' | 'x-large';

/**
 * Which basemap the maps draw (all keyless — see `features/map/mapStyle.ts`).
 *   - `hybrid` — satellite imagery with roads, borders and place names over it.
 *     The default, because it needs no local cartographic convention to read: it
 *     works the same in Bavaria and in Bengal.
 *   - `satellite` — the same imagery, unlabelled.
 *   - `parchment` — Meridian's own vector style, coloured from the app's
 *     Cartographer's Parchment palette. The only style that follows light/dark.
 *   - `osm` — plain OpenStreetMap raster tiles. The most forgiving option on a
 *     weak device or a poor connection, and the automatic fallback.
 */
export type MapStyleId = 'hybrid' | 'satellite' | 'parchment' | 'osm';

/** UI language. Journal *content* is always whatever the user types. */
export type Language = 'en' | 'bn';

/**
 * How much the INTERFACE itself moves — button presses, panel transitions,
 * entrance animations. A separate axis from `graphicsQuality`: that setting is
 * "how rich is the ambient backdrop scenery", this one is "how much does the UI
 * move". A user on a weak phone may well want Low graphics and Full interface
 * motion, or vice versa. The OS `prefers-reduced-motion` request always wins
 * over this setting — see `utils/motion.ts`'s `effectiveMotion`.
 */
export type MotionLevel = 'full' | 'reduced' | 'off';

/**
 * Visual richness of the animated backdrop. Ordered lightest → heaviest. Only
 * the *visuals* change between tiers — every feature of the app works the same
 * at every level. New installs deliberately start at `'low'` for maximum
 * compatibility and battery life; the user raises it by hand and it persists.
 * The concrete per-tier effect budget lives in `features/welcome/quality.ts`.
 */
export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Root font sizes for the whole app. Everything sized in `rem`/`em` (the bulk of
 * the UI, plus the journal reading text) scales from the `<html>` font-size, so
 * this one knob adjusts text size consistently across the app. `medium` (16px)
 * is the browser default. `label` drives the settings control.
 */
export const FONT_SIZES: Record<FontSize, { label: string; px: number }> = {
  small: { label: 'Small', px: 15 },
  medium: { label: 'Medium', px: 16 },
  large: { label: 'Large', px: 18 },
  'x-large': { label: 'X-Large', px: 20 },
};

/** User-facing settings. Persisted to localStorage; no server involved. */
export interface Settings {
  // About you
  name: string;
  title: string;        // e.g. "Geoinformatiker"
  homeRegion: string;   // free text, e.g. "Nuremberg, Germany"
  // Display
  coordFormat: CoordFormat;
  tempUnit: TempUnit;
  fontSize: FontSize;       // app-wide text size (scales the <html> root font-size)
  entryLayout: EntryLayout; // timeline: list rail or photo tiles
  mapZoom: number;          // default zoom when focusing a point (select / pin / locate)
  showPaths: boolean;       // draw a route line connecting located entries by date
  showHeatmap: boolean;     // overlay a density heatmap of all located entries ("where I've been")
  // Calendar
  holidayCountry: string;   // ISO country code to mark holidays for; '' = auto-detect
  holidayState: string;     // ISO subdivision (e.g. 'BY'); '' = whole country
  mapStyle: MapStyleId;     // which basemap the maps draw (see MapStyleId)
  // Language
  /** UI language. Journal content is unaffected — you can always write in any
   *  script; this only translates Meridian's own labels. */
  language: Language;
  // Input
  dictationLang: string;  // BCP-47 tag for the 🎤 dictation (''=follow the browser)
  // Privacy / network
  onlineLookups: boolean; // place-name + Wikipedia lookups (welcome screen, autofill)
  autoFillPlace: boolean; // reverse-geocode the place name when a pin is dropped
  /** Read a photo's own EXIF GPS on attach and drop the entry's pin there.
   *  Entirely local — the EXIF is parsed in the browser, nothing is uploaded.
   *  Only ever moves a pin the user hasn't placed by hand, and always says so
   *  with an undo. */
  photoGps: boolean;
  // Appearance
  theme: ThemeMode;       // light | dark | follow the OS ('system')
  weatherTint: boolean;   // tint the whole app background to the current weather
  // Welcome screen
  seasonalAnim: boolean;
  diurnalCycle: boolean;  // day/night cycle: sun by day, moon + stars + night wash after dark
  graphicsQuality: GraphicsQuality; // richness of the animated backdrop (see quality.ts)
  cardOpacity: number;    // 0–1 background opacity of the welcome "flash" cards
  showFocus: boolean;     // show the "Today's focus" card (prompt / nearby place) at the top of the welcome screen
  focusRotateSec: number; // seconds between auto-rotations of the Today's focus nearby place (5–120)
  showPrompt: boolean;
  /** Order the welcome cards appear in (top → bottom). Reorderable in Settings. */
  welcomeCardOrder: WelcomeCardId[];
  /** Welcome cards the user has hidden. */
  welcomeCardHidden: WelcomeCardId[];
  /** Search radius (km) for the "Places of interest nearby" card. 1–10 (Wikipedia
   *  geosearch caps at 10 km). */
  poiRadiusKm: number;
  /** Show places-of-interest pins on the map. Independent of the welcome POI
   *  card — hiding that card never removes the map pins; this is the separate
   *  switch for the map. */
  showPoiPins: boolean;
  /** Cross-fade/morph when switching between panes, via the View Transitions API.
   *  A no-op in browsers without support. */
  paneTransitions: boolean;
  /** How much the interface itself moves. See `MotionLevel`. */
  motion: MotionLevel;
  /** False until the first-run introduction has been completed or skipped. Not a
   *  preference as such — it's the "has this install been set up" flag, kept here
   *  so it persists with everything else. */
  onboarded: boolean;
  /** Whether the user has seen the hold-to-peek discovery hint toast. */
  peekHintSeen: boolean;
  /** Whether the user has seen the tap-the-sky compass-rose discovery hint toast. */
  compassHintSeen: boolean;
  /** Last celebrated cairn milestone bucket (0..7). */
  lastSeenCairnBucket: number;
}

const KEY = 'meridian_settings';
const LEGACY_NAME_KEY = 'meridian_name';
/** Marks the one-time basemap-default move as done — see `load()`. */
const BASEMAP_NUDGE_KEY = 'meridian_basemap_default_v2';

const defaults: Settings = {
  name: '',
  title: '',
  homeRegion: '',
  coordFormat: 'decimal',
  tempUnit: 'C',
  fontSize: 'medium',
  entryLayout: 'list',
  mapZoom: 17,
  showPaths: false,
  showHeatmap: false,
  mapStyle: 'hybrid',
  language: 'en',
  dictationLang: '',
  holidayCountry: '',
  holidayState: '',
  onlineLookups: true,
  autoFillPlace: true,
  photoGps: true,
  theme: 'system',
  weatherTint: true,
  seasonalAnim: true,
  diurnalCycle: true,
  graphicsQuality: 'low', // start light everywhere; the user opts into more
  cardOpacity: 0.9,
  showFocus: true,
  focusRotateSec: 30,
  showPrompt: true,
  welcomeCardOrder: [...WELCOME_CARD_IDS],
  welcomeCardHidden: defaultHiddenCards(),
  poiRadiusKm: 10,
  showPoiPins: true,
  paneTransitions: true,
  motion: 'full',
  onboarded: false,
  peekHintSeen: false,
  compassHintSeen: false,
  lastSeenCairnBucket: 0,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    // Migrate the standalone name the welcome screen used before settings existed.
    if (!parsed.name) {
      const legacy = localStorage.getItem(LEGACY_NAME_KEY);
      if (legacy) parsed.name = legacy;
    }
    // An install that already has saved settings predates the first-run intro, so
    // it has effectively been through setup — don't interrupt an existing user
    // with an introduction to an app they've been using for weeks. Only a truly
    // fresh install (no stored settings at all) starts un-onboarded.
    if (raw && parsed.onboarded === undefined) parsed.onboarded = true;
    // 2026-08-05: the default basemap moved from `parchment` to `hybrid`. Changing
    // the default alone would be invisible to anyone who already has settings
    // stored — every install carries an explicit `mapStyle` in its blob — so an
    // install still sitting on the OLD default is moved across once. The marker
    // makes it strictly once: switch back to parchment afterwards and it stays.
    if (!localStorage.getItem(BASEMAP_NUDGE_KEY)) {
      if (raw && parsed.mapStyle === 'parchment') parsed.mapStyle = defaults.mapStyle;
      localStorage.setItem(BASEMAP_NUDGE_KEY, '1');
    }
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

interface SettingsStore extends Settings {
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
  /** Explicitly write the current settings to localStorage (for a manual Save). */
  flush: () => void;
}

function persist(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable; non-fatal
  }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  update: (key, value) =>
    set(() => {
      const { update: _u, reset: _r, ...current } = get();
      const next = { ...current, [key]: value } as Settings;
      persist(next);
      return { [key]: value } as Partial<SettingsStore>;
    }),
  reset: () => {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(LEGACY_NAME_KEY);
    } catch {
      // non-fatal
    }
    set({ ...defaults });
  },
  flush: () => {
    const { update: _u, reset: _r, flush: _f, ...current } = get();
    persist(current as Settings);
  },
}));
