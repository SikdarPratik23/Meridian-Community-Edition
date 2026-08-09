import { useLayoutEffect, useRef } from 'react';

/**
 * FLIP for a list that reflows when an item leaves (or arrives) — measure the
 * old position, invert into a transform, release it so the browser animates
 * from there back to identity, instead of letting the layout snap. Same
 * technique as `ToastHost.tsx`'s bespoke stack-glide (Wave 2), promoted here
 * because `Timeline.tsx` needs it too (MOTION_PLAN.md M16) and a second
 * hand-rolled copy isn't worth the duplication. `ToastHost.tsx` keeps its own
 * copy rather than being migrated onto this — it's already shipped and tested,
 * and touching it isn't this wave's job.
 *
 * Only items that persisted across the id-set change get glided; a freshly
 * arrived item has no "old" position and just plays its own entrance, and a
 * removed item is simply gone (nothing left to animate).
 */
export function useFlipReflow(ids: readonly string[], disabled: boolean) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const prevTops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    if (!disabled) {
      nodes.current.forEach((el, id) => {
        const prevTop = prevTops.current.get(id);
        if (prevTop === undefined) return;
        const nextTop = el.getBoundingClientRect().top;
        const dy = prevTop - nextTop;
        if (Math.abs(dy) < 0.5) return;
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        el.getBoundingClientRect(); // force layout so the browser commits the inverted position first
        el.style.transition = '';
        el.style.transform = '';
      });
    }
    const next = new Map<string, number>();
    nodes.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top));
    prevTops.current = next;
    // Re-run whenever the SET of ids changes (an item arriving or leaving) —
    // a string join keeps the dependency stable across re-renders that don't
    // actually change membership or order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|'), disabled]);

  return (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };
}
