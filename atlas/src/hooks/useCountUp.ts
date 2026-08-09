import { useEffect, useRef, useState } from 'react';
import { useEffectiveMotion } from './useEffectiveMotion';

const DURATION_MS = 850;

/** Cubic ease-out: fast at the start, settling into the target. Exported so it
 *  can be tested without a DOM. */
export function easeOutCubic(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  return 1 - Math.pow(1 - clamped, 3);
}

/** The counted value at progress `p` (0–1) between `from` and `to`. Exported so
 *  the frame math can be tested without a DOM or a real animation frame. */
export function frameValue(from: number, to: number, p: number): number {
  return from + (to - from) * easeOutCubic(p);
}

/**
 * Animates a number counting up (or down) from wherever it last landed to
 * `target`, easing out over ~850ms scaled by the Motion setting. Starts from
 * zero on mount (the "the journal is tallying your year" effect this exists
 * for) but from the PREVIOUS value on every change after that — a stat going
 * 311 → 312 ticks by one, it does not re-count from nothing. Returns the
 * target immediately, with no animation, when motion is off.
 */
export function useCountUp(target: number): number {
  const motion = useEffectiveMotion();
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;

    if (motion === 'off') {
      displayRef.current = target;
      // Synchronizing the displayed number with a prop that changed — motion
      // off means "no animation", not "no update".
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(target);
      return;
    }

    const duration = motion === 'reduced' ? DURATION_MS * 0.7 : DURATION_MS;
    const start = performance.now();

    const step = (now: number) => {
      const p = duration > 0 ? (now - start) / duration : 1;
      if (p >= 1) {
        displayRef.current = target;
        setDisplay(target);
        return;
      }
      const value = frameValue(from, target, p);
      displayRef.current = value;
      setDisplay(value);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [target, motion]);

  return Math.round(display);
}
