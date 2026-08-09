import { useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '../store/atlas';
import { useSettings } from '../store/settings';
import { skyPhase, solarPositionDeg } from '../features/welcome/sky';
import { buildScene } from '../features/welcome/scene';
import { modeForWeather } from '../features/welcome/ambiance';
import { profileFor, QUALITY_ORDER } from '../features/welcome/quality';
import HillsideScene from './HillsideScene';
import SeasonAccent from './SeasonAccent';
import ParticleField from './ParticleField';
import WebGLAtmosphere from './WebGLAtmosphere';

/**
 * The app-wide animated environment, rendered once behind every panel as a
 * single fixed, full-window layer so the landscape + sky + weather form ONE
 * continuous scene that spills across the sidebar and the main pane alike. The
 * panels sit transparently on top (see `--card-alpha`) and their entries/cards
 * stay legible, so the backdrop never interferes with anything you've written.
 *
 * It folds the current weather, the season, the offline day/night cycle and the
 * real wind into one `Scene` descriptor (see scene.ts), then hands that same
 * object to three cooperating layers:
 *
 *   HillsideScene  — the layered SVG landscape (mountains, forest, hills, river)
 *   SeasonAccent   — the sky (sun/moon/stars/clouds/aurora)
 *   ParticleField  — one canvas for everything that falls or drifts through air
 *
 * The scene stays alive on its own — drifting clouds, gliding birds, an
 * occasional shooting star, swaying trees, falling/floating particles — WITHOUT
 * ever following the pointer (that felt like too much). Two CSS variables carry
 * the live wind to the scene — `--sway-deg` (how far the trees/grass lean) and
 * `--sway-dur` (how fast) — so a breezy day genuinely looks breezier.
 *
 * Purely decorative: pointer-events off, aria-hidden, gated by the "Seasonal
 * animation" setting, and frozen under prefers-reduced-motion.
 */
export default function AmbientBackground() {
  const seasonalAnim = useSettings((s) => s.seasonalAnim);
  const diurnalCycle = useSettings((s) => s.diurnalCycle);
  const graphicsQuality = useSettings((s) => s.graphicsQuality);
  const weatherCode = useAtlasStore((s) => s.weatherCode);
  const windKph = useAtlasStore((s) => s.windKph);
  const coords = useAtlasStore((s) => s.coords);
  const setDayPhase = useAtlasStore((s) => s.setDayPhase);

  // Re-evaluate the sun's position every minute so the sky drifts day → dusk →
  // night on its own while the app sits open (no busy polling — once a minute).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // With the day/night cycle off, the scene stays in daytime. Publish the phase
  // so the welcome text can adapt to a dark sky.
  const phase = seasonalAnim && diurnalCycle
    ? skyPhase(now, coords?.lat ?? null, coords?.lon ?? null)
    : 'day';
  useEffect(() => { setDayPhase(phase); }, [phase, setDayPhase]);

  // M42 (MOTION_PLAN.md Wave 7): one soft wash across the whole scene the
  // moment the weather MODE changes (e.g. clear → rain) — on top of, not
  // instead of, the per-layer `filter`/`fill` cross-fades those layers already
  // carry. Read off the raw weather code rather than `scene.mode` because
  // `scene` itself isn't built until after this hook runs (its lower half
  // is skipped entirely when `seasonalAnim` is off) — hooks can't be
  // conditional, so the mode-change watch has to stand on its own inputs.
  const rawMode = modeForWeather(weatherCode);
  const prevModeRef = useRef(rawMode);
  const [weatherFlash, setWeatherFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (prevModeRef.current === rawMode) return;
    prevModeRef.current = rawMode;
    // Scenery richness gate, same convention as Map.tsx's POI-bob check (M35):
    // a wash is atmosphere, not core weather, so it only shows from Medium up.
    if (QUALITY_ORDER.indexOf(graphicsQuality) < QUALITY_ORDER.indexOf('medium')) return;
    // The whole point of this effect is reacting to an external change
    // (`rawMode`) by kicking off a one-shot flash — there's no way to derive
    // `weatherFlash` during render itself, so the synchronous setState here is
    // intentional (same pattern/rationale as Presence.tsx's exit-cancel).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWeatherFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setWeatherFlash(false), 900);
  }, [rawMode, graphicsQuality]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  if (!seasonalAnim) return null;

  // The chosen quality tier decides how much atmosphere/particle work the scene
  // does. It never changes *what* the weather/season is — only how richly it's
  // drawn — so every layer folds this in on top of the shared Scene descriptor.
  const profile = profileFor(graphicsQuality);

  const scene = buildScene({
    date: now,
    weatherCode,
    windKph,
    lat: coords?.lat ?? null,
    phase,
  });

  // Translate the live wind into sway amplitude/speed for the CSS animations.
  const swayDeg = (3 + scene.wind * 11).toFixed(1);
  const swayDur = Math.max(1.4, 4.4 - scene.wind * 2.9).toFixed(2);
  const showFog = profile.fog && (scene.fog || scene.mode === 'snow');

  // M43: the sun/moon's position along a small decorative arc — altitude
  // drives how high it sits, azimuth how far toward sunrise/sunset it's
  // leaning. Needs a real location fix (azimuth is meaningless without a
  // longitude); with none yet, the celestial body simply stays at its
  // original fixed spot, same as before this wave.
  const sunPos = diurnalCycle && coords ? solarPositionDeg(now, coords.lat, coords.lon) : null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
      style={{ '--sway-deg': `${swayDeg}deg`, '--sway-dur': `${swayDur}s` } as React.CSSProperties}
    >
      {/* Back-to-front: the terrain, then the time-of-day wash that darkens it,
          then fog haze, then the celestial bodies (which must sit IN FRONT of the
          night wash or they'd be washed out), and finally the falling/drifting
          particles on top of the whole scene. */}
      <HillsideScene scene={scene} profile={profile} />
      {phase !== 'day' && <div className={`sky-wash sky-${phase}`} />}
      {showFog && <div className={`fog-layer ${scene.mode === 'snow' ? 'fog-light' : ''}`} />}
      <SeasonAccent scene={scene} profile={profile} sunPos={sunPos} />
      {/* GPU atmosphere (volumetric haze + light shafts) — High/Ultra only, and
          only where WebGL2 exists; the component itself no-ops otherwise. It
          sits above the sky/celestial layer so its light washes over them, and
          below the falling particles. */}
      {profile.webgl && (
        <WebGLAtmosphere scene={scene} intensity={profile.tier === 'ultra' ? 1.1 : 0.85} />
      )}
      <ParticleField scene={scene} profile={profile} />
      {weatherFlash && <div className="weather-wash" />}
    </div>
  );
}
