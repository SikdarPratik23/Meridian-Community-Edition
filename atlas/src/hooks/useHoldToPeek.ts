import { useEffect } from 'react';
import { useAtlasStore } from '../store/atlas';
import { useSettings } from '../store/settings';
import { useEffectiveMotion } from './useEffectiveMotion';
import { toast } from '../components/ui/toasts';
import { translate } from '../i18n';

/**
 * Hold-to-peek hook (BACKDROP_BRIEF Phase 3 A2):
 * Long-press anywhere on the home/list surface to fade back panels so the user
 * can look at the animated scene.
 *
 * Rules:
 * - Phone only, home/list surface only (never while composing, editing, or viewing detail).
 * - Arms on pointerdown, fires after 450ms, cancels on >10px drift / scroll / cancel.
 * - Skipped entirely under reduced motion or data-motion="off".
 * - Shows a one-time discovery hint toast persisted in settings (peekHintSeen).
 */
export function useHoldToPeek() {
  const composing = useAtlasStore((s) => s.composing);
  const editing = useAtlasStore((s) => s.editing);
  const selectedEvent = useAtlasStore((s) => s.selectedEvent);
  const selectedDay = useAtlasStore((s) => s.selectedDay);
  const selectedTrip = useAtlasStore((s) => s.selectedTrip);
  const yearReviewOpen = useAtlasStore((s) => s.yearReviewOpen);
  const peekHintSeen = useSettings((s) => s.peekHintSeen);
  const updateSettings = useSettings((s) => s.update);
  const effectiveMotion = useEffectiveMotion();

  useEffect(() => {
    if (effectiveMotion === 'off' || effectiveMotion === 'reduced') return;

    // Active only on home/list view when no pane/editor is open
    const isEditingOrDetail =
      !!composing || !!editing || !!selectedEvent || !!selectedDay || !!selectedTrip || yearReviewOpen;

    if (isEditingOrDetail) return;

    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let isPeeking = false;

    const cancel = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (isPeeking) {
        delete document.documentElement.dataset.peek;
        isPeeking = false;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // Phone/mobile view check
      if (window.innerWidth >= 768) return;
      // Do not trigger on interactive elements (buttons, inputs, links)
      const target = e.target as HTMLElement | null;
      if (
        !target ||
        target.closest('button, a, input, textarea, select, [role="button"], [role="tab"]')
      ) {
        return;
      }

      startX = e.clientX;
      startY = e.clientY;

      timer = window.setTimeout(() => {
        isPeeking = true;
        document.documentElement.dataset.peek = '1';

        // One-time hint
        if (!useSettings.getState().peekHintSeen) {
          const lang = useSettings.getState().language;
          toast.info(translate(lang, 'welcome.peekHint'));
          updateSettings('peekHintSeen', true);
        }
      }, 450);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (timer === null && !isPeeking) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > 10 || dy > 10) {
        cancel();
      }
    };

    const onPointerUp = () => cancel();
    const onPointerCancel = () => cancel();
    const onScroll = () => cancel();

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    return () => {
      cancel();
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [
    composing,
    editing,
    selectedEvent,
    selectedDay,
    selectedTrip,
    yearReviewOpen,
    effectiveMotion,
    peekHintSeen,
    updateSettings,
  ]);
}
