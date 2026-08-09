import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncButtonPhase = 'idle' | 'working' | 'done' | 'error';

export interface AsyncButtonResult<T = undefined> {
  ok: boolean;
  data?: T;
}

/** How long the checkmark draw runs for before `onSettled` fires on success —
 *  mirrors the `async-tick-draw` keyframe's default-motion duration
 *  (index.css), the same "a JS timer hand-matches a CSS duration" pattern
 *  already used for the timeline's delete exit (`entry-out`, 220ms). */
const CHECK_DRAW_MS = 420;
/** How long the done/error label is shown before reverting to idle. Fixed
 *  regardless of the Motion setting — this is reading time, not decoration. */
const DEFAULT_SETTLE_MS = 2000;

interface AsyncButtonProps<T = undefined>
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> {
  /** What the button does. Resolving `{ ok: true }` (or nothing) shows the
   *  done state; `{ ok: false }` (or a thrown/rejected promise) shows the
   *  error state. */
  run: () => Promise<AsyncButtonResult<T> | void> | AsyncButtonResult<T> | void;
  /** Fires once the checkmark has finished drawing on a SUCCESSFUL run — the
   *  right place to navigate away (close a pane, etc.) so the confirmation is
   *  seen before the view changes. Not called on error: an error usually means
   *  "stay put", and the caller's own `run()` can surface its own message. */
  onSettled?: (result: AsyncButtonResult<T>) => void;
  idleLabel: React.ReactNode;
  workingLabel?: React.ReactNode;
  doneLabel?: React.ReactNode;
  errorLabel?: React.ReactNode;
  /** How long the done/error state is shown before reverting to idle. */
  settleMs?: number;
}

/**
 * The shared "working → done" treatment (MOTION_PLAN.md §3.6g / M6): a
 * hairline indeterminate progress edge while working, a label crossfade on
 * every phase change, a self-drawing checkmark on success, and a colour swap
 * for done/error — replacing the ad-hoc `disabled` + label-swap every async
 * button in the app previously rolled by hand.
 *
 * Renders a plain `<button>` so it stays a real, accessible button — pass the
 * usual `.btn`/`.btn-primary`/etc. via `className`, exactly as before.
 */
export default function AsyncButton<T = undefined>({
  run,
  onSettled,
  idleLabel,
  workingLabel,
  doneLabel,
  errorLabel,
  settleMs = DEFAULT_SETTLE_MS,
  className = '',
  disabled,
  ...rest
}: AsyncButtonProps<T>) {
  const [phase, setPhase] = useState<AsyncButtonPhase>('idle');
  const settledTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const revertTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (settledTimer.current) clearTimeout(settledTimer.current);
      if (revertTimer.current) clearTimeout(revertTimer.current);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    if (phase === 'working') return;
    if (settledTimer.current) clearTimeout(settledTimer.current);
    if (revertTimer.current) clearTimeout(revertTimer.current);

    setPhase('working');
    let result: AsyncButtonResult<T>;
    try {
      const r = await run();
      result = r && typeof r === 'object' ? r : { ok: true };
    } catch {
      result = { ok: false };
    }

    setPhase(result.ok ? 'done' : 'error');
    revertTimer.current = setTimeout(() => setPhase('idle'), settleMs);
    if (result.ok) {
      settledTimer.current = setTimeout(() => onSettled?.(result), CHECK_DRAW_MS);
    }
  }, [phase, run, onSettled, settleMs]);

  const label =
    phase === 'working' ? (workingLabel ?? idleLabel)
    : phase === 'done' ? (doneLabel ?? idleLabel)
    : phase === 'error' ? (errorLabel ?? idleLabel)
    : idleLabel;

  const phaseClass = phase === 'done' ? ' async-btn-done' : phase === 'error' ? ' async-btn-error' : '';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || phase === 'working'}
      aria-busy={phase === 'working'}
      className={`async-btn${phaseClass} ${className}`}
      {...rest}
    >
      <span className="async-btn-prog" aria-hidden="true" />
      <span key={phase} className="async-btn-label">
        {label}
      </span>
      {phase === 'done' && (
        <svg className="async-btn-tick" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12.5 L9.5 18 L20 6" />
        </svg>
      )}
    </button>
  );
}
