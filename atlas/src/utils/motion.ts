/**
 * Motion — small pure helpers shared by every animation in the app.
 *
 * `effectiveMotion` decides what actually plays: the OS "reduce motion" request
 * always wins over whatever the in-app Motion setting says, because it is a
 * stated accessibility need, not a preference to be second-guessed.
 *
 * `stagger` is the one entrance-stagger delay used everywhere a list enters —
 * previously duplicated as a local constant in Timeline.tsx. It emits a CSS
 * `calc()` against the `--mo-stagger` token (see index.css) rather than a plain
 * millisecond number, so the delay itself scales with the Motion setting the
 * same way every other animation does, without this module needing to know
 * which motion level is currently active.
 */
import type { MotionLevel } from '../store/settings';

/** The OS setting is authoritative: a user who asked the system to reduce motion
 *  gets motion off, regardless of what the app setting says. */
export function effectiveMotion(setting: MotionLevel, prefersReduced: boolean): MotionLevel {
  return prefersReduced ? 'off' : setting;
}

/** Stagger delay for the i-th item in an entering list, capped at 8 items so a
 *  long list doesn't crawl in. */
export function stagger(i: number): { animationDelay: string } {
  return { animationDelay: `calc(var(--mo-stagger, 45ms) * ${Math.min(i, 8)})` };
}
