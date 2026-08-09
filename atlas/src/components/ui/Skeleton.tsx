/**
 * Loading placeholders.
 *
 * The welcome screen's cards each wait on a different network lookup (weather,
 * reverse geocoding, Wikipedia), so before this they popped in one at a time and
 * shifted everything below them. A skeleton reserves the space the real content
 * will occupy, which turns a sequence of jumps into a single settle.
 *
 * The rule these follow: a placeholder must be the same SHAPE as what replaces it.
 * A skeleton that's the wrong height is worse than none, because it moves the
 * layout twice instead of once.
 *
 * Placeholders are hidden from assistive technology (`aria-hidden`) and the
 * container carries `aria-busy`, so a screen reader announces "busy" rather than
 * reading out a pile of empty boxes.
 */

/** A single shimmering text line. `width` is any CSS length or percentage. */
export function SkeletonLine({ width = '100%', className = '' }: { width?: string; className?: string }) {
  return <div className={`skeleton-line ${className}`} style={{ width }} aria-hidden="true" />;
}

/** A shimmering rectangle, for thumbnails, maps and chart areas. */
export function SkeletonBlock({
  height = '4rem',
  width = '100%',
  className = '',
}: {
  height?: string;
  width?: string;
  className?: string;
}) {
  return <div className={`skeleton-block ${className}`} style={{ height, width }} aria-hidden="true" />;
}

/**
 * A paragraph of placeholder lines. The last line is deliberately short, which is
 * what makes a block of them read as text rather than as a stack of bars.
 */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </div>
  );
}

/**
 * The placeholder for a welcome card: a short heading line, a couple of body
 * lines, and optionally a thumbnail block on the right (matching the layout of
 * the "places of interest" and "today's focus" cards, which carry a Wikipedia
 * image).
 */
export function SkeletonCard({
  lines = 2,
  thumbnail = false,
  className = '',
}: {
  lines?: number;
  thumbnail?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-busy="true">
      <SkeletonLine width="38%" />
      <div className="flex gap-3">
        {thumbnail && <SkeletonBlock height="3.5rem" width="3.5rem" className="shrink-0" />}
        <div className="min-w-0 flex-1 space-y-2">
          {Array.from({ length: lines }, (_, i) => (
            <SkeletonLine key={i} width={i === lines - 1 ? '70%' : '100%'} />
          ))}
        </div>
      </div>
    </div>
  );
}
