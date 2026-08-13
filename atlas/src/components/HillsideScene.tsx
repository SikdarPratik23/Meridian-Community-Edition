import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlasStore } from '../store/atlas';
import { useSettings } from '../store/settings';
import type { Scene } from '../features/welcome/scene';
import { cairnBucketFor } from '../features/welcome/scene';
import type { QualityProfile } from '../features/welcome/quality';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * The layered landscape behind the welcome screen — the "alive" backdrop.
 *
 * It is built from three parallax planes stacked back-to-front, so moving the
 * pointer (or tilting a phone) makes the distance read as real depth:
 *
 *   far  → distant mountain range (snow-frosted in winter) + a mid range with a
 *          forest tree-line along its shoulder + the back hill + village.
 *   near → the near hill, hut, mountain trail, flowing lake, and front hill.
 *   fore → the crafted trees, flowers, signpost, seasonal critters, swaying grass and
 *          butterfly living right at your feet (these carry the wind).
 */

const MID_RANGE = 'M0,290 L100,220 L190,270 L300,205 L400,262 L520,198 L630,258 L760,212 L860,262 L950,222 L1000,255 L1000,400 L0,400 Z';

const FOREST = (() => {
  const n = 48;
  const base = 300;
  let d = `M0,${base} `;
  for (let i = 0; i < n; i++) {
    const x = (i * 1000) / n;
    const w = 1000 / n;
    const h = 16 + ((i * 13) % 15);
    d += `L${(x + w * 0.5).toFixed(1)},${(base - h).toFixed(1)} L${(x + w).toFixed(1)},${base} `;
  }
  d += `L1000,400 L0,400 Z`;
  return d;
})();

const TREES: { x: string; y: number; h: number; kind: 'conifer' | 'broadleaf'; delay: number }[] = [
  { x: '7%', y: 42, h: 62, kind: 'conifer', delay: 0.2 },
  { x: '17%', y: 30, h: 78, kind: 'broadleaf', delay: 0.0 },
  { x: '30%', y: 48, h: 54, kind: 'conifer', delay: 0.5 },
  { x: '61%', y: 46, h: 58, kind: 'conifer', delay: 0.35 },
  { x: '73%', y: 30, h: 82, kind: 'broadleaf', delay: 0.15 },
  { x: '87%', y: 44, h: 60, kind: 'conifer', delay: 0.6 },
];

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

const BEES = [
  { x: '24%', y: 34, delay: 0, dur: 14 },
  { x: '84%', y: 28, delay: 5.5, dur: 17 },
];

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

/** S1b: Signpost component — planted on front hill, zero sway. */
function Signpost() {
  return (
    <svg width="24" height="34" viewBox="0 0 24 34" className="hs-signpost-svg" aria-hidden="true">
      <rect x="10" y="8" width="4" height="26" rx="1" className="hs-trunk" />
      <path d="M2,4 L16,4 L18,7 L16,10 L2,10 Z" fill="var(--hs-trunk)" opacity="0.9" />
      <path d="M8,12 L22,12 L24,15 L22,18 L8,18 Z" fill="var(--hs-trunk)" opacity="0.8" />
    </svg>
  );
}

/** S3a: Distant village silhouette nestled in mid-hill fold. */
function Village({ night }: { night: boolean }) {
  return (
    <svg width="70" height="26" viewBox="0 0 70 26" className="hs-village-svg" aria-hidden="true">
      <path
        d="M2,26 L2,16 L7,11 L12,16 L12,26 Z
           M13,26 L13,14 L19,9 L25,14 L25,26 Z
           M26,26 L26,17 L30,13 L34,17 L34,26 Z
           M35,26 L35,12 L43,5 L51,12 L51,26 Z
           M52,26 L52,15 L58,10 L64,15 L64,26 Z
           M40,12 L40,4 L43,0 L46,4 L46,12 Z"
        className="hs-village-silhouette"
      />
      {night && (
        <g className="hs-village-lights">
          <rect x="5" y="17" width="2.5" height="3" rx="0.5" />
          <rect x="16" y="15" width="2.5" height="3" rx="0.5" />
          <rect x="29" y="18" width="2.5" height="3" rx="0.5" />
          <rect x="38" y="15" width="2.5" height="3" rx="0.5" />
          <rect x="55" y="17" width="2.5" height="3" rx="0.5" />
        </g>
      )}
    </svg>
  );
}

/** S3b: Mountain hut on near hill with wind-driven smoke and streak glow window. */
function Hut({ night, showSmoke, reducedMotion, streakGlow }: { night: boolean; showSmoke: boolean; reducedMotion: boolean; streakGlow: number }) {
  return (
    <span className="hs-hut-wrapper" style={{ '--streak-glow': streakGlow } as React.CSSProperties} aria-hidden="true">
      <svg width="28" height="22" viewBox="0 0 28 22" className="hs-hut-svg">
        <rect x="4" y="9" width="20" height="13" rx="1" className="hs-trunk" />
        <polygon points="2,9 14,2 26,9" className="hs-conifer" />
        <rect x="7" y="14" width="4" height="8" rx="0.5" fill="#3A2A16" />
        <rect x="19" y="4" width="3" height="6" fill="#3A2A16" />
        {night && streakGlow > 0 && <rect x="15" y="12" width="4" height="4" rx="0.5" fill="#FFC97A" className="hs-hut-window" />}
      </svg>
      {showSmoke && !reducedMotion && (
        <span className="hs-smoke-wrap">
          <span className="hs-smoke-p puff-1" />
          <span className="hs-smoke-p puff-2" />
          <span className="hs-smoke-p puff-3" />
        </span>
      )}
    </span>
  );
}

/** A1: Trail cairn that gains stones at entry milestones. */
function Cairn({ bucket, isNew, reducedMotion }: { bucket: number; isNew: boolean; reducedMotion: boolean }) {
  if (bucket <= 0) return null;
  const stones = [
    { width: 18, height: 4, rx: 1.5, y: 22, color: 'var(--hs-trunk)' },
    { width: 15, height: 4, rx: 1.5, y: 18, color: 'var(--hs-mid)' },
    { width: 13, height: 3.5, rx: 1.5, y: 14.5, color: 'var(--hs-trunk)' },
    { width: 11, height: 3.5, rx: 1.2, y: 11, color: 'var(--hs-forest)' },
    { width: 9, height: 3, rx: 1.2, y: 8, color: 'var(--hs-mid)' },
    { width: 7, height: 3, rx: 1, y: 5, color: 'var(--hs-trunk)' },
    { width: 5, height: 2.5, rx: 1, y: 2.5, color: 'var(--hs-leaf)' },
  ].slice(0, bucket);

  return (
    <span className="hs-deco hs-cairn" style={{ left: '30%', bottom: '72px' }} aria-hidden="true">
      <svg width="24" height="28" viewBox="0 0 24 28">
        {stones.map((s, idx) => {
          const isTop = idx === stones.length - 1;
          const animClass = isTop && isNew && !reducedMotion ? 'hs-cairn-settle' : '';
          return (
            <rect
              key={idx}
              x={12 - s.width / 2}
              y={s.y}
              width={s.width}
              height={s.height}
              rx={s.rx}
              fill={s.color}
              className={animClass}
            />
          );
        })}
      </svg>
    </span>
  );
}

/** A2: Memory lantern rising on an entry anniversary. */
function MemoryLantern() {
  return (
    <span className="hs-lantern-wrap" aria-hidden="true">
      <svg width="14" height="18" viewBox="0 0 14 18">
        <rect x="2" y="3" width="10" height="12" rx="2" fill="#FF9E43" opacity="0.85" />
        <rect x="4" y="5" width="6" height="8" rx="1" fill="#FFE29A" />
        <circle cx="7" cy="9" r="1.5" fill="#FFFBE6" />
        <line x1="7" y1="1" x2="7" y2="3" stroke="#B25900" strokeWidth="1" />
      </svg>
    </span>
  );
}

/** S4: Summer dragonfly hovering over the lake. */
function Dragonfly() {
  return (
    <span className="hs-dragonfly" aria-hidden="true">
      <svg width="20" height="16" viewBox="0 0 20 16">
        <line x1="10" y1="2" x2="10" y2="15" stroke="#3A5A60" strokeWidth="1.2" strokeLinecap="round" />
        <ellipse className="hs-dfly-wing" cx="6" cy="5" rx="5" ry="1.2" fill="rgba(200,240,255,0.85)" />
        <ellipse className="hs-dfly-wing" cx="14" cy="5" rx="5" ry="1.2" fill="rgba(200,240,255,0.85)" />
        <ellipse className="hs-dfly-wing" cx="6" cy="8" rx="4" ry="1" fill="rgba(200,240,255,0.75)" />
        <ellipse className="hs-dfly-wing" cx="14" cy="8" rx="4" ry="1" fill="rgba(200,240,255,0.75)" />
      </svg>
    </span>
  );
}

/** S4: Autumn stag silhouette on the ridge. */
function Stag({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <span className="hs-stag" aria-hidden="true">
      <svg width="24" height="28" viewBox="0 0 24 28" className="hs-stag-svg">
        {/* Body & legs */}
        <path d="M6,26 L6,18 L10,18 L10,26 M16,26 L16,18 L20,18 L20,26 M4,18 L20,18 L21,12 L9,12 Z" fill="var(--hs-trunk)" />
        {/* Neck, head & antlers */}
        <g className={reducedMotion ? '' : 'hs-stag-head'}>
          <path d="M9,14 L12,6 L16,8 L13,14 Z" fill="var(--hs-trunk)" />
          {/* Antlers */}
          <path d="M12,6 L10,0 M11,3 L8,2 M12,6 L16,1 M13,3 L17,4" stroke="var(--hs-trunk)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </span>
  );
}

/** S4: Spring nesting bird in broadleaf tree. */
function NestingBird({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <span className="hs-bird-nest" aria-hidden="true">
      <svg width="18" height="14" viewBox="0 0 18 14">
        {/* Nest */}
        <ellipse cx="9" cy="10" rx="7" ry="3" fill="#5E4028" />
        {/* Bird */}
        <g className={reducedMotion ? '' : 'hs-nest-bird'}>
          <ellipse cx="9" cy="7" rx="3.5" ry="2.5" fill="var(--hs-bloom-a)" />
          <circle cx="11" cy="5" r="1.8" fill="var(--hs-bloom-a)" />
        </g>
      </svg>
    </span>
  );
}

/** S4: Winter animal tracks in snow. */
function AnimalTracks() {
  return (
    <span className="hs-tracks" aria-hidden="true">
      <svg width="140" height="20" viewBox="0 0 140 20">
        <g fill="rgba(100, 120, 130, 0.45)">
          <ellipse cx="10" cy="16" rx="1.5" ry="1" />
          <ellipse cx="14" cy="14" rx="1.5" ry="1" />
          <ellipse cx="32" cy="14" rx="1.5" ry="1" />
          <ellipse cx="36" cy="12" rx="1.5" ry="1" />
          <ellipse cx="56" cy="12" rx="1.5" ry="1" />
          <ellipse cx="60" cy="10" rx="1.5" ry="1" />
          <ellipse cx="80" cy="10" rx="1.5" ry="1" />
          <ellipse cx="84" cy="8" rx="1.5" ry="1" />
          <ellipse cx="104" cy="8" rx="1.5" ry="1" />
          <ellipse cx="108" cy="6" rx="1.5" ry="1" />
        </g>
      </svg>
    </span>
  );
}

let firedLanternThisSession = false;

export default function HillsideScene({ scene, profile }: { scene: Scene; profile: QualityProfile }) {
  const { season, mode, storm, night, phase } = scene;
  const reducedMotion = useReducedMotion();

  const eventCount = useAtlasStore((s) => s.events.length);
  const lastSeenCairnBucket = useSettings((s) => s.lastSeenCairnBucket);
  const updateSettings = useSettings((s) => s.update);

  const cairnBucket = cairnBucketFor(eventCount);
  const isNewCairnStone = cairnBucket > lastSeenCairnBucket;

  useEffect(() => {
    if (cairnBucket > lastSeenCairnBucket) {
      const t = setTimeout(() => {
        updateSettings('lastSeenCairnBucket', cairnBucket);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [cairnBucket, lastSeenCairnBucket, updateSettings]);

  const { streakLevel, hasOnThisDay } = useMemo(() => {
    if (eventCount <= 0) return { streakLevel: 0, hasOnThisDay: false };
    const events = useAtlasStore.getState().events;
    if (!events || !events.length) return { streakLevel: 0, hasOnThisDay: false };

    const days = new Set<number>();
    const now = new Date();
    const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
    for (const e of events) {
      const d = new Date(e.timestamp);
      days.add(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000));
    }
    let currentStreak = 0;
    let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
    while (cursor !== null && days.has(cursor)) { currentStreak++; cursor--; }

    const streakLevel = currentStreak === 0 ? 0 : currentStreak <= 2 ? 0.4 : currentStreak <= 6 ? 0.8 : 1.0;

    const m = now.getMonth();
    const d = now.getDate();
    const nowYear = now.getFullYear();
    const hasOnThisDay = events.some((e) => {
      const t = new Date(e.timestamp);
      return t.getMonth() === m && t.getDate() === d && t.getFullYear() < nowYear;
    });

    return { streakLevel, hasOnThisDay };
  }, [eventCount]);

  const showLantern = profile.memoryLantern && hasOnThisDay && !storm && !firedLanternThisSession;
  useEffect(() => {
    if (showLantern) {
      firedLanternThisSession = true;
    }
  }, [showLantern]);

  const [rainbowActive, setRainbowActive] = useState(false);
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === 'rain' && mode !== 'rain' && mode !== 'snow' && !storm && !night && profile.tier !== 'low') {
      const t0 = setTimeout(() => setRainbowActive(true), 0);
      const t1 = setTimeout(() => setRainbowActive(false), 45000);
      prevModeRef.current = mode;
      return () => { clearTimeout(t0); clearTimeout(t1); };
    }
    prevModeRef.current = mode;
  }, [mode, storm, night, profile.tier]);

  const frosted = mode === 'snow' || season === 'winter';
  const wet = mode === 'rain' || storm;

  const [puddleDrying, setPuddleDrying] = useState(false);
  const prevWetRef = useRef(wet);
  useEffect(() => {
    if (prevWetRef.current && !wet) {
      const t0 = setTimeout(() => setPuddleDrying(true), 0);
      const t1 = setTimeout(() => setPuddleDrying(false), 180000);
      prevWetRef.current = wet;
      return () => { clearTimeout(t0); clearTimeout(t1); };
    }
    if (wet) {
      const t0 = setTimeout(() => setPuddleDrying(false), 0);
      prevWetRef.current = wet;
      return () => clearTimeout(t0);
    }
    prevWetRef.current = wet;
  }, [wet]);
  const showFlowers = (season === 'spring' || season === 'summer') && mode !== 'rain' && mode !== 'snow';
  const warmDay = !night && (season === 'spring' || season === 'summer') && mode !== 'rain' && mode !== 'snow';
  const showButterfly = profile.butterfly && !reducedMotion && !night && (season === 'spring' || season === 'summer') && mode === 'sun';
  const showBees = profile.bees && !reducedMotion && warmDay;
  const gradeClass = storm ? 'hs-storm' : `hs-${mode}`;

  const showSmoke = profile.tier !== 'low' && !wet;
  const showDragonfly = season === 'summer' && !night && mode === 'sun' && profile.seasonalCritters && !reducedMotion;
  const showTracks = frosted;
  const showStag = season === 'autumn' && phase === 'golden' && profile.seasonalCritters;
  const showBird = season === 'spring' && !night && (profile.tier === 'medium' || profile.tier === 'high' || profile.tier === 'ultra');

  return (
    <div className={`hillside season-${season} ${gradeClass} hs-${profile.tier} ${night ? 'hs-night' : ''} ${phase === 'golden' ? 'hs-golden' : ''}`} aria-hidden="true">
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
              <path d={MID_RANGE} />
            </clipPath>
          </defs>
          <path className="hs-mtn-far" d="M0,250 L110,150 L200,210 L320,120 L430,195 L560,110 L680,185 L800,130 L910,200 L1000,155 L1000,400 L0,400 Z" />
          <path className="hs-mtn-mid" d={MID_RANGE} />
          {frosted && <rect x="0" y="90" width="1000" height="150" fill="url(#hs-frost)" clipPath="url(#hs-peaks)" />}
          <path className="hs-forest" d={FOREST} />
          <path className="hs-hill-back" d="M0,320 C160,286 320,312 500,300 C700,286 860,314 1000,304 L1000,400 L0,400 Z" />
        </svg>
      </div>

      {/* S3a: S3a Village DOM layer over far plane */}
      <div className="hs-plane hs-plane-deco">
        <span className="hs-deco hs-village" style={{ left: '58%', bottom: '25%' }}>
          <Village night={night} />
        </span>
        {showStag && <Stag reducedMotion={reducedMotion} />}
        {showLantern && <MemoryLantern />}
        {rainbowActive && !reducedMotion && <div className="hs-rainbow" />}
      </div>

      {/* S2a: Aerial perspecive haze layer between far & near planes */}
      <div className="hs-haze" />

      {/* NEAR plane — near hill, river, front hill, trail. */}
      <div className="hs-plane hs-plane-near">
        {phase === 'golden' && <div className="hs-dawn-mist" />}
        <svg viewBox="0 0 1000 400" preserveAspectRatio="none">
          <defs>
            <linearGradient id="hs-river" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--hs-water)" />
              <stop offset="100%" stopColor="var(--hs-water-lo)" />
            </linearGradient>
            <clipPath id="hs-lake-clip">
              <ellipse cx="512" cy="352" rx="168" ry="13" />
            </clipPath>
          </defs>
          <path className="hs-hill-mid" d="M0,350 C180,322 360,344 540,334 C740,322 880,346 1000,340 L1000,400 L0,400 Z" />

          {/* S1a: The mountain trail climbing from left behind front crest */}
          <path className="hs-trail" fill="none" d="M-20,398 C120,388 200,372 300,362 C400,352 470,348 560,344" />

          {/* Mountain lake */}
          <g className={`hs-water-body ${frosted ? 'hs-river-ice' : ''}`}>
            <ellipse cx="512" cy="352" rx="168" ry="13" fill="url(#hs-river)" />

            {/* S2b: Mountain reflection in lake */}
            {profile.reflections && !frosted && (
              <g clipPath="url(#hs-lake-clip)" className="hs-mtn-reflect">
                <path d={MID_RANGE} transform="matrix(1 0 0 -0.12 0 386.4)" />
              </g>
            )}

            {/* E3: Extended shoreline tree/hut reflections */}
            {profile.reflections && !frosted && (
              <g className={`hs-reflect-deco ${night ? 'opacity-40' : 'opacity-25'}`}>
                <ellipse cx="440" cy="351" rx="9" ry="1.4" fill="var(--hs-trunk)" />
                <ellipse cx="460" cy="353" rx="14" ry="1.6" fill="var(--hs-conifer)" />
                <ellipse cx="485" cy="354" rx="11" ry="1.5" fill="var(--hs-leaf)" />
              </g>
            )}

            {/* S2c: Lake ripple rings */}
            {profile.reflections && !frosted && (
              <g className="hs-ripple" transform="translate(540, 353)">
                <ellipse cx="0" cy="0" rx="18" ry="2.5" />
                <ellipse cx="0" cy="0" rx="18" ry="2.5" />
              </g>
            )}

            <ellipse className="hs-glint" cx="470" cy="349" rx="82" ry="3" />
            <ellipse className="hs-glint" cx="562" cy="355" rx="44" ry="2" />
            {profile.reflections && !frosted && (
              <g className={`hs-reflect ${night ? 'hs-reflect-night' : 'hs-reflect-day'}`}>
                <ellipse cx="548" cy="347" rx="7" ry="2" />
                <ellipse cx="548" cy="351" rx="13" ry="2" />
                <ellipse cx="548" cy="355" rx="20" ry="1.6" />
              </g>
            )}
          </g>

          <path className="hs-hill-front" d="M0,376 C150,360 340,372 520,366 C720,360 860,378 1000,374 L1000,400 L0,400 Z" />
        </svg>
      </div>

      {/* FOREGROUND plane — trees, flowers, grass, signpost, hut, cairn, critters, butterfly. */}
      <div className="hs-plane hs-fore">
        {/* S3b: Mountain Hut */}
        <span className="hs-deco hs-hut" style={{ left: '22%', bottom: '15%' }}>
          <Hut night={night} showSmoke={showSmoke} reducedMotion={reducedMotion} streakGlow={streakLevel} />
        </span>

        {/* A1: Trail Cairn */}
        <Cairn bucket={cairnBucket} isNew={isNewCairnStone} reducedMotion={reducedMotion} />

        {/* S1b: Signpost */}
        <span className="hs-deco hs-signpost" style={{ left: '38%', bottom: '34px' }}>
          <Signpost />
        </span>

        {/* S4: Spring Bird in broadleaf tree */}
        {showBird && <NestingBird reducedMotion={reducedMotion} />}

        {TREES.map((t, i) => {
          const gustDelay = ((parseFloat(t.x) / 100) * 6).toFixed(2);
          return (
            <span
              key={`t${i}`}
              className="hs-deco hs-tree"
              style={{ left: t.x, bottom: `${t.y}px`, animationDelay: `${t.delay}s, ${gustDelay}s` }}
            >
              <Tree kind={t.kind} season={season} snowy={frosted} h={t.h} />
            </span>
          );
        })}

        {showFlowers &&
          FLOWERS.map((f, i) => {
            const gustDelay = ((parseFloat(f.x) / 100) * 6).toFixed(2);
            return (
              <span
                key={`f${i}`}
                className="hs-deco hs-flower"
                style={{ left: f.x, bottom: `${f.y}px`, animationDelay: `${f.delay}s, ${gustDelay}s` }}
              >
                <span className="hs-fsway" style={{ animationDelay: `${f.delay}s, ${gustDelay}s` }}>
                  <Flower hue={f.hue} />
                </span>
              </span>
            );
          })}

        {GRASS.map((g, i) => {
          const gustDelay = ((parseFloat(g.left) / 100) * 6).toFixed(2);
          return (
            <span
              key={`g${i}`}
              className="hs-grass"
              style={{ left: g.left, height: `${g.height}px`, animationDelay: `${g.delay}s, ${gustDelay}s` }}
            />
          );
        })}

        {/* S4: Winter animal tracks */}
        {showTracks && <AnimalTracks />}

        {/* S4: Summer dragonfly */}
        {showDragonfly && <Dragonfly />}

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

      {storm && <div className="hs-lightning" />}
      {(wet || puddleDrying) && <div className={`hs-puddle ${puddleDrying ? 'hs-puddle-drying' : ''}`} />}
    </div>
  );
}
