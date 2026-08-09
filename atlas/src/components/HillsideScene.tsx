import { useMemo } from 'react';
import type { Scene } from '../features/welcome/scene';
import type { QualityProfile } from '../features/welcome/quality';

/**
 * The layered landscape behind the welcome screen — the "alive" backdrop.
 *
 * It is built from three parallax planes stacked back-to-front, so moving the
 * pointer (or tilting a phone) makes the distance read as real depth:
 *
 *   far  → distant mountain range (snow-frosted in winter) + a mid range with a
 *          forest tree-line along its shoulder + the back hill.
 *   near → the near hill, a flowing river, and the front hill.
 *   fore → the crafted trees, flowers, swaying grass and the odd butterfly that
 *          live right at your feet (these carry the wind).
 *
 * Everything is plain SVG + a little CSS — no canvas, no WebGL — so it stays
 * crisp at any size and light on a budget phone's GPU. Colour comes entirely
 * from CSS custom properties keyed to the season (see index.css `.season-*`), so
 * a season change cross-fades the whole palette for free. Motion is driven by
 * two CSS variables the parent sets from the real wind: `--sway-deg` (amplitude)
 * and `--sway-dur` (speed). Purely decorative: pointer-events off, aria-hidden,
 * and every animation freezes under prefers-reduced-motion (handled in the CSS).
 */

// A serrated conifer skyline generated once — a filled silhouette that reads as
// a distant forest sitting on the mid mountains' shoulder. Fixed (no per-render
// randomness) so it never jitters between renders.
const FOREST = (() => {
  const n = 48;
  const base = 300;
  let d = `M0,${base} `;
  for (let i = 0; i < n; i++) {
    const x = (i * 1000) / n;
    const w = 1000 / n;
    const h = 16 + ((i * 13) % 15); // 16–30px varied peaks
    d += `L${(x + w * 0.5).toFixed(1)},${(base - h).toFixed(1)} L${(x + w).toFixed(1)},${base} `;
  }
  d += `L1000,400 L0,400 Z`;
  return d;
})();

// Foreground trees dotted along the near slope. `x` is a left %, `y` a bottom
// offset in px, `h` the pixel height, `kind` the silhouette. Deciduous crowns
// recolour with the season; conifers stay evergreen (with a winter dusting).
const TREES: { x: string; y: number; h: number; kind: 'conifer' | 'broadleaf'; delay: number }[] = [
  { x: '7%', y: 42, h: 62, kind: 'conifer', delay: 0.2 },
  { x: '17%', y: 30, h: 78, kind: 'broadleaf', delay: 0.0 },
  { x: '30%', y: 48, h: 54, kind: 'conifer', delay: 0.5 },
  { x: '61%', y: 46, h: 58, kind: 'conifer', delay: 0.35 },
  { x: '73%', y: 30, h: 82, kind: 'broadleaf', delay: 0.15 },
  { x: '87%', y: 44, h: 60, kind: 'conifer', delay: 0.6 },
];

// Wildflowers along the very front — spring/summer only.
const FLOWERS = [
  { x: '11%', y: 20, hue: 'var(--hs-bloom-a)', delay: 0.0 },
  { x: '22%', y: 12, hue: 'var(--hs-bloom-b)', delay: 0.4 },
  { x: '41%', y: 22, hue: 'var(--hs-bloom-c)', delay: 0.2 },
  { x: '52%', y: 14, hue: 'var(--hs-bloom-a)', delay: 0.7 },
  { x: '79%', y: 20, hue: 'var(--hs-bloom-b)', delay: 0.3 },
  { x: '90%', y: 12, hue: 'var(--hs-bloom-c)', delay: 0.55 },
];

const GRASS = Array.from({ length: 30 }, (_, i) => ({
  left: `${((i + 0.5) * 100) / 30}%`,
  height: 11 + ((i * 7) % 12),
  delay: ((i * 0.23) % 3).toFixed(2),
}));

/** A single crafted tree — conifer (stacked tiers) or broadleaf (crown blobs). */
function Tree({
  kind,
  season,
  snowy,
  h,
}: {
  kind: 'conifer' | 'broadleaf';
  season: Scene['season'];
  snowy: boolean;
  h: number;
}) {
  const w = h * 0.62;
  if (kind === 'conifer') {
    return (
      <svg width={w} height={h} viewBox="0 0 62 100" className="hs-tree-svg">
        <rect x="27" y="78" width="8" height="22" rx="2" className="hs-trunk" />
        <polygon points="31,6 54,44 8,44" className="hs-conifer" />
        <polygon points="31,30 58,66 4,66" className="hs-conifer" />
        <polygon points="31,52 62,90 0,90" className="hs-conifer" />
        {snowy && (
          <g className="hs-snow-dust">
            <polygon points="31,6 40,21 22,21" />
            <polygon points="31,30 43,46 19,46" />
            <polygon points="31,52 45,72 17,72" />
          </g>
        )}
      </svg>
    );
  }
  // Broadleaf: bare branches in winter, otherwise a crown of overlapping blobs.
  const bare = season === 'winter';
  return (
    <svg width={w} height={h} viewBox="0 0 62 100" className="hs-tree-svg">
      <rect x="27" y="60" width="8" height="40" rx="3" className="hs-trunk" />
      {bare ? (
        <g className="hs-branches" fill="none" strokeLinecap="round">
          <path d="M31,64 L18,44 M31,58 L46,40 M31,52 L24,34 M31,48 L40,30" />
          {snowy && <circle cx="31" cy="40" r="15" className="hs-snow-dust-fill" />}
        </g>
      ) : (
        <g>
          <circle cx="20" cy="42" r="18" className="hs-leaf" />
          <circle cx="42" cy="40" r="19" className="hs-leaf-b" />
          <circle cx="31" cy="28" r="18" className="hs-leaf" />
          <circle cx="31" cy="46" r="17" className="hs-leaf-b" />
        </g>
      )}
    </svg>
  );
}

// A bee or two bobbing over the flowers on warm days (High+). `x` a left %, `y`
// a bottom offset in px.
const BEES = [
  { x: '24%', y: 34, delay: 0, dur: 14 },
  { x: '84%', y: 28, delay: 5.5, dur: 17 },
];

/** A tiny bee — striped body + two blurred wings (wings flap via CSS). */
function Bee() {
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" className="hs-bee-svg">
      <ellipse cx="7.5" cy="7" rx="3.4" ry="2.5" fill="#E7B23C" />
      <path d="M6.4 4.9v4.2M8 4.7v4.6" stroke="#3A2A16" strokeWidth="0.9" strokeLinecap="round" />
      <ellipse className="hs-bee-wing" cx="6" cy="4" rx="2.3" ry="1.4" fill="rgba(255,255,255,0.8)" />
      <ellipse className="hs-bee-wing" cx="9" cy="4" rx="2.3" ry="1.4" fill="rgba(255,255,255,0.8)" />
    </svg>
  );
}

/** A small five-petal wildflower on a stem. */
function Flower({ hue }: { hue: string }) {
  return (
    <svg width="18" height="30" viewBox="0 0 18 30" className="hs-flower-svg">
      <path d="M9,30 L9,14" className="hs-stem" fill="none" strokeWidth="1.6" strokeLinecap="round" />
      <g transform="translate(9 9)">
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="0" cy="-5" rx="2.4" ry="4.2" fill={hue} transform={`rotate(${a})`} />
        ))}
        <circle cx="0" cy="0" r="2.4" fill="var(--hs-bloom-core)" />
      </g>
    </svg>
  );
}

export default function HillsideScene({ scene, profile }: { scene: Scene; profile: QualityProfile }) {
  const { season, mode, storm, night } = scene;
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const frosted = mode === 'snow' || season === 'winter';
  const wet = mode === 'rain' || storm;
  const showFlowers = (season === 'spring' || season === 'summer') && mode !== 'rain' && mode !== 'snow';
  const warmDay = !night && (season === 'spring' || season === 'summer') && mode !== 'rain' && mode !== 'snow';
  const showButterfly = profile.butterfly && !reducedMotion && !night && (season === 'spring' || season === 'summer') && mode === 'sun';
  const showBees = profile.bees && !reducedMotion && warmDay;
  const gradeClass = storm ? 'hs-storm' : `hs-${mode}`;

  return (
    <div className={`hillside season-${season} ${gradeClass} ${night ? 'hs-night' : ''}`} aria-hidden="true">
      {/* FAR plane — distant ranges, forest tree-line, back hill. */}
      <div className="hs-plane hs-plane-far">
        <svg viewBox="0 0 1000 400" preserveAspectRatio="none">
          <defs>
            <linearGradient id="hs-frost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(248,251,255,0.95)" />
              <stop offset="100%" stopColor="rgba(248,251,255,0)" />
            </linearGradient>
            <clipPath id="hs-peaks">
              <path d="M0,250 L110,150 L200,210 L320,120 L430,195 L560,110 L680,185 L800,130 L910,200 L1000,155 L1000,400 L0,400 Z" />
              <path d="M0,290 L100,220 L190,270 L300,205 L400,262 L520,198 L630,258 L760,212 L860,262 L950,222 L1000,255 L1000,400 L0,400 Z" />
            </clipPath>
          </defs>
          {/* far range */}
          <path
            className="hs-mtn-far"
            d="M0,250 L110,150 L200,210 L320,120 L430,195 L560,110 L680,185 L800,130 L910,200 L1000,155 L1000,400 L0,400 Z"
          />
          {/* mid range */}
          <path
            className="hs-mtn-mid"
            d="M0,290 L100,220 L190,270 L300,205 L400,262 L520,198 L630,258 L760,212 L860,262 L950,222 L1000,255 L1000,400 L0,400 Z"
          />
          {/* snow frosting on the peaks, only in winter/snow */}
          {frosted && <rect x="0" y="90" width="1000" height="150" fill="url(#hs-frost)" clipPath="url(#hs-peaks)" />}
          {/* forest tree-line */}
          <path className="hs-forest" d={FOREST} />
          {/* back hill */}
          <path
            className="hs-hill-back"
            d="M0,320 C160,286 320,312 500,300 C700,286 860,314 1000,304 L1000,400 L0,400 Z"
          />
        </svg>
      </div>

      {/* NEAR plane — near hill, river, front hill. */}
      <div className="hs-plane hs-plane-near">
        <svg viewBox="0 0 1000 400" preserveAspectRatio="none">
          <defs>
            <linearGradient id="hs-river" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--hs-water)" />
              <stop offset="100%" stopColor="var(--hs-water-lo)" />
            </linearGradient>
          </defs>
          {/* near hill */}
          <path
            className="hs-hill-mid"
            d="M0,350 C180,322 360,344 540,334 C740,322 880,346 1000,340 L1000,400 L0,400 Z"
          />
          {/* a mountain lake nestled on the near hill's shoulder — the front hill
              laps over its lower rim so it reads as water sitting in the valley.
              Frozen-looking in winter via the icy palette (--hs-water). */}
          <g className={`hs-water-body ${frosted ? 'hs-river-ice' : ''}`}>
            <ellipse cx="512" cy="352" rx="168" ry="13" fill="url(#hs-river)" />
            <ellipse className="hs-glint" cx="470" cy="349" rx="82" ry="3" />
            <ellipse className="hs-glint" cx="562" cy="355" rx="44" ry="2" />
            {/* The sun/moon mirrored as a shimmering column on the water (High+).
                Skipped on a frozen lake, where the ice palette carries winter. */}
            {profile.reflections && !frosted && (
              <g className={`hs-reflect ${night ? 'hs-reflect-night' : 'hs-reflect-day'}`}>
                <ellipse cx="548" cy="347" rx="7" ry="2" />
                <ellipse cx="548" cy="351" rx="13" ry="2" />
                <ellipse cx="548" cy="355" rx="20" ry="1.6" />
              </g>
            )}
          </g>
          {/* front hill (drawn last so its crest laps over the lake's near shore) */}
          <path
            className="hs-hill-front"
            d="M0,376 C150,360 340,372 520,366 C720,360 860,378 1000,374 L1000,400 L0,400 Z"
          />
        </svg>
      </div>

      {/* FOREGROUND plane — trees, flowers, grass, butterfly (carry the wind). */}
      <div className="hs-plane hs-fore">
        {TREES.map((t, i) => (
          <span
            key={`t${i}`}
            className="hs-deco hs-tree"
            style={{ left: t.x, bottom: `${t.y}px`, animationDelay: `${t.delay}s` }}
          >
            <Tree kind={t.kind} season={season} snowy={frosted} h={t.h} />
          </span>
        ))}

        {showFlowers &&
          FLOWERS.map((f, i) => (
            <span
              key={`f${i}`}
              className="hs-deco hs-flower"
              style={{ left: f.x, bottom: `${f.y}px`, animationDelay: `${f.delay}s` }}
            >
              <span className="hs-fsway" style={{ animationDelay: `${f.delay}s` }}>
                <Flower hue={f.hue} />
              </span>
            </span>
          ))}

        {GRASS.map((g, i) => (
          <span
            key={`g${i}`}
            className="hs-grass"
            style={{ left: g.left, height: `${g.height}px`, animationDelay: `${g.delay}s` }}
          />
        ))}

        {showBees &&
          BEES.map((b, i) => (
            <span
              key={`bee${i}`}
              className="hs-bee"
              style={{ left: b.x, bottom: `${b.y}px`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }}
              aria-hidden="true"
            >
              <Bee />
            </span>
          ))}

        {showButterfly && (
          <span className="hs-butterfly" aria-hidden="true">
            <svg width="22" height="18" viewBox="0 0 22 18">
              <g className="hs-bfly-wings">
                <path d="M11,9 C4,-1 -2,3 3,9 C-2,15 4,19 11,9 Z" fill="var(--hs-bloom-a)" opacity="0.9" />
                <path d="M11,9 C18,-1 24,3 19,9 C24,15 18,19 11,9 Z" fill="var(--hs-bloom-c)" opacity="0.9" />
              </g>
              <rect x="10.4" y="3" width="1.2" height="12" rx="0.6" fill="var(--hs-trunk)" />
            </svg>
          </span>
        )}
      </div>

      {/* Rain sheen + lightning stay here (they belong to the terrain, not the
          celestial sky layer). Precipitation itself is drawn on the canvas. */}
      {storm && <div className="hs-lightning" />}
      {wet && <div className="hs-puddle" />}
    </div>
  );
}
