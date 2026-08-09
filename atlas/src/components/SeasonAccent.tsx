import { useMemo } from 'react';
import type { Scene } from '../features/welcome/scene';
import type { QualityProfile } from '../features/welcome/quality';
import { moonLitPath, sunArcOffset } from '../features/welcome/sky';

/** How far the sun/moon body (disc + beams — NOT the glow, see index.css) is
 *  allowed to drift from its base fixed spot (M43). Kept inside the plan's
 *  general "movement distances are small: 6–18px" guidance (§2.2) — the disc
 *  itself is only ~70px across, so even this reads as a real swing, not a
 *  dramatic orbit. */
const ARC_AMPLITUDE_X_PX = 14;
const ARC_AMPLITUDE_Y_PX = 18;

/**
 * The sky layer of the backdrop: the sun by day, a moon + stars by night, soft
 * drifting clouds when it's overcast, and northern lights on a clear high-
 * latitude night. Everything that *falls or floats through the air* (rain, snow,
 * leaves, petals, pollen, fireflies) now lives on the canvas (see ParticleField)
 * — this layer is only the celestial/atmospheric backdrop, which is why it's
 * cheap CSS/SVG that stays crisp and works under reduced motion.
 *
 * Purely cosmetic; pointer-events off, aria-hidden. Under reduced motion the
 * moving pieces hold still (handled in index.css) but the sun/moon still show.
 */

// Soft, blurred cloud blobs (not emoji) that drift across the upper sky.
const CLOUDS = [
  { top: '9%', delay: 0, dur: 66, scale: 1.0, op: 0.55 },
  { top: '20%', delay: 22, dur: 82, scale: 1.4, op: 0.4 },
  { top: '33%', delay: 44, dur: 74, scale: 1.15, op: 0.32 },
];

// A small flock gliding across the daytime sky, each on its own path/pace.
const BIRDS = [
  { top: '14%', size: 26, delay: 0, dur: 26 },
  { top: '19%', size: 20, delay: 3.5, dur: 30 },
  { top: '11%', size: 22, delay: 8, dur: 34 },
];

// A scatter of stars for clear nights, each twinkling on its own rhythm.
const STARS = [
  { left: '10%', top: '14%', size: 2.2, delay: 0.0, dur: 3.4 },
  { left: '20%', top: '26%', size: 1.6, delay: 1.2, dur: 4.1 },
  { left: '31%', top: '10%', size: 2.0, delay: 0.6, dur: 3.0 },
  { left: '44%', top: '22%', size: 1.4, delay: 2.0, dur: 4.6 },
  { left: '52%', top: '9%', size: 2.4, delay: 0.3, dur: 3.7 },
  { left: '63%', top: '20%', size: 1.7, delay: 1.6, dur: 4.0 },
  { left: '70%', top: '12%', size: 1.5, delay: 0.9, dur: 3.2 },
  { left: '12%', top: '36%', size: 1.5, delay: 2.4, dur: 4.4 },
  { left: '38%', top: '34%', size: 1.8, delay: 1.0, dur: 3.6 },
  { left: '58%', top: '32%', size: 1.3, delay: 0.4, dur: 4.2 },
  { left: '26%', top: '44%', size: 1.6, delay: 1.8, dur: 3.9 },
  { left: '48%', top: '46%', size: 1.4, delay: 0.7, dur: 4.3 },
];

export default function SeasonAccent({
  scene, profile, sunPos,
}: {
  scene: Scene;
  profile: QualityProfile;
  /** Sun altitude/azimuth for M43's arc, or `null` before a location fix
   *  exists (azimuth needs a real longitude) — the body then just holds its
   *  original fixed position, as it always has. */
  sunPos?: { altitude: number; azimuth: number } | null;
}) {
  const { mode, night, aurora, moon } = scene;
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // M43: under reduced motion the body holds its original still spot — same
  // convention as this file's other continuous motion (birds, shooting star).
  const arcStyle = useMemo(() => {
    if (!sunPos || reducedMotion) return undefined;
    const { xFrac, yFrac } = sunArcOffset(sunPos.altitude, sunPos.azimuth);
    return {
      '--sun-arc-x': `${(xFrac * ARC_AMPLITUDE_X_PX).toFixed(1)}px`,
      '--sun-arc-y': `${(-yFrac * ARC_AMPLITUDE_Y_PX).toFixed(1)}px`,
    } as React.CSSProperties;
  }, [sunPos, reducedMotion]);

  // Show a celestial body whenever the sky isn't precipitating — clear, partly
  // cloudy or unknown all keep the sun/moon visible (it peeks through clouds).
  const showBody = mode !== 'rain' && mode !== 'snow';
  const showSun = showBody && !night;
  const showMoon = showBody && night;
  // Real overcast weather always shows its clouds; a couple of faint clouds on an
  // otherwise clear day are decorative and only appear from the "rich" tier up.
  const showClouds = mode === 'clouds' || (mode === 'sun' && !night && profile.richClouds);
  const cloudSet = mode === 'clouds' ? CLOUDS : CLOUDS.slice(0, 2);
  // Birds glide across by day (not while it's precipitating); a shooting star
  // occasionally streaks a clear night; the aurora needs its tier too. Each is a
  // per-tier extra, and all are motion, so also skip under reduced motion.
  const showBirds = profile.birds && !night && showBody && !reducedMotion;
  const showShootingStar = profile.shootingStar && showMoon && !reducedMotion;
  const showAurora = profile.aurora && aurora;
  const showSunbeams = profile.sunbeams && !reducedMotion;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" style={arcStyle}>
      {showAurora && (
        <div className="aurora">
          <span className="aurora-band aurora-b1" />
          <span className="aurora-band aurora-b2" />
          <span className="aurora-band aurora-b3" />
        </div>
      )}

      {showShootingStar && <span className="shooting-star" />}

      {showBirds &&
        BIRDS.map((b, i) => (
          <span
            key={`bird${i}`}
            className="bird"
            style={{ top: b.top, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }}
          >
            <svg viewBox="0 0 24 12" width={b.size} height={b.size / 2} aria-hidden="true">
              <path className="bird-wing bird-wl" d="M12,7 Q6,0 0.5,5" fill="none" strokeWidth="1.4" strokeLinecap="round" />
              <path className="bird-wing bird-wr" d="M12,7 Q18,0 23.5,5" fill="none" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
        ))}

      {showMoon && (
        <>
          <div className="moon-glow" />
          <div className="moon-disc" title={moon.name}>
            <svg viewBox="0 0 100 100" className="moon-svg" aria-hidden="true">
              <defs>
                <radialGradient id="moon-lit" cx="42%" cy="38%" r="62%">
                  <stop offset="0%" stopColor="#FBFCFF" />
                  <stop offset="55%" stopColor="#E8EDF6" />
                  <stop offset="100%" stopColor="#C4D0E2" />
                </radialGradient>
              </defs>
              {/* Dark face (faint earthshine so it isn't a black hole). */}
              <circle cx="50" cy="50" r="49" className="moon-dark" />
              {/* Lit crescent/gibbous for the current phase. */}
              {moonLitPath(50, 50, 49, moon.fraction) && (
                <path d={moonLitPath(50, 50, 49, moon.fraction)} fill="url(#moon-lit)" />
              )}
            </svg>
          </div>
          {STARS.map((s, i) => (
            <span
              key={`star${i}`}
              className="star"
              style={{
                left: s.left,
                top: s.top,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: `${s.delay}s`,
                '--tw': `${s.dur}s`,
              } as React.CSSProperties}
            />
          ))}
        </>
      )}

      {showSun && (
        <>
          {showSunbeams && <div className="sunbeams" />}
          <div className="sun-glow" />
          <div className="sun-disc" />
        </>
      )}

      {showClouds &&
        cloudSet.map((c, i) => (
          <span
            key={i}
            className="cloud-soft"
            style={{
              top: c.top,
              opacity: c.op,
              transform: `scale(${c.scale})`,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`,
            }}
          />
        ))}
    </div>
  );
}
