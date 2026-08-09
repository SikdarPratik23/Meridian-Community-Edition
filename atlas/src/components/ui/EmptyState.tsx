import type { ReactNode } from 'react';

/**
 * A calm, premium "nothing here yet" panel — a soft illustrated glyph, a title,
 * a supporting line, and an optional call to action. Used wherever a list can be
 * empty (the timeline before the first entry, a search with no matches) so those
 * moments feel intentional and inviting rather than blank.
 *
 * Purely presentational: the caller supplies the glyph, copy and any action. The
 * glyph floats gently (frozen under reduced motion via `.animate-floaty`), and
 * the whole panel eases in.
 */
export default function EmptyState({
  glyph,
  title,
  message,
  action,
}: {
  glyph: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="animate-floaty mb-4 text-terracotta/70" aria-hidden="true">
        {glyph}
      </div>
      <p className="font-serif text-base text-ink/70">{title}</p>
      {message && <p className="mt-1.5 max-w-[15rem] text-[13px] leading-relaxed text-ink/45">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A softly drawn open-map / compass glyph, in the current accent colour.
 *  `className` is how a caller opts into the slow drift (`.mo-glyph-drift`,
 *  M21) — plain by default, since not every use of this glyph is an empty
 *  state (kept optional rather than baked in). */
export function MapGlyph({ className }: { className?: string } = {}) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 18l16-6 16 6 16-6v34l-16 6-16-6-16 6V18z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path d="M24 12v34M40 18v34" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.35" />
      <circle cx="32" cy="30" r="5.5" stroke="currentColor" strokeWidth="2" />
      <path d="M32 35.5V44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A magnifier glyph for empty search results. Same `className` opt-in as `MapGlyph`. */
export function SearchGlyph({ className }: { className?: string } = {}) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true" className={className}>
      <circle cx="24" cy="24" r="14" stroke="currentColor" strokeWidth="2.4" opacity="0.6" />
      <path d="M34 34l12 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18 24a6 6 0 016-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
