import { useAtlasStore, VIEW_LABELS, type View } from '../../store/atlas';
import TimelineView from '../../features/timeline/Timeline';
import ExploreView from '../../features/explore/ExploreView';
import DataView from '../../features/data/DataView';
import SettingsView from '../../features/settings/SettingsView';
import SyncButton from '../../features/data/SyncButton';
import WelcomeDashboard from '../WelcomeDashboard';
import { useT } from '../../i18n';
import { useIsTwoPane } from '../../hooks/useIsTwoPane';
import { useSlidingIndicator } from '../../hooks/useSlidingIndicator';

function renderPane(v: View) {
  switch (v) {
    // Phone only — `Sidebar` maps `home` to `timeline` on desktop before this
    // is ever called (see `view` below), because desktop's welcome screen is
    // MainPane's own `WelcomeState` and mounting a second `WelcomeDashboard`
    // would re-run its geolocation/weather/place-name effects.
    case 'home': return <div className="h-full overflow-y-auto"><WelcomeDashboard /></div>;
    case 'timeline': return <TimelineView />;
    case 'explore': return <ExploreView />;
    case 'data': return <DataView />;
    case 'settings': return <SettingsView />;
  }
}

export default function Sidebar() {
  const t = useT();
  const toggleSidebar = useAtlasStore((s) => s.toggleSidebar);
  const startComposing = useAtlasStore((s) => s.startComposing);
  const composing = useAtlasStore((s) => s.composing);

  // Which list is showing, plus the M12 slide bookkeeping, now live in the store
  // (`store/atlas.ts`) since the phone bottom tab bar (P1) is a sibling component
  // that needs to drive the same state. `setActiveTab` is the desktop-only path:
  // it has no side effects on the main pane's selection, unlike the tab bar's own
  // `navigateTab`, because desktop shows the list and the main pane at once.
  const storedView = useAtlasStore((s) => s.activeTab);
  const storedPrevView = useAtlasStore((s) => s.prevTab);
  const direction = useAtlasStore((s) => s.tabDirection);
  const setActiveTab = useAtlasStore((s) => s.setActiveTab);
  const isTwoPane = useIsTwoPane();

  // `home` is a phone-only destination: on desktop the welcome dashboard is
  // already on screen as MainPane's own `WelcomeState`, so a Home tab in this
  // column would be a second live copy of it (and a second run of its
  // geolocation/weather effects — the hazard `useIsTwoPane` exists for). The
  // only way to be on `home` at desktop width is to have resized a phone-width
  // window, so it simply reads as Timeline here rather than needing an effect
  // to rewrite the store.
  const desktopSafe = (v: View): View => (isTwoPane && v === 'home' ? 'timeline' : v);
  const view = desktopSafe(storedView);
  // …and if collapsing `home` onto `timeline` made the outgoing and incoming
  // panes identical, there is no transition left to draw.
  const mappedPrev = storedPrevView && desktopSafe(storedPrevView);
  const prevView = mappedPrev === view ? null : mappedPrev;

  // Timeline / Explore / Data are the content tabs (the "list" the Meridian
  // button opens). Two views are deliberately NOT here: `settings`, a
  // destination of a different kind (app preferences, not journal content),
  // which lives as its own gear button in the header's top-right; and `home`,
  // which is phone-only for the reason above. (The phone bottom tab bar treats
  // all five as equal peers instead — see `BottomTabBar.tsx`.)
  const tabs: View[] = ['timeline', 'explore', 'data'];
  // Gear toggles Settings on/off, returning to the timeline when you leave it.
  const toggleSettings = () => setActiveTab(view === 'settings' ? 'timeline' : 'settings');

  // M12: the travelling underline. Measures against the tab row's own fixed-width
  // content, which is unaffected by the desktop sidebar's width:0-when-collapsed
  // trick (App.tsx) — the CHILDREN keep their full 340px bounding boxes even
  // while the ancestor is visually collapsed (a documented, deliberate quirk), so
  // there's nothing here that needs to gate measurement on "is the drawer open".
  const activeTabIndex = tabs.indexOf(view);
  const { containerRef, activeRef, rect } = useSlidingIndicator<HTMLDivElement, HTMLButtonElement>([
    activeTabIndex,
    tabs.length,
  ]);

  return (
    <div
      className="panel-frost sidebar-frost w-full md:w-[340px] h-full border-r border-water flex flex-col relative z-10 shrink-0"
      style={{ paddingBottom: 'var(--tabbar-clear)' }}
    >
      {/* Header */}
      <div className="safe-pt px-3.5 pt-3 pb-3 border-b border-water">
        <div className="flex items-center justify-between mb-2.5">
          <div className="select-none cursor-default">
            <h1 className="font-serif text-xl font-bold tracking-tight leading-none text-ink">Meridian</h1>
            <p className="text-[10px] text-ink/40 mt-1 tracking-wider uppercase font-sans font-medium">{t('nav.tagline')}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="hidden md:inline-flex">
              <SyncButton />
            </div>
            {/* Settings gear + column-collapse are desktop-only chrome now — on a
                phone, Settings is its own tab and there's no drawer left to hide
                (BottomTabBar.tsx is the only mobile navigation, P1). */}
            <button
              onClick={toggleSettings}
              className={`hidden md:inline-flex btn btn-sm btn-icon ${view === 'settings' ? 'btn-active' : 'btn-secondary'}`}
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
              aria-pressed={view === 'settings'}
            >
              <span className="text-base leading-none">⚙</span>
            </button>
            <button
              onClick={toggleSidebar}
              className="hidden md:inline-flex btn btn-secondary btn-sm btn-icon"
              title={t('nav.hide')}
              aria-label={t('nav.hide')}
            >
              <span className="text-sm leading-none font-bold">⇤</span>
            </button>
          </div>
        </div>

        {/* New entry — DESKTOP ONLY (2026-08-08). */}
        <div className="hidden md:block mb-2.5">
          <button
            onClick={() => startComposing('journal')}
            className={`btn btn-primary btn-block py-2 text-sm font-semibold shadow-sm ${composing === 'journal' ? 'ring-2 ring-terracotta ring-offset-1' : ''}`}
          >
            ＋ {t('nav.newEntry')}
          </button>
        </div>

        {/* View tabs — desktop only; a phone navigates via BottomTabBar.tsx instead. */}
        <div ref={containerRef} className="hidden md:relative md:flex gap-1 mb-0.5">
          {rect && activeTabIndex >= 0 && (
            <span
              className="sidebar-tab-underline"
              style={{ '--tab-x': `${rect.x}px`, '--tab-w': `${rect.width}px` } as React.CSSProperties}
              aria-hidden="true"
            />
          )}
          {tabs.map((v) => (
            <button
              key={v}
              ref={v === view ? activeRef : undefined}
              onClick={() => setActiveTab(v)}
              className={`btn btn-sm flex-1 capitalize text-xs ${view === v ? 'btn-active' : 'btn-secondary'}`}
            >
              {t(VIEW_LABELS[v])}
            </button>
          ))}
        </div>
      </div>

      {/* Body — the navigable list of entries. M12: while `prevView` is set, the
          outgoing pane keeps rendering (absolutely positioned) sliding out in
          `direction` while the incoming one slides in over it, so the container
          never collapses mid-transition; once the transition timer elapses only
          the current view remains, same as before this wave. */}
      <div className="flex-1 overflow-hidden relative">
        {prevView && (
          <div className={`absolute inset-0 ${direction === 'forward' ? 'sidebar-pane-out-fwd' : 'sidebar-pane-out-back'}`}>
            {renderPane(prevView)}
          </div>
        )}
        <div className={prevView ? `absolute inset-0 ${direction === 'forward' ? 'sidebar-pane-in-fwd' : 'sidebar-pane-in-back'}` : 'h-full'}>
          {renderPane(view)}
        </div>
      </div>
    </div>
  );
}

