import { useEffect } from 'react';
import { useEffectiveMotion } from './useEffectiveMotion';

const RIPPLE_LIFETIME_MS = 700;
const TINTED_SELECTORS = '.btn-secondary, .btn-icon, .fmt-btn';

/**
 * Press feedback from the exact point of contact, for every `.btn`/`.fmt-btn`
 * in the app.
 *
 * The plan called for a per-button hook (`onPointerDown={useRipple()}`), but
 * there is no shared `<Button>` component here — `.btn`/`.fmt-btn` are applied
 * directly at dozens of call sites across the app, so wiring a handler into
 * each one individually would mean touching every one of those files for a
 * purely decorative effect. A single delegated `pointerdown` listener achieves
 * the identical visible result (a ripple from the pointer, clipped to the
 * button's own rounded corners) without touching any of them: both classes
 * already have `position: relative; overflow: hidden`, so appending a ripple
 * span as their child needs no layout change either.
 *
 * Mount once (e.g. in App.tsx). No-op — attaches no listener at all — when
 * effective motion is off.
 */
export function useGlobalRipple(): void {
  const motion = useEffectiveMotion();

  useEffect(() => {
    if (motion === 'off') return;

    const onPointerDown = (e: PointerEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.btn, .fmt-btn');
      if (!target || target.hasAttribute('disabled')) return;

      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.4;
      const span = document.createElement('span');
      span.className = 'btn-ripple';
      span.style.width = `${size}px`;
      span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left}px`;
      span.style.top = `${e.clientY - rect.top}px`;
      // Bordered/light surfaces read better with a tinted ripple than a flat
      // white one; solid primary/danger buttons keep the default white.
      if (target.matches(TINTED_SELECTORS)) {
        span.style.background = 'color-mix(in srgb, var(--color-terracotta) 28%, transparent)';
      }
      target.appendChild(span);
      window.setTimeout(() => span.remove(), RIPPLE_LIFETIME_MS);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [motion]);
}
