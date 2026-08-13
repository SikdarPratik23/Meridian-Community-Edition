import { useMemo } from 'react';
import type { Scene } from '../features/welcome/scene';
import type { QualityProfile } from '../features/welcome/quality';
import { moonLitPath, sunArcOffset } from '../features/welcome/sky';
import { useReducedMotion } from '../hooks/useReducedMotion';

/** How far the sun/moon body (disc + beams — NOT the glow, see index.css) is
 *  allowed to drift from its base fixed spot (M43). Kept inside the plan's
 *  general "movement distances are small: 6–18px" guidance (§2.2) — the disc
 *  itself is only ~70px across, so even this reads as a real swing, not a
 *  dramatic orbit. */
const ARC_AMPLITUDE_X_PX = 14;
const ARC_AMPLITUDE_Y_PX = 18;

/** Aspect-correct DOM hot-air balloon SVG component. */
function Balloon() {
  return (
    <span className="hs-balloon-wrap" aria-hidden="true">
      <svg width="34" height="46" viewBox="0 0 34 46" className="hs-balloon-svg">
        {/* Envelope: two alternating gores.
            These were `var(--hs-bloom-a)` / `var(--hs-bloom-c)` and rendered the
            whole balloon SOLID BLACK — confirmed live 2026-08-12, computed
            `fill: rgb(0, 0, 0)`. The `--hs-*` palette is declared on `.hillside`,
            and this component is HillsideScene's SIBLING under
            AmbientBackground's wrapper, so those custom properties never reach
            here: the substitution fails, `fill` is invalid at computed-value
            time, and it falls back to the initial value (black).
              Fixed with explicit colours rather than by hoisting the palette,
            because balloon fabric isn't seasonal — same reasoning as `Bee()` in
            HillsideScene.tsx, which hard-codes its amber and stripes for exactly
            this kind of season-invariant object. Don't reintroduce an `--hs-*`
            reference in this file without first moving the tokens up to the
            shared wrapper. */}
        <path d="M17,2 C7,2 2,10 2,19 C2,26 12,32 12,35 L22,35 C22,32 32,26 32,19 C32,10 27,2 17,2 Z" fill="#C96F4A" />
        <path d="M17,2 C12,2 8,10 8,19 C8,26 13,32 14,35 L20,35 C21,32 26,26 26,19 C26,10 22,2 17,2 Z" fill="#F0D9A8" />
        {/* Suspension lines */}
        <line x1="13" y1="35" x2="14" y2="40" stroke="#3A2A16" strokeWidth="0.8" />
        <line x1="17" y1="35" x2="17" y2="40" stroke="#3A2A16" strokeWidth="0.8" />
        <line x1="21" y1="35" x2="20" y2="40" stroke="#3A2A16" strokeWidth="0.8" />
        {/* Basket */}
        <rect x="13" y="40" width="8" height="5" rx="1" fill="#7A5540" />
      </svg>
    </span>
  );
}

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
  const { mode, night, aurora, moon, storm, hemisphere } = scene;
  const reducedMotion = useReducedMotion();
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
  const showBalloon = profile.balloon && !night && mode !== 'rain' && mode !== 'snow' && !storm && !reducedMotion;
  const showConstellations = (profile.tier === 'high' || profile.tier === 'ultra') && showMoon && !reducedMotion;
  // D1 fix: this used to draw BOTH Ursa Major and Crux on every clear night
  // regardless of location — a Bortle-scale nod to real astronomy that then
  // ignored the one thing real astronomy cares about (Crux never clears the
  // horizon above ~+25° latitude; Ursa Major never clears it below about -30°).
  // `scene.hemisphere` is 'N' unless a location fix puts the latitude negative.
  const showUrsaMajor = showConstellations && hemisphere === 'N';
  const showCrux = showConstellations && hemisphere === 'S';

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" style={arcStyle}>
      {showConstellations && (
        <svg className="hs-constellations" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMin slice">
          {/* Ursa Major's dipper asterism — never below roughly -30° latitude, so it
              has no business appearing south of the equator. */}
          {showUrsaMajor && (
            <g className="hs-constellation">
              <polyline points="150,40 190,48 230,65 270,85 275,120 325,125 320,88 270,85" fill="none" stroke="rgba(235,245,255,0.22)" strokeWidth="0.8" strokeDasharray="3 2" />
              <circle cx="150" cy="40" r="1.5" fill="#FFF" />
              <circle cx="190" cy="48" r="1.5" fill="#FFF" />
              <circle cx="230" cy="65" r="1.5" fill="#FFF" />
              <circle cx="270" cy="85" r="1.8" fill="#FFF" />
              <circle cx="275" cy="120" r="1.5" fill="#FFF" />
              <circle cx="325" cy="125" r="1.5" fill="#FFF" />
              <circle cx="320" cy="88" r="1.5" fill="#FFF" />
            </g>
          )}
          {/* Crux (the Southern Cross) — the reverse constraint: never clears the
              horizon above roughly +25° latitude. Note this asterism is a rough
              placeholder shape (5 points in a loose zigzag) rather than Crux's
              actual compact cross — the fix here is the hemisphere GATE (it was
              rendering on every clear night regardless of latitude, which is the
              real defect); redrawing it into a convincing cross is a separate,
              purely cosmetic follow-up. */}
          {showCrux && (
            <g className="hs-constellation">
              <polyline points="720,35 745,55 765,42 795,65 825,50" fill="none" stroke="rgba(235,245,255,0.22)" strokeWidth="0.8" strokeDasharray="3 2" />
              <circle cx="720" cy="35" r="1.5" fill="#FFF" />
              <circle cx="745" cy="55" r="1.6" fill="#FFF" />
              <circle cx="765" cy="42" r="1.5" fill="#FFF" />
              <circle cx="795" cy="65" r="1.8" fill="#FFF" />
              <circle cx="825" cy="50" r="1.5" fill="#FFF" />
            </g>
          )}
        </svg>
      )}

      {showAurora && (
        <div className="aurora">
          <span className="aurora-band aurora-b1" />
          <span className="aurora-band aurora-b2" />
          <span className="aurora-band aurora-b3" />
        </div>
      )}

      {showShootingStar && <span className="shooting-star" />}

      {showBalloon && (
        <div className="hs-balloon-container">
          <Balloon />
        </div>
      )}

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
