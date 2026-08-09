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
  /** Northern lights: clear/overcast night at a high latitude. */
  aurora: boolean;
  /** Fog rolling across the scene (real fog codes, or a lighter snow haze). */
  fog: boolean;
  /** The Moon's current phase (offline computed) — drives the night sky's moon. */
  moon: MoonPhase;
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
  lat: number | null;
  phase: SkyPhase;
}

export function buildScene({ date, weatherCode, windKph, lat, phase }: SceneInput): Scene {
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

  return { season, mode, phase, night, storm, precip, ambient, wind, aurora, fog, moon };
}
