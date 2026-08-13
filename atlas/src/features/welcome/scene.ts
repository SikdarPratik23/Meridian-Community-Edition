/**
 * The unified "scene descriptor" — the single source of truth for the animated
 * home-screen environment. It folds together everything the backdrop needs to
 * know (season, current weather, time-of-day, wind, hemisphere) into one small,
 * pure object that every layer consumes:
 *
 *   - the layered SVG landscape (HillsideScene) reads `season`/`mode`/`wind` to
 *     colour the hills and sway the trees,
 *   - the canvas particle field (ParticleField) reads `precip`/`ambient`/`wind`
 *     to decide what falls or drifts,
 *   - the sky layer (SeasonAccent) reads `phase`/`mode`/`aurora`.
 *
 * Keeping this derivation in one pure function (a) removes the duplicated
 * "is it raining? is it night?" logic that was scattered across the three
 * components, and (b) makes the whole environment trivially testable.
 */
import { modeForWeather, type AmbientMode } from './ambiance';
import { seasonFor, type Season } from './season';
import { moonPhase, type SkyPhase, type MoonPhase } from './sky';

/** What, if anything, is falling from the sky right now. */
export type Precip = 'none' | 'rain' | 'snow';

/**
 * Ambient (non-precipitation) particles that give a season its life. Only one is
 * active at a time; `none` keeps the air still (e.g. an overcast autumn day where
 * the falling leaves carry the mood instead).
 */
export type Ambient = 'none' | 'leaves' | 'petals' | 'pollen' | 'fireflies';

export interface Scene {
  season: Season;
  /** Weather bucket driving particles + colour grade. */
  mode: AmbientMode;
  /** Offline day/night phase. */
  phase: SkyPhase;
  night: boolean;
  /** Thunderstorm (WMO 95/96/99) — lightning + hardest wind. */
  storm: boolean;
  /** What falls from the sky (owned by the canvas). */
  precip: Precip;
  /** What drifts through the air (owned by the canvas). */
  ambient: Ambient;
  /** Wind strength 0–1 — sways trees/grass and slants rain/particles. */
  wind: number;
  /** Wind direction in degrees (0..360; 0=N, 90=E), null if unknown. */
  windDir: number | null;
  /** Northern lights: clear/overcast night at a high latitude. */
  aurora: boolean;
  /** Fog rolling across the scene (real fog codes, or a lighter snow haze). */
  fog: boolean;
  /** The Moon's current phase (offline computed) — drives the night sky's moon. */
  moon: MoonPhase;
  /** Which hemisphere's constellations to draw (BACKDROP_BRIEF Phase 4 D1) —
   *  'N' when `lat` is missing, since a majority-northern install base is the
   *  safer unknown-location default than a coin flip. */
  hemisphere: Hemisphere;
}

export type Hemisphere = 'N' | 'S';

/** BACKDROP_BRIEF Phase 4 D1: which set of constellations (Ursa Major vs Crux)
 *  belongs on a clear night at this latitude. Exported standalone so it can be
 *  unit-tested without constructing a whole Scene. */
export function hemisphereFor(lat: number | null | undefined): Hemisphere {
  return lat != null && lat < 0 ? 'S' : 'N';
}

/** BACKDROP_BRIEF Phase 4 B2: the real wind direction (degrees, meteorological —
 *  the direction the wind blows FROM) turned into the sign the scene's leftward/
 *  rightward sway and drift use. A wind blowing from the eastern half (0–180°)
 *  pushes things toward the west, i.e. leftward on screen — hence -1 there.
 *  `null` (no reading yet) defaults to the scene's original always-rightward
 *  behaviour. Shared by AmbientBackground's tree/grass/smoke sway AND
 *  ParticleField's rain/snow slant — was duplicated inline in both before this
 *  extraction, which is also why it had never been unit-tested. */
export function windSignFor(dir: number | null | undefined): 1 | -1 {
  return dir != null && dir > 0 && dir < 180 ? -1 : 1;
}

/** BACKDROP_BRIEF Phase 4 A1: how many stones the trail cairn has earned for a
 *  given entry count. Bucketed on log2 rather than linear so each new stone is a
 *  genuinely rare, celebratory event (1/3/7/15/31/63/127 entries) instead of a
 *  constant trickle, and capped at 7 because that's how many stone shapes the
 *  component draws. Exported standalone so the milestone thresholds are
 *  unit-tested without mounting HillsideScene or seeding a real journal. */
export function cairnBucketFor(eventCount: number): number {
  return Math.min(7, Math.floor(Math.log2(Math.max(0, eventCount) + 1)));
}

/** Turn a real wind speed (km/h) into the 0–1 strength the scene animates on. */
function windStrength(kph: number | null | undefined, storm: boolean): number {
  if (storm) return 1;
  if (kph == null || !Number.isFinite(kph) || kph < 0) return 0.18; // gentle default breeze
  // ~45 km/h reads as a full gale for the purposes of a decorative sway.
  return Math.max(0.12, Math.min(1, kph / 45));
}

export interface SceneInput {
  date: Date;
  weatherCode: number | null;
  windKph: number | null;
  windDir?: number | null;
  lat: number | null;
  phase: SkyPhase;
}

export function buildScene({ date, weatherCode, windKph, windDir, lat, phase }: SceneInput): Scene {
  const season = seasonFor(date, lat).key;
  const mode = modeForWeather(weatherCode);
  const night = phase === 'night';
  const storm = weatherCode === 95 || weatherCode === 96 || weatherCode === 99;
  const wind = windStrength(windKph, storm);

  const precip: Precip = mode === 'rain' ? 'rain' : mode === 'snow' ? 'snow' : 'none';

  // Ambient particles only appear when the sky isn't already busy with
  // precipitation — a clear/cloudy day or night is when a season shows its life.
  const clearish = precip === 'none';
  const highLat = lat != null && Math.abs(lat) >= 52;
  let ambient: Ambient = 'none';
  if (clearish) {
    if (night) {
      // Fireflies on warm nights; the far north instead gets its aurora (below).
      if ((season === 'summer' || season === 'spring') && !highLat) ambient = 'fireflies';
    } else if (season === 'autumn') {
      ambient = 'leaves';
    } else if (season === 'spring') {
      ambient = 'petals';
    } else if (season === 'summer') {
      ambient = 'pollen';
    }
    // Winter days stay clean (the snow mode carries winter; a clear winter day is
    // simply crisp and still).
  }

  const aurora = clearish && night && highLat;
  const fog = weatherCode === 45 || weatherCode === 48;
  const moon = moonPhase(date);
  const hemisphere = hemisphereFor(lat);

  return {
    season, mode, phase, night, storm, precip, ambient, wind,
    windDir: windDir ?? null, aurora, fog, moon, hemisphere,
  };
}
