import { useEffect, useRef, useState } from 'react';

export interface IndicatorRect {
  /** Offset of the active item's left edge from the container's left edge. */
  x: number;
  width: number;
}

/** The pure geometry: where the indicator should sit given the active child's
 *  rect and the container's rect, both in the same coordinate space (i.e. both
 *  from `getBoundingClientRect()`). Exported so the measurement math is
 *  testable without a real layout. */
export function indicatorRect(container: DOMRect, active: DOMRect): IndicatorRect {
  return { x: active.left - container.left, width: active.width };
}

/** Whether a row of options has wrapped onto more than one line — compares the
 *  container's rendered height to a single row's height. The segmented control
 *  (MOTION_PLAN.md M8) falls back to a plain colour swap and hides the sliding
 *  pill when this is true: a pill that has to jump between rows reads as more
 *  broken than an instant colour flip, not less. 1.4× rather than 2× so it
 *  trips even with a little row-to-row gap, well before a false 2-row height. */
export function isWrappedRow(containerHeight: number, rowHeight: number): boolean {
  if (rowHeight <= 0) return false;
  return containerHeight > rowHeight * 1.4;
}

/**
 * Measures the active item in a row of buttons against its container and
 * returns where a sliding pill/underline indicator should sit — used by the
 * segmented control and the sidebar tabs. Re-measures on resize, once fonts
 * finish loading (the app loads Inter, Merriweather and two Bengali faces, so
 * the very first measurement can land pre-swap), and whenever the caller's own
 * `deps` change (e.g. the active index, or the language — Bengali labels are a
 * different width).
 */
export function useSlidingIndicator<C extends HTMLElement, A extends HTMLElement>(
  deps: readonly unknown[],
): {
  containerRef: React.RefObject<C | null>;
  activeRef: React.RefObject<A | null>;
  rect: IndicatorRect | null;
} {
  const containerRef = useRef<C>(null);
  const activeRef = useRef<A>(null);
  const [rect, setRect] = useState<IndicatorRect | null>(null);

  // Deliberately NOT memoized with useCallback: `containerRef`/`activeRef` are
  // stable ref objects and `setRect` has a stable identity, so a fresh closure
  // every render still always reads the current DOM nodes — there is nothing
  // for memoizing this function to buy.
  const measure = () => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) {
      setRect(null);
      return;
    }
    setRect(indicatorRect(container.getBoundingClientRect(), active.getBoundingClientRect()));
  };

  useEffect(() => {
    measure();
    // Re-measure whenever the CALLER's own deps change (active index,
    // language, …) — that is the entire point of taking `deps` as a
    // parameter, so it can't be listed as a static dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    return () => ro.disconnect();
    // Runs once per mount; `measure` reads live refs/state setters, so a
    // "stale" closure from mount still measures correctly on every call.
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { containerRef, activeRef, rect };
}
