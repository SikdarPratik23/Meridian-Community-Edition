import { useEffect, useRef } from 'react';
import { useAtlasStore } from '../store/atlas';

/**
 * Left-edge swipe back gesture for mobile detail surfaces (MOTION_PLAN.md Part II, P4).
 *
 * Listens for touch gestures starting near the left edge (<= 30px) when a phone
 * detail view is open (`mobileDetailOpen`). A rightward swipe (>= 60px horizontal
 * drag with minimal vertical drift) backs out of the current detail view using
 * M13's directional pane transition.
 */
export function useSwipeBack() {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX <= 30) {
        startXRef.current = touch.clientX;
        startYRef.current = touch.clientY;
        triggeredRef.current = false;
      } else {
        startXRef.current = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startXRef.current || triggeredRef.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startXRef.current;
      const deltaY = Math.abs(touch.clientY - startYRef.current);

      if (deltaX >= 60 && deltaY < deltaX * 0.7) {
        const s = useAtlasStore.getState();
        const mobileDetailOpen = !!(
          s.selectedEvent ||
          s.selectedDay ||
          s.selectedTrip ||
          s.composing ||
          s.editing ||
          s.yearReviewOpen ||
          s.mapExpanded
        );

        if (mobileDetailOpen) {
          triggeredRef.current = true;
          // Trigger the appropriate back action based on active detail view
          if (s.editing) {
            s.stopEditing();
          } else if (s.composing) {
            s.stopComposing();
          } else if (s.selectedEvent) {
            s.selectEvent(null);
          } else if (s.selectedDay) {
            s.selectDay(null);
          } else if (s.selectedTrip) {
            s.selectTrip(null);
          } else if (s.yearReviewOpen) {
            s.setYearReviewOpen(false);
          } else if (s.mapExpanded) {
            s.setMapExpanded(false);
          }
        }
      }
    };

    const onTouchEnd = () => {
      startXRef.current = 0;
      triggeredRef.current = false;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);
}
