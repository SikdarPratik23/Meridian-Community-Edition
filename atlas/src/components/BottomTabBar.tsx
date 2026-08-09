import { useAtlasStore, VIEW_LABELS, VIEW_ORDER, type View } from '../store/atlas';
import { useT } from '../i18n';
import { useSlidingIndicator } from '../hooks/useSlidingIndicator';

/** Reuses the app's own established icons where one already exists (🧭 already
 *  labels the "Trip" toggle in JournalEditor and is Meridian's own brand glyph,
 *  ⚙ already labels the settings button in Sidebar's header) — Home/Timeline/
 *  Data are picks of their own.
 *
 *  🔍 is deliberately NOT here any more (2026-08-08). It used to label the
 *  Search tab while ALSO labelling the command-palette button in the header
 *  directly above it — the same glyph twice, for what looked like the same job.
 *  Search now lives inside Explore, whose 🧭 says "look around" rather than
 *  "search", leaving exactly one magnifying glass in the phone UI: the palette. */
const TAB_ICONS: Record<View, string> = {
  home: '🏠',
  timeline: '📖',
  explore: '🧭',
  data: '🗃',
  settings: '⚙',
};

/**
 * The phone's only navigation (MOTION_PLAN.md Part II, P1) — replaces the
 * slide-over drawer + ☰ Meridian button entirely on phones. Desktop never
 * renders this; it keeps Sidebar's own in-column tab row.
 *
 * Tapping a tab always returns to that tab's list, even from inside a detail
 * view — see `navigateTab` in `store/atlas.ts`, which both switches the tab
 * and clears whatever's selected/composing/editing.
 */
export default function BottomTabBar() {
  const t = useT();
  const activeTab = useAtlasStore((s) => s.activeTab);
  const navigateTab = useAtlasStore((s) => s.navigateTab);

  const activeIndex = VIEW_ORDER.indexOf(activeTab);
  const { containerRef, activeRef, rect } = useSlidingIndicator<HTMLDivElement, HTMLButtonElement>([
    activeIndex,
    VIEW_ORDER.length,
  ]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={t('nav.tagline')}
      className="tabbar md:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-water bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {rect && activeIndex >= 0 && (
        <span
          className="tabbar-underline"
          style={{ '--tab-x': `${rect.x}px`, '--tab-w': `${rect.width}px` } as React.CSSProperties}
          aria-hidden="true"
        />
      )}
      {VIEW_ORDER.map((v) => (
        <button
          key={v}
          ref={v === activeTab ? activeRef : undefined}
          onClick={() => navigateTab(v)}
          role="tab"
          aria-selected={v === activeTab}
          className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] transition-colors ${
            v === activeTab ? 'text-terracotta' : 'text-ink/55'
          }`}
        >
          <span className="text-lg leading-none" aria-hidden="true">{TAB_ICONS[v]}</span>
          <span>{t(VIEW_LABELS[v])}</span>
        </button>
      ))}
    </div>
  );
}
