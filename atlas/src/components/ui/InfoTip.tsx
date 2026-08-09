import { useDialogs } from './dialogs';

/**
 * A small ⓘ affordance that reveals a short explanation on demand, so a settings
 * row can show just its control and keep the "what does this do?" copy one tap
 * away instead of as an always-on wall of text.
 *
 * It opens the app's standard modal (see Dialog.tsx / `alert`): a centred popup
 * (bottom sheet on phones) with a title and a ✕ close button at the top. An
 * earlier version anchored an inline popover to the icon, but near a screen edge
 * that popover could shift and get clipped — the centred modal never does, and
 * it reuses the focus-trap / Escape / backdrop behaviour we already have.
 *
 * Purely supplementary — the control it annotates is always visible and usable
 * without ever opening this.
 */
export default function InfoTip({
  label,
  children,
}: {
  /** What this explains — becomes the popup title and the accessible label. */
  label?: string;
  children: React.ReactNode;
}) {
  const { alert } = useDialogs();
  return (
    <button
      type="button"
      onClick={() => {
        void alert({ title: label ?? 'About this', message: children, confirmLabel: 'Got it' });
      }}
      aria-label={label ? `About ${label}` : 'More information'}
      className="info-dot"
    >
      ⓘ
    </button>
  );
}
