import { useEffect, useRef, useState } from 'react';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';

export interface PresenceProps {
  /** Whether the content should be mounted. Flipping to false starts the exit
   *  animation instead of unmounting immediately; flipping back to true before
   *  the exit finishes cancels it and re-enters. */
  when: boolean;
  /** How long the exit animation needs before the children actually unmount. */
  exitMs: number;
  /** Applied while `when` is true. */
  enterClassName?: string;
  /** Applied for `exitMs` after `when` goes false. */
  exitClassName?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Mount/unmount with an exit animation — the single most-used primitive in the
 * motion pass, because the app consistently animates things *arriving* and
 * never animates them *leaving*. Generalises the pattern already proven in
 * `Timeline.tsx` (the `removingId` + 220ms `beforeCommit` gate behind
 * `entry-out`) into something any `{cond && <X/>}` can adopt.
 *
 * When effective motion is off, unmounts immediately with no delay — an exit
 * animation IS motion, so there is nothing to wait for.
 */
export default function Presence({ when, exitMs, enterClassName, exitClassName, className, children }: PresenceProps) {
  const [mounted, setMounted] = useState(when);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const motion = useEffectiveMotion();

  useEffect(() => {
    if (when) {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Synchronizing local state with the `when` prop — a re-entry mid-exit
      // must cancel synchronously, or a stale timer would unmount right
      // after this same render re-shows the content.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExiting(false);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (motion === 'off') {
      setMounted(false);
      setExiting(false);
      return;
    }
    setExiting(true);
    timerRef.current = setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, exitMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `mounted` is read, not depended on, deliberately: this effect only needs
    // to re-run when `when` (or the exit duration/motion level) changes, not
    // every time `mounted` itself flips as a *result* of this same effect —
    // depending on it would immediately re-fire and cancel the timer it just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, exitMs, motion]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!mounted) return null;

  const cls = [className, exiting ? exitClassName : enterClassName].filter(Boolean).join(' ');
  return <div className={cls || undefined}>{children}</div>;
}
