/**
 * Which side the "Today's focus" card shows — the pure decision, split out of
 * `DailyFocus.tsx` so it can be tested (and so the component file keeps exporting
 * only a component, which Fast Refresh requires).
 *
 * There are three inputs and one rule: an explicit user toggle wins *when that
 * side has something to show*, and otherwise the card falls back **prompt first**.
 * That order changed on 2026-08-05 at the user's request — "keep the prompt as
 * default and places to be the option… that makes the welcome page much more
 * clean". The place card leads with a Wikipedia photo, which made opening the app
 * a picture of somewhere else rather than an invitation to write.
 *
 * Availability is not symmetric, which is why this is worth a function: the prompt
 * needs only a setting, while a place needs coordinates, online lookups, and a
 * non-empty search result. A `preferred` side that has become unavailable (lookups
 * switched off, signal lost) must not strand the card on an empty view.
 */
export type FocusMode = 'prompt' | 'place';

export function focusMode(
  /** The side the user last tapped, or null if they never did. */
  preferred: FocusMode | null,
  /** Is the writing prompt available? (The `showPrompt` setting.) */
  canShowPrompt: boolean,
  /** Is a nearby place available? (Coords + online lookups + a non-empty pool.) */
  canShowPlace: boolean,
): FocusMode {
  if (preferred === 'prompt' && canShowPrompt) return 'prompt';
  if (preferred === 'place' && canShowPlace) return 'place';
  // No usable preference: the prompt is the default side.
  return canShowPrompt ? 'prompt' : 'place';
}
