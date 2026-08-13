import { useEffect, useRef } from 'react';
import type { Scene } from '../features/welcome/scene';
import { windSignFor } from '../features/welcome/scene';
import type { QualityProfile } from '../features/welcome/quality';

/**
 * The single canvas that owns everything that *moves through the air* — rain,
 * snow, drifting autumn leaves, spring petals, summer pollen and night
 * fireflies. One <canvas>, one requestAnimationFrame loop, no libraries.
 *
 * Why one canvas instead of the old DOM/CSS particle spans: a few hundred
 * absolutely-positioned animated <span>s each force layout/paint work; one
 * canvas draws the same scene in a single composited surface, which is what
 * keeps it smooth on a budget phone (the Galaxy M12's Mali-G52). It also lets us
 * cap the particle count by screen size, slant particles by the *real* wind, and
 * stop the loop the instant the tab is hidden.
 *
 * Guardrails: skipped completely under prefers-reduced-motion, paused on
 * document.hidden, DPR clamped by the quality profile, and counts roughly halved
 * on phones. Purely decorative (pointer-events off, aria-hidden). At most one
 * particle "kind" is ever active at a time (precipitation and ambient life are
 * mutually exclusive in the scene model), so the loop stays cheap.
 *
 * The graphics-quality profile scales this: `particleScale` multiplies every
 * count and `maxDpr` caps canvas sharpness, while `ambientLife` gates the
 * decorative drifting life (leaves/petals/pollen/fireflies). Precipitation (rain
 * and snow) is core weather and shows at every tier.
 */

type Kind = 'rain' | 'snow' | 'leaves' | 'petals' | 'pollen' | 'fireflies' | 'none';

function kindFor(scene: Scene, ambientLife: boolean): Kind {
  if (scene.precip === 'rain') return 'rain';
  if (scene.precip === 'snow') return 'snow';
  // Decorative drifting life only shows when the tier allows it.
  return ambientLife ? scene.ambient : 'none';
}

const LEAF_COLORS = ['#C0703A', '#A8552E', '#B98A3C', '#93662F'];
const PETAL_COLORS = ['#F3C6D6', '#F6D9E5', '#EBB2C8', '#F7CBB4'];

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  phase: number; // for sway / twinkle
  hue: string;
  seed: number;
}

function countFor(kind: Kind, mobile: boolean, storm: boolean, scale: number): number {
  const base: Record<Kind, [number, number]> = {
    rain: [130, 55],
    snow: [95, 45],
    leaves: [20, 10],
    petals: [24, 12],
    pollen: [26, 14],
    fireflies: [22, 12],
    none: [0, 0],
  };
  const [d, m] = base[kind];
  const n = mobile ? m : d;
  const stormed = kind === 'rain' && storm ? n * 1.4 : n;
  // The quality tier scales density; keep at least a few so an active weather
  // never renders an empty canvas at the lowest tier.
  return stormed === 0 ? 0 : Math.max(4, Math.round(stormed * scale));
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function ParticleField({ scene, profile }: { scene: Scene; profile: QualityProfile }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(scene);
  // Keep the loop's view of the scene fresh without restarting it: the rAF loop
  // reads sceneRef.current every frame (for live wind), and this syncs it after
  // each render. Declared before the setup effect so it runs first on mount.
  useEffect(() => { sceneRef.current = scene; });

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const kind = kindFor(scene, profile.ambientLife);
  // Re-seed the field only when the *kind*, the phone/desktop bucket, or the
  // quality tier changes — not on every wind tick (the loop reads wind live from
  // sceneRef). The tier is in the signature so switching quality re-spawns the
  // field at the new density / DPR.
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const signature = `${kind}|${mobile ? 'm' : 'd'}|${profile.tier}`;

  useEffect(() => {
    if (reducedMotion || kind === 'none') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let dpr = 1;
    const parent = canvas.parentElement!;

    const resize = () => {
      dpr = Math.min(profile.maxDpr, window.devicePixelRatio || 1);
      W = parent.clientWidth;
      H = parent.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const isMobile = W < 640;
    const N = countFor(kind, isMobile, sceneRef.current.storm, profile.particleScale);

    const spawn = (fresh: boolean): P => {
      const y = fresh ? rand(-H * 0.2, H) : rand(-H * 0.3, -4);
      switch (kind) {
        case 'rain':
          return { x: rand(0, W), y: fresh ? rand(0, H) : rand(-H, 0), vx: 0, vy: rand(9, 14), size: rand(9, 16), rot: 0, vrot: 0, phase: 0, hue: '', seed: rand(0, 1) };
        case 'snow':
          return { x: rand(0, W), y, vx: 0, vy: rand(0.5, 1.4), size: rand(1.6, 3.6), rot: 0, vrot: 0, phase: rand(0, Math.PI * 2), hue: '', seed: rand(0.4, 1) };
        case 'leaves':
          return { x: rand(0, W), y, vx: rand(-0.3, 0.3), vy: rand(0.7, 1.6), size: rand(6, 11), rot: rand(0, Math.PI * 2), vrot: rand(-0.03, 0.03), phase: rand(0, Math.PI * 2), hue: LEAF_COLORS[Math.floor(rand(0, LEAF_COLORS.length))], seed: rand(0.5, 1) };
        case 'petals':
          return { x: rand(0, W), y, vx: rand(-0.2, 0.4), vy: rand(0.5, 1.1), size: rand(4, 7), rot: rand(0, Math.PI * 2), vrot: rand(-0.04, 0.04), phase: rand(0, Math.PI * 2), hue: PETAL_COLORS[Math.floor(rand(0, PETAL_COLORS.length))], seed: rand(0.5, 1) };
        case 'pollen':
          return { x: rand(0, W), y: fresh ? rand(0, H) : rand(H, H + 20), vx: rand(-0.15, 0.15), vy: rand(-0.5, -0.15), size: rand(1.4, 3), rot: 0, vrot: 0, phase: rand(0, Math.PI * 2), hue: '', seed: rand(0.5, 1) };
        case 'fireflies':
          return { x: rand(0, W), y: rand(H * 0.25, H), vx: rand(-0.3, 0.3), vy: rand(-0.25, 0.25), size: rand(1.6, 3), rot: 0, vrot: 0, phase: rand(0, Math.PI * 2), hue: '', seed: rand(0.5, 1) };
        default:
          return { x: 0, y: 0, vx: 0, vy: 0, size: 1, rot: 0, vrot: 0, phase: 0, hue: '', seed: 1 };
      }
    };

    const startTime = performance.now();
    let particles: P[] = Array.from({ length: N }, () => spawn(true));

    let raf = 0;
    const draw = () => {
      const s = sceneRef.current;
      const wind = s.wind; // 0..1
      const windSign = windSignFor(s.windDir);
      ctx.clearRect(0, 0, W, H);

      // A4: Weather ramp-in — ramp the DRAW over 4s rather than snapping all N particles on re-seed.
      // Asymmetric by design: ramp-in delivers weather arrival, kind changes snap instantly.
      const elapsed = performance.now() - startTime;
      const activeCount = Math.min(N, Math.ceil((N * elapsed) / 4000));
      const activeParticles = particles.slice(0, activeCount);

      switch (kind) {
        case 'rain': {
          const slant = (1.2 + wind * 7) * windSign;
          ctx.strokeStyle = 'rgba(164,186,214,0.5)';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          for (const p of activeParticles) {
            p.x += slant;
            p.y += p.vy + wind * 3;
            if (p.y > H) { p.y = rand(-40, 0); p.x = rand(-40, W); }
            if (p.x > W + 40) p.x -= W + 40;
            if (p.x < -40) p.x += W + 40;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - slant * 0.9, p.y - p.size);
          }
          ctx.stroke();
          break;
        }
        case 'snow': {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          for (const p of activeParticles) {
            p.phase += 0.02;
            p.x += (Math.sin(p.phase) * 0.5 + wind * 2.2) * windSign;
            p.y += p.vy;
            if (p.y > H) { p.y = rand(-20, -4); p.x = rand(0, W); }
            if (p.x > W + 8) p.x = -8;
            if (p.x < -8) p.x = W + 8;
            ctx.globalAlpha = p.seed;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'leaves':
        case 'petals': {
          for (const p of activeParticles) {
            p.phase += 0.02;
            p.rot += p.vrot;
            p.x += (p.vx + Math.sin(p.phase) * 0.6 + wind * 2.4) * windSign;
            p.y += p.vy;
            if (p.y > H + 12) { p.y = rand(-30, -8); p.x = rand(0, W); }
            if (p.x > W + 12) p.x = -12;
            if (p.x < -12) p.x = W + 12;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.hue;
            ctx.globalAlpha = p.seed;
            ctx.beginPath();
            // a simple leaf/petal: two arcs meeting at tips
            ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'pollen': {
          for (const p of activeParticles) {
            p.phase += 0.015;
            p.x += (Math.sin(p.phase) * 0.4 + wind * 1.2) * windSign;
            p.y += p.vy;
            if (p.y < -6) { p.y = H + rand(0, 20); p.x = rand(0, W); }
            const a = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(p.phase * 1.6));
            ctx.globalAlpha = a * p.seed;
            ctx.fillStyle = '#FFCE7A';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'fireflies': {
          for (const p of activeParticles) {
            p.phase += 0.03 + p.seed * 0.02;
            // gentle wandering
            p.vx += rand(-0.02, 0.02);
            p.vy += rand(-0.02, 0.02);
            p.vx = Math.max(-0.6, Math.min(0.6, p.vx));
            p.vy = Math.max(-0.5, Math.min(0.5, p.vy));
            p.x += p.vx + wind * 0.6;
            p.y += p.vy;
            if (p.x > W) p.x = 0; if (p.x < 0) p.x = W;
            if (p.y > H) p.y = H * 0.3; if (p.y < H * 0.2) p.y = H;
            const glow = 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin(p.phase), 2);
            const r = p.size;
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
            grad.addColorStop(0, `rgba(214,255,150,${0.9 * glow})`);
            grad.addColorStop(0.4, `rgba(180,240,120,${0.4 * glow})`);
            grad.addColorStop(1, 'rgba(180,240,120,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
      }

      raf = requestAnimationFrame(draw);
    };

    const start = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    const onVisibility = () => (document.hidden ? stop() : start());
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        // reposition any out-of-bounds particles after a resize
        particles = particles.map((p) => (p.x > W || p.y > H ? spawn(true) : p));
      }, 150);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    if (!document.hidden) start();

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reducedMotion]);

  if (reducedMotion || kind === 'none') return null;
  return <canvas ref={canvasRef} className="hs-canvas" aria-hidden="true" />;
}
