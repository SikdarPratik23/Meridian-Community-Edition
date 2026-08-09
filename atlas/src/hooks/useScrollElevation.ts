import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * True once a 1px sentinel placed at the very top of a scroll container has
 * scrolled out of view — drives a header's "lifted" shadow once real
 * scrolling has happened (MOTION_PLAN.md M22). An `IntersectionObserver`
 * rather than a scroll listener, per the plan's own instruction: no
 * scroll-event throttling to get right, and it's cheap to hold open even on a
 * long reading pane.
 *
 * Place `sentinelRef` on an empty element as the FIRST child inside the
 * scrollable region, and pass the scroll container itself as `rootRef` (a
 * `RefObject` rather than the element directly, since the container often
 * isn't mounted yet on the render that calls this hook).
 */
export function useScrollElevation(rootRef?: RefObject<HTMLElement | null>) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [elevated, setElevated] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setElevated(!entry.isIntersecting),
      { root: rootRef?.current ?? null, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [rootRef]);

  return { sentinelRef, elevated };
}
