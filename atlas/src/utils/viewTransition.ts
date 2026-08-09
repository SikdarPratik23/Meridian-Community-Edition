/**
 * View Transitions — smooth pane changes.
 *
 * Switching between the welcome screen, the editor, an entry and a day view is a
 * hard swap: one React tree unmounts and another mounts in the same frame. Each
 * pane has its own entrance animation, but the *change itself* has none, which is
 * what makes the app feel like a web page rather than an application.
 *
 * `document.startViewTransition` fixes that at the browser level: it snapshots the
 * page, applies the DOM change, and cross-fades between the two states (styled in
 * `index.css` under "View Transitions"). No animation library, no state machine,
 * and nothing to keep in sync.
 *
 * The whole design here is that it must be IMPOSSIBLE for this to break the app:
 *   - Where the API doesn't exist (Firefox, older Safari), the callback is invoked
 *     directly, so the pane changes exactly as it does today.
 *   - Where the user prefers reduced motion, we skip the transition entirely
 *     rather than relying only on the CSS opt-out, so no snapshot work happens.
 *   - Where the user has turned pane transitions off in Settings, likewise.
 *   - A transition that fails is swallowed: the DOM change has already been
 *     applied by then, so the only consequence is a missing cross-fade.
 */
import { useSettings } from '../store/settings';

/**
 * The narrow slice of the API this module uses.
 *
 * Deliberately NOT declared by extending `Document`: the DOM lib already declares
 * `startViewTransition` with a wider signature (it also accepts an options
 * object), so an `interface … extends Document` redeclaring it is a type conflict.
 * Reading the method off a structural type keeps this working whether or not the
 * installed lib knows about the API.
 */
type StartViewTransition = (callback: () => void) => { finished: Promise<void> };

/** The bound method, or null where the browser doesn't implement it. */
function resolveStartViewTransition(): StartViewTransition | null {
  if (typeof document === 'undefined') return null;
  const fn = (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  return typeof fn === 'function' ? (fn as StartViewTransition).bind(document) : null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Whether a transition would actually animate right now. Exported for tests and
 *  so a caller can skip preparatory work when nothing will animate. */
export function viewTransitionsAvailable(): boolean {
  if (!resolveStartViewTransition()) return false;
  if (prefersReducedMotion()) return false;
  return useSettings.getState().paneTransitions;
}

/** Which way the pane change reads, purely for styling (M13, index.css's
 *  `data-vt-direction` rules) — 'forward' = going deeper (opening an entry,
 *  a day, the editor), 'back' = returning to what was there before. Has no
 *  effect on whether or how many times `change` runs. */
export type ViewTransitionDirection = 'forward' | 'back';

/**
 * Apply a DOM/state change inside a view transition when that's possible, and
 * plainly otherwise. `change` runs exactly once either way — callers can treat this
 * as "just call my function".
 */
export function withViewTransition(change: () => void, direction: ViewTransitionDirection = 'forward'): void {
  const start = viewTransitionsAvailable() ? resolveStartViewTransition() : null;
  if (!start) {
    change();
    return;
  }
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const clearDirection = () => { if (root) delete root.dataset.vtDirection; };
  if (root) root.dataset.vtDirection = direction;
  try {
    // A rejected transition (e.g. another one started mid-flight) is not an error
    // worth surfacing — the state change already happened.
    void start(change).finished.catch(() => {}).finally(clearDirection);
  } catch {
    // Some engines throw if a transition is already running. The change still has
    // to happen, and `startViewTransition` won't have run the callback if it threw.
    clearDirection();
    change();
  }
}
