import { useSettings } from '../store/settings';
import type { MotionLevel } from '../store/settings';
import { effectiveMotion } from '../utils/motion';
import { useReducedMotion } from './useReducedMotion';

/**
 * The Motion setting folded with the live OS preference — what every new
 * animation primitive (Presence, Disclosure, AsyncButton, the sliding
 * indicator, the ripple) actually checks before deciding whether to animate.
 */
export function useEffectiveMotion(): MotionLevel {
  const setting = useSettings((s) => s.motion);
  const prefersReduced = useReducedMotion();
  return effectiveMotion(setting, prefersReduced);
}
