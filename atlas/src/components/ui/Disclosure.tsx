export interface DisclosureProps {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * A collapsible panel that animates its height open/closed via
 * `grid-template-rows: 0fr → 1fr` (see `.mo-disclosure` in index.css) — no JS
 * height measurement, no `max-height` guessing. Replaces the app's dozen-odd
 * `{cond && <div>…</div>}` panels (search filters, storage details, the
 * trip-name field, map banners, …) that previously popped open/shut instead of
 * animating, shoving the layout around them.
 *
 * Always keeps its single child mounted — this animates OPEN/CLOSE, not
 * mount/unmount. Pair with `<Presence>` instead if the content shouldn't exist
 * in the DOM at all while collapsed.
 */
export default function Disclosure({ open, className, children }: DisclosureProps) {
  const cls = ['mo-disclosure', open ? 'is-open' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  );
}
