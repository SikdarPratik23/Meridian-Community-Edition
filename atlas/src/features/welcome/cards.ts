/**
 * The registry of welcome-screen cards the user can reorder and show/hide.
 *
 * This is deliberately PURE metadata (no React) so the Settings reorder UI and
 * the WelcomeState renderer can both read it without a component dependency.
 * WelcomeState maps each id → actual JSX; Settings maps each id → a draggable row.
 *
 * Ordering + visibility live in the settings store (`welcomeCardOrder`,
 * `welcomeCardHidden`), persisted per device. When a new card is added to this
 * list in a later version, `reconcileOrder` appends it to a user's saved order so
 * it appears without wiping their arrangement.
 */

export type WelcomeCardId =
  | 'almanac'
  | 'holidays'
  | 'poi';

export interface WelcomeCardMeta {
  id: WelcomeCardId;
  label: string;
  hint: string;
  /** Needs the network / online lookups to show anything. */
  online?: boolean;
  /** Shown unless the user hides it. */
  onByDefault: boolean;
}

// Canonical default order (top → bottom). The user's saved order overrides this.
// Note: the writing prompt is NOT listed here — it lives inside the "Today's
// focus" card at the top of the welcome screen (toggled by the `showFocus` /
// `showPrompt` settings), not as a standalone card in this reorderable grid.
export const WELCOME_CARDS: WelcomeCardMeta[] = [
  { id: 'almanac', label: "Geographer's almanac", hint: 'A rotating geography fact.', onByDefault: true },
  { id: 'holidays', label: 'Holidays & festivals', hint: 'Today and upcoming holidays for your region. Offline.', onByDefault: true },
  { id: 'poi', label: 'Places of interest nearby', hint: 'Notable places around you, from Wikipedia (online).', online: true, onByDefault: true },
];

export const WELCOME_CARD_IDS: WelcomeCardId[] = WELCOME_CARDS.map((c) => c.id);
const KNOWN = new Set<string>(WELCOME_CARD_IDS);
export const WELCOME_CARD_META: Record<WelcomeCardId, WelcomeCardMeta> =
  Object.fromEntries(WELCOME_CARDS.map((c) => [c.id, c])) as Record<WelcomeCardId, WelcomeCardMeta>;

/** The ids hidden by default (cards that are opt-in). */
export function defaultHiddenCards(): WelcomeCardId[] {
  return WELCOME_CARDS.filter((c) => !c.onByDefault).map((c) => c.id);
}

/**
 * Turn a saved order into a full, valid one: keep the saved ids (dropping any
 * unknown/removed ones), then append any cards added since the order was saved
 * so new features surface at the bottom instead of vanishing.
 */
export function reconcileOrder(saved: string[] | undefined): WelcomeCardId[] {
  const seen = new Set<string>();
  const out: WelcomeCardId[] = [];
  for (const id of saved ?? []) {
    if (KNOWN.has(id) && !seen.has(id)) {
      out.push(id as WelcomeCardId);
      seen.add(id);
    }
  }
  for (const id of WELCOME_CARD_IDS) if (!seen.has(id)) out.push(id);
  return out;
}
