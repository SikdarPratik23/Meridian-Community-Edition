import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToasts, type Toast } from './toasts';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';

/**
 * Renders the toast stack. Mounted once, at the app root.
 *
 * Placement differs by form factor on purpose:
 *   - **Phone:** full-width along the bottom, above `env(safe-area-inset-bottom)`
 *     so it clears the home indicator, and above the map button. The bottom is
 *     within thumb reach, which matters because the Undo action is the point.
 *   - **Desktop:** bottom-right, auto-width. Out of the way of the reading column,
 *     and where a notification is conventionally expected.
 *
 * Rendered through a portal so the stack can never be clipped by a pane's
 * `overflow: hidden` (the main pane and sidebar both have it).
 *
 * Wave 2 (M7) — "the stack must glide down when one above it dismisses": entering
 * beautifully then leaving instantly was the single most jarring motion in the
 * app. A dismissed toast doesn't just disappear from the store — it lingers here
 * for EXIT_MS playing `.toast-exit`, and once it's actually removed, `useFlipGlide`
 * below nudges the remaining rows from their old position to their new one instead
 * of letting the flex reflow snap them. `<Presence>` isn't reused here on purpose:
 * it animates ONE child's mount/unmount, not a list's reflow when a sibling leaves.
 */

/** How long a dismissed row plays `.toast-exit` before this component stops
 *  rendering it. Matches the class's own `--mo-fast` duration at full motion —
 *  the same "a JS timer hand-matches a CSS duration" pattern as AsyncButton's
 *  CHECK_DRAW_MS. */
const EXIT_MS = 160;

interface TrackedToast {
  toast: Toast;
  exiting: boolean;
}

/** Keeps a toast rendered (marked `exiting`) for EXIT_MS after the store drops
 *  it, instead of unmounting the instant `dismiss()`/auto-timeout fires. */
function useTrackedToasts(storeToasts: Toast[], motionOff: boolean): TrackedToast[] {
  const [tracked, setTracked] = useState<TrackedToast[]>(() =>
    storeToasts.map((toast) => ({ toast, exiting: false })),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Diffing runs in an effect, not during render: this project's lint config
  // (`react-hooks/refs`) disallows the ref-during-render version of "adjust
  // state from a prop change". The one-tick lag is invisible here — the store
  // and this component re-render together on every toast/dismiss anyway.
  useEffect(() => {
    // Syncing `tracked` to a change in the store's own toast list — the store
    // update already caused this render; this just folds it into local state
    // that additionally remembers toasts mid-exit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTracked((prev) => {
      const liveIds = new Set(storeToasts.map((t) => t.id));
      const knownIds = new Set(prev.map((v) => v.toast.id));
      const arrived = storeToasts.filter((t) => !knownIds.has(t.id)).map((t) => ({ toast: t, exiting: false }));
      const carried = prev.map((v) => (liveIds.has(v.toast.id) || v.exiting ? v : { ...v, exiting: true }));
      return [...arrived, ...carried];
    });
  }, [storeToasts]);

  useEffect(() => {
    tracked.forEach(({ toast, exiting }) => {
      if (!exiting || timers.current.has(toast.id)) return;
      const id = setTimeout(() => {
        timers.current.delete(toast.id);
        setTracked((prev) => prev.filter((v) => v.toast.id !== toast.id));
      }, motionOff ? 0 : EXIT_MS);
      timers.current.set(toast.id, id);
    });
  }, [tracked, motionOff]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  return tracked;
}

/** FLIP: when a row is removed and the flex stack reflows, nudge the rows that
 *  moved from their old screen position to the new one instead of letting them
 *  snap. Only touches rows that persisted across the change — a freshly-added
 *  row has no "old" position and just plays its own `toast-in` entrance. */
function useFlipGlide(ids: string[], motionOff: boolean) {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const prevTops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    if (!motionOff) {
      nodes.current.forEach((el, id) => {
        const prevTop = prevTops.current.get(id);
        if (prevTop === undefined) return;
        const nextTop = el.getBoundingClientRect().top;
        const dy = prevTop - nextTop;
        if (Math.abs(dy) < 0.5) return;
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        el.getBoundingClientRect(); // force a reflow so the browser commits the inverted position first
        el.style.transition = '';
        el.style.transform = '';
      });
    }
    const next = new Map<string, number>();
    nodes.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top));
    prevTops.current = next;
    // Re-run whenever the set of rendered ids changes — a new row shifting its
    // siblings, or a removed row leaving a gap, are exactly the two reflows this
    // needs to glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|'), motionOff]);

  return (id: string) => (el: HTMLDivElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };
}

function ToastRow({ toast, exiting, rowRef }: { toast: Toast; exiting: boolean; rowRef: (el: HTMLDivElement | null) => void }) {
  const dismiss = useToasts((s) => s.dismiss);

  // Auto-dismiss. A duration of 0 means "stay until dismissed". No-op once
  // exiting: the store has already dropped it, so this would just be a second
  // harmless call.
  useEffect(() => {
    if (exiting || toast.durationMs <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, exiting, dismiss]);

  const accent =
    toast.variant === 'success'
      ? 'border-l-forest'
      : toast.variant === 'danger'
        ? 'border-l-terracotta'
        : 'border-l-water';

  return (
    <div
      ref={rowRef}
      className={`toast-row pointer-events-auto flex items-center gap-3 rounded-lg border border-water border-l-4 ${accent} bg-surface px-3 py-2.5 shadow-lg ${exiting ? 'toast-exit' : ''}`}
      role="status"
    >
      <span className="min-w-0 flex-1 text-sm text-ink/80">{toast.message}</span>
      {/* Buttons disappear the instant exit starts, not just when the row
          finally unmounts — otherwise an Undo would stay clickable for the
          whole fade, and pressing it twice would run the restore twice. */}
      {!exiting && toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
          className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-terracotta transition-colors hover:bg-land"
        >
          {toast.action.label}
        </button>
      )}
      {!exiting && (
        <button
          type="button"
          onClick={() => dismiss(toast.id)}
          className="shrink-0 text-ink/35 transition-colors hover:text-ink"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function ToastHost() {
  const storeToasts = useToasts((s) => s.toasts);
  const motion = useEffectiveMotion();
  const tracked = useTrackedToasts(storeToasts, motion === 'off');
  const rowRef = useFlipGlide(tracked.map((v) => v.toast.id), motion === 'off');

  if (typeof document === 'undefined' || tracked.length === 0) return null;

  return createPortal(
    <div
      // `pointer-events-none` on the container so the empty space around the
      // toasts never blocks the map or a button underneath; each row re-enables it.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex flex-col-reverse gap-2 p-3 safe-pb sm:inset-x-auto sm:right-0 sm:max-w-sm"
      // Announced politely: a toast is confirmation, not an interruption.
      aria-live="polite"
      aria-atomic="false"
    >
      {tracked.map(({ toast, exiting }) => (
        <ToastRow key={toast.id} toast={toast} exiting={exiting} rowRef={rowRef(toast.id)} />
      ))}
    </div>,
    document.body,
  );
}
