import { useRef, useCallback, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';
import { useIsTwoPane } from '../../hooks/useIsTwoPane';

export interface BottomSheetProps {
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
  /** Desktop wrapper classes. Defaults to the frosted pane the five detail
   *  surfaces had before P3; YearReview passes '' because it never had frost
   *  and §9 says the desktop layout does not change. */
  desktopClassName?: string;
  /** Minimum drag distance (px) required to dismiss. Default: 90. */
  dismissThreshold?: number;
}

/**
 * Reading/editing surfaces as a phone bottom sheet with drag-down dismiss
 * (MOTION_PLAN.md Part II, P3). On desktop (>= md) this renders the plain
 * centred pane those surfaces already had — NOT a sheet, and not a second copy
 * of the children: `useIsTwoPane()` picks one branch so only one instance of
 * the child ever mounts and runs effects. See WelcomeDashboard for the
 * precedent (P1) and why a `md:hidden` class is not good enough here.
 */
export default function BottomSheet({
  onDismiss,
  children,
  className = '',
  desktopClassName = 'panel-frost pane-frost',
  dismissThreshold = 90,
}: BottomSheetProps) {
  const isTwoPane = useIsTwoPane();
  const motion = useEffectiveMotion();

  const sheetRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const dragYRef = useRef(0);
  const draggingRef = useRef(false);

  // The drag is driven by direct style writes, not React state: the children
  // here are whole editors, and re-rendering them on every pointermove is the
  // difference between a smooth drag and a janky one on a phone.
  const paint = useCallback((y: number) => {
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${Math.max(-20, y)}px)`;
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    startTimeRef.current = Date.now();
    dragYRef.current = 0;
    draggingRef.current = true;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientY - startYRef.current;
    // Down: 1:1. Up: rubber-band, and `paint` clamps it at -20px.
    dragYRef.current = delta > 0 ? delta : delta * 0.2;
    paint(dragYRef.current);
  }, [paint]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // capture was already lost (pointercancel) — nothing to release
    }

    const travelled = dragYRef.current;
    const elapsed = Date.now() - startTimeRef.current;
    const velocity = elapsed > 50 ? travelled / elapsed : 0;

    dragYRef.current = 0;
    if (sheetRef.current) {
      // Matches the 160ms exit convention the rest of the motion pass uses;
      // an exit animation IS motion, so Off springs back instantly.
      sheetRef.current.style.transition = motion === 'off' ? 'none' : 'transform 200ms ease-out';
    }
    paint(0);

    if (travelled > dismissThreshold || velocity > 0.5) onDismiss();
  }, [motion, paint, dismissThreshold, onDismiss]);

  // Desktop: exactly the wrapper these surfaces had before P3. No sheet, no
  // grabber, no second copy of `children` mounted behind a `hidden` class.
  if (isTwoPane) {
    return (
      <div className={`h-full max-w-3xl mx-auto ${desktopClassName} ${className}`.trim()}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={sheetRef}
      data-testid="bottom-sheet-mobile"
      role="dialog"
      aria-modal="true"
      // `pane-frost` supplies BOTH the frosted phone treatment and the
      // `padding-bottom: var(--tabbar-clear)` that keeps the sheet's own
      // content out from under the z-50 tab bar. --tabbar-clear already
      // includes env(safe-area-inset-bottom); do not add that a second time.
      className={`panel-frost pane-frost fixed inset-x-0 bottom-0 z-40 flex h-full max-h-[92dvh] flex-col rounded-t-2xl border-t border-water bg-surface shadow-2xl ${className}`.trim()}
    >
      <div
        data-testid="bottom-sheet-grabber"
        aria-label="Drag down to close"
        className="w-full shrink-0 select-none touch-none rounded-t-2xl border-b border-water/40 bg-surface py-2 flex items-center justify-center cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-1.5 w-12 rounded-full bg-ink/30" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
