import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function readPreference(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;
}

/**
 * Live OS "reduce motion" preference. Several components already read this
 * inline via `matchMedia` (HillsideScene, SeasonAccent, ParticleField,
 * viewTransition.ts) inside a hot-path `useMemo` — those are left alone, since
 * refactoring them is churn with no user-visible benefit. New code should use
 * this hook instead, which — unlike a one-off `matches` read — reacts if the OS
 * setting changes while the app is open.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
