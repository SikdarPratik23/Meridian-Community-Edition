import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../store/settings';
import { toast } from '../components/ui/toasts';
import { translate } from '../i18n';
import type { GraphicsQuality } from '../store/settings';

const HOLD_TOLERANCE_PX = 10;
/** Matches `.hs-compass-rose`'s `hs-compass-pop` animation duration (index.css)
 *  — the state is cleared right after the CSS has fully faded it out, so the
 *  span doesn't sit invisible-but-mounted in the DOM indefinitely after a tap. */
const AUTO_DISMISS_MS = 4000;

/**
 * Tap-the-sky compass rose (BACKDROP_BRIEF Phase 4 D2).
 *
 * This is a WINDOW-level pointerup listener, not a click handler on the
 * backdrop element — the backdrop renders at `z-0`, behind every panel/pane/
 * card in the app, so it never receives a pointer event no matter what
 * `pointer-events` value it's given: whatever is visually on top of a given
 * pixel is what `elementFromPoint`/hit-testing resolves to, and in this app's
 * layout something is ALWAYS on top (confirmed live: 0 of 33 sampled screen
 * points resolved to the backdrop). `useHoldToPeek.ts` already solved this
 * exact problem for its own long-press gesture by listening on `window`
 * instead, which is why this hook follows the same shape.
 *
 * Rules, mirroring useHoldToPeek's conventions:
 * - Skipped below the `medium` graphics tier — this is a discoverability
 *   affordance, not core weather, same convention `AmbientBackground`'s M42
 *   wash and Map.tsx's POI-bob already use for "atmosphere, not core".
 * - Fires on pointerUP (a genuine tap), not pointerdown, and only if the
 *   pointer moved less than `HOLD_TOLERANCE_PX` — so it doesn't fire mid-scroll
 *   or mid-swipe.
 * - Never fires on an interactive element, a card, a pane, or the tab bar.
 * - Shows a one-time discovery hint toast, persisted in settings
 *   (`compassHintSeen`), like `peekHintSeen` before it.
 * - The compass rose itself is hidden under reduced motion via index.css (it's
 *   listed there next to the other pure-motion decorations); this hook still
 *   arms so a tap doesn't silently do nothing under that setting — it simply
 *   won't animate in.
 */
// NOT `.panel-frost`: that class is the WHOLE sidebar column's frosted background
// (Sidebar.tsx's own root — confirmed by reading it), not an individual card, so
// excluding it would exclude the entire screen and make this feature exactly as
// unreachable as the version it replaces, just via a different selector. `.pane-
// frost` stays excluded because THAT one really is a specific surface (a full-
// screen reading/editing pane), same as `.welcome-card`.
const EXCLUDED = 'button, a, input, textarea, select, [role="button"], [role="tab"], ' +
  '[role="dialog"], .welcome-card, .welcome-card-land, .tabbar, .pane-frost, .markdown';

export function useSkyTap(graphicsQuality: GraphicsQuality) {
  const [compass, setCompass] = useState<{ x: number; y: number; id: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (graphicsQuality === 'low') return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.closest(EXCLUDED)) { tracking = false; return; }
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > HOLD_TOLERANCE_PX || dy > HOLD_TOLERANCE_PX) return;

      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      setCompass({ x: e.clientX, y: e.clientY, id: Date.now() });
      dismissTimer.current = setTimeout(() => setCompass(null), AUTO_DISMISS_MS);

      if (!useSettings.getState().compassHintSeen) {
        const lang = useSettings.getState().language;
        toast.info(translate(lang, 'welcome.compassHint'));
        useSettings.getState().update('compassHintSeen', true);
      }
    };

    const onPointerCancel = () => { tracking = false; };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [graphicsQuality]);

  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); }, []);

  return compass;
}
