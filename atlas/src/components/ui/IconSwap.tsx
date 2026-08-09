import type { ReactNode } from 'react';

export interface IconSwapProps {
  /** Which glyph is showing. */
  active: boolean;
  /** Shown when `active` is true. */
  on: ReactNode;
  /** Shown when `active` is false. */
  off: ReactNode;
  className?: string;
}

/**
 * Crossfades + slightly rotates between two glyphs instead of swapping the text
 * node outright (MOTION_PLAN.md M9) — e.g. the map's `⤢`/`✕` expand icon, or a
 * locate button's `◎`/`◌`. Both glyphs stay mounted, stacked in the same grid
 * cell via `grid-area: 1 / 1` (index.css `.mo-icon-swap`), so there's no layout
 * jump between differently-sized characters and no instant text replacement.
 * Purely presentational — `aria-hidden`, since the calling button already has
 * its own accessible label/title.
 */
export default function IconSwap({ active, on, off, className }: IconSwapProps) {
  const cls = ['mo-icon-swap', className].filter(Boolean).join(' ');
  return (
    <span className={cls} aria-hidden="true">
      <span className={active ? 'is-shown' : 'is-hidden'}>{on}</span>
      <span className={active ? 'is-hidden' : 'is-shown'}>{off}</span>
    </span>
  );
}
