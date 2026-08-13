import { useEffect } from 'react';
import { useSettings } from '../store/settings';
import { useEffectiveMotion } from './useEffectiveMotion';

/**
 * Scroll-linked parallax hook (BACKDROP_BRIEF Phase 3 A3):
 * List scroll publishes a normalized --scroll-p (0 to 1) to document.documentElement,
 * driving subtle translateY displacement on .hs-plane-far (2px) and .hs-plane-near (6px).
 *
 * Rules:
 * - Requires medium+ graphics tier and active interface motion.
 * - rAF-throttled to ensure at most 1 style update per frame.
 * - Cleaned up / skipped under reduced motion.
 */
export function useSceneParallax() {
  const graphicsQuality = useSettings((s) => s.graphicsQuality);
  const effectiveMotion = useEffectiveMotion();

  useEffect(() => {
    if (effectiveMotion === 'off' || effectiveMotion === 'reduced') {
      document.documentElement.style.removeProperty('--scroll-p');
      return;
    }

    if (graphicsQuality === 'low') {
      document.documentElement.style.removeProperty('--scroll-p');
      return;
    }

    let rafId: number | null = null;

    const updateScrollP = () => {
      rafId = null;
      const scroller = document.querySelector('.main-pane') || document.documentElement;
      const scrollTop = scroller.scrollTop || window.scrollY || 0;
      const scrollHeight = scroller.scrollHeight || document.documentElement.scrollHeight || 1;
      const clientHeight = scroller.clientHeight || window.innerHeight || 1;
      const maxScroll = Math.max(1, scrollHeight - clientHeight);
      const p = Math.min(1, Math.max(0, scrollTop / maxScroll));

      document.documentElement.style.setProperty('--scroll-p', p.toFixed(4));
    };

    const onScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(updateScrollP);
      }
    };

    updateScrollP();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.documentElement.style.removeProperty('--scroll-p');
    };
  }, [graphicsQuality, effectiveMotion]);
}
