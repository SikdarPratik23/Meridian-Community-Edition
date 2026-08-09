import { lazy, Suspense, useEffect, useState } from 'react';
import { useAtlasStore } from './store/atlas';
import { initDb, getAllEvents, replaceDbFromBytes } from './data/db';
import { initFileLink, reconnect, readLinkedBytes, useFileLink } from './data/fileLink';
import { initSyncLink, getAutoSync, startAutoSync, getActiveTransport, runSync } from './data/sync';
import { initHttpSync, hasHttpConfig } from './data/httpSync';
import { requestPersistentStorage } from './data/storage';
import { useSettings, FONT_SIZES } from './store/settings';
import { applyTheme } from './theme';
import { effectiveMotion, stagger } from './utils/motion';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useGlobalRipple } from './hooks/useRipple';
import { useWeatherBg } from './hooks/useWeatherBg';
import { useSwipeBack } from './hooks/useSwipeBack';
import { useNearbyPois } from './features/welcome/useNearbyPois';
import Sidebar from './components/sidebar/Sidebar';
import BottomTabBar from './components/BottomTabBar';
import CaptureFab from './components/ui/CaptureFab';
import MainPane from './components/MainPane';
import AmbientBackground from './components/AmbientBackground';
import ToastHost from './components/ui/ToastHost';
import Presence from './components/ui/Presence';
import Disclosure from './components/ui/Disclosure';

// Lazy: the introduction is shown once per install and never again, so its code
// has no business in the main bundle every other launch pays for.
const Onboarding = lazy(() => import('./features/onboarding/Onboarding'));
// Lazy for the same reason: the palette is opened deliberately, so it need not be
// in the bundle that decides how fast the welcome screen paints.
const CommandPalette = lazy(() => import('./features/command/CommandPalette'));

/** Discrete awaited boot steps: initDb, the file-link check, initSyncLink,
 *  initHttpSync — the compass's progress ring fills as each really completes. */
const BOOT_STEPS = 4;
/** Beat 2: how long after the handoff begins the loader starts dissolving —
 *  long enough for the needle's settle to read before the fade starts. */
const DISSOLVE_DELAY_MS = 150;
/** Beat 2 continued: the dissolve's own duration. Total added time from ready
 *  to the loader being gone is DISSOLVE_DELAY_MS + DISSOLVE_MS — comfortably
 *  under the ≤450ms budget for the Balanced motion level (index.css scales
 *  both by --mo-dur, so Reduced/Off finish proportionally sooner). */
const DISSOLVE_MS = 250;

export default function App() {
  useSwipeBack();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootProgress, setBootProgress] = useState(0);
  // True the instant `ready` flips — starts the needle-settle + dissolve. The
  // loader stays mounted a little longer than `ready` itself so the two beats
  // (settle, dissolve) have time to play before it's actually removed.
  const [handoff, setHandoff] = useState(false);
  const [showLoaderOverlay, setShowLoaderOverlay] = useState(true);
  const setEvents = useAtlasStore((s) => s.setEvents);
  const sidebarOpen = useAtlasStore((s) => s.sidebarOpen);
  const toggleSidebar = useAtlasStore((s) => s.toggleSidebar);
  const composing = useAtlasStore((s) => s.composing);
  const activeTab = useAtlasStore((s) => s.activeTab);
  const editing = useAtlasStore((s) => s.editing);
  const selectedEvent = useAtlasStore((s) => s.selectedEvent);
  const selectedDay = useAtlasStore((s) => s.selectedDay);
  const selectedTrip = useAtlasStore((s) => s.selectedTrip);
  const yearReviewOpen = useAtlasStore((s) => s.yearReviewOpen);
  const mapExpanded = useAtlasStore((s) => s.mapExpanded);
  const setMapExpanded = useAtlasStore((s) => s.setMapExpanded);
  const needsReconnect = useFileLink((s) => s.needsReconnect);
  const linkedFileName = useFileLink((s) => s.fileName);
  const theme = useSettings((s) => s.theme);
  const cardOpacity = useSettings((s) => s.cardOpacity);
  const fontSize = useSettings((s) => s.fontSize);
  const motionSetting = useSettings((s) => s.motion);
  const prefersReducedMotion = useReducedMotion();
  const onboarded = useSettings((s) => s.onboarded);
  const paletteOpen = useAtlasStore((s) => s.paletteOpen);
  const setPaletteOpen = useAtlasStore((s) => s.setPaletteOpen);
  const wxClass = useWeatherBg();

  // Keep the nearby places-of-interest published to the store from the app root,
  // so the map's pins never depend on the welcome POI card being on screen.
  useNearbyPois();

  // Press-point ripple for every .btn/.fmt-btn in the app — one delegated
  // listener rather than touching each of the many call sites (see the hook's
  // own doc comment).
  useGlobalRipple();

  /**
   * ⌘K / Ctrl+K toggles the command palette.
   *
   * Registered on the window rather than a component so it works wherever focus
   * is. It deliberately does NOT fire while the user is typing in a field — the
   * editor is a text surface and stealing the keystroke there would be hostile —
   * except that it still closes the palette's own input, which is how a toggle
   * should behave. `preventDefault` stops Firefox's quick-find on Ctrl+K.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      const insidePalette = !!target?.closest('.palette-panel');
      if (typing && !insidePalette) return;
      e.preventDefault();
      setPaletteOpen(!useAtlasStore.getState().paletteOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPaletteOpen]);

  // Apply the chosen theme to <html>; when following the OS, react to its changes.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // The Motion setting folded with the live OS preference — every animation in
  // the app reads this off <html> via the --mo-* tokens (index.css), so this is
  // the one place that decides how much the interface moves.
  useEffect(() => {
    document.documentElement.dataset.motion = effectiveMotion(motionSetting, prefersReducedMotion);
  }, [motionSetting, prefersReducedMotion]);

  // The loading → app handoff (MOTION_PLAN.md M1): once boot finishes, the
  // needle eases to true north and the loader dissolves a beat later, revealing
  // the shell already staggering in underneath (the entrance + stagger() on the
  // sidebar/main-pane wrappers below — `mo-fade-in-plain` on the sidebar, whose
  // own transform is load-bearing, `animate-fade-in-up` on the main pane, whose
  // isn't) — rather than the instant swap this used to be. The two beats are
  // timed in index.css (`.loader-needle-settle`, `.loader-dissolve`); this just
  // decides when the loader leaves the DOM once they've had time to play.
  useEffect(() => {
    if (!ready) return;
    // Synchronizing local handoff state with `ready` becoming true.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHandoff(true);
    const removeTimer = window.setTimeout(
      () => setShowLoaderOverlay(false),
      DISSOLVE_DELAY_MS + DISSOLVE_MS,
    );
    return () => window.clearTimeout(removeTimer);
  }, [ready]);

  // One opacity knob (the "Card & panel opacity" setting) drives every frosted
  // surface — welcome cards, the sidebar, reading panels, insight cards — via a
  // single CSS variable on the root, so they all bleed the background by the
  // same amount.
  useEffect(() => {
    document.documentElement.style.setProperty('--card-alpha', String(cardOpacity));
  }, [cardOpacity]);

  // App-wide text size. Everything sized in rem/em scales off the <html> root
  // font-size, so this one property adjusts text throughout the UI (including the
  // journal reading text). 16px is the browser default (medium).
  useEffect(() => {
    document.documentElement.style.fontSize = `${FONT_SIZES[fontSize].px}px`;
  }, [fontSize]);

  const handleReconnect = async () => {
    const ok = await reconnect();
    if (!ok) return;
    try {
      const bytes = await readLinkedBytes();
      if (bytes && bytes.length) {
        replaceDbFromBytes(bytes);
        setEvents(getAllEvents());
      }
    } catch (e) {
      console.warn('Reconnected file could not be loaded; keeping local data.', e);
    }
  };

  useEffect(() => {
    let disposed = false;

    // The compass's progress ring (see `.loader-fill` in index.css) fills from
    // real boot work rather than looping forever — one step per awaited stage
    // below. `setBootProgress` has a stable identity, so this closure staying
    // fixed to the mount-time render (the effect below has an empty dep array)
    // is not a staleness risk.
    const advanceBoot = () => setBootProgress((p) => Math.min(1, p + 1 / BOOT_STEPS));

    /**
     * Make sure sync is connected and running. On a phone the PWA often launches
     * before WiFi/the route to the PC's sync server is ready, so the one-shot
     * connect at boot can miss — leaving you to tap Sync manually. Re-running this
     * whenever the app regains focus / comes back online (and on a short boot
     * retry) reconnects automatically and pulls anything waiting. It also covers
     * mobile OSes suspending the background poll timer while the app is hidden.
     * No-op when auto-sync is off or there's nothing configured to connect to.
     */
    const ensureSync = async () => {
      if (disposed) return;
      try {
        if (!getActiveTransport().isReady() && hasHttpConfig()) {
          await initHttpSync();
        }
        if (getAutoSync() && getActiveTransport().isReady()) {
          startAutoSync();   // idempotent — won't double the poll loop
          void runSync();    // force a pass now (suspended timer / cold-boot miss)
        }
      } catch {
        // Network/server not ready this moment — a later focus/online retries.
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void ensureSync(); };

    // Keep retrying every 30s so a phone that boots before the network is
    // ready will still connect once WiFi arrives. Self-cancels once connected.
    const reconnectTimer = window.setInterval(() => {
      if (disposed || (getActiveTransport().isReady() && getAutoSync())) {
        clearInterval(reconnectTimer);
        return;
      }
      void ensureSync();
    }, 30000);

    (async () => {
      try {
        // Ask the browser to keep our data durable (not evicted under disk
        // pressure). Best-effort and non-blocking — never gates startup.
        void requestPersistentStorage();
        await initDb();
        advanceBoot();
        setEvents(getAllEvents());
        // If a file on disk is linked and still permitted, it's the source of
        // truth — load it over the IndexedDB copy. Otherwise a one-click
        // reconnect banner will offer to re-grant access. A bad/corrupt linked
        // file is caught here so it can never brick startup — we just keep the
        // local database and carry on.
        try {
          const handle = await initFileLink();
          if (handle && useFileLink.getState().permitted) {
            const bytes = await readLinkedBytes();
            if (bytes && bytes.length) {
              replaceDbFromBytes(bytes);
              setEvents(getAllEvents());
            }
          }
        } catch (e) {
          console.warn('Linked file could not be loaded; using the local database.', e);
        }
        advanceBoot();
        // Recall a remembered sync file too (a one-click reconnect surfaces in
        // the Data tab if file permission lapsed).
        await initSyncLink();
        advanceBoot();
        // Silently reconnect the local sync server if one was set up before — no
        // gesture needed — then resume auto-sync so the device stays in step the
        // whole session (and across leaving the Data tab). Honours the saved
        // auto-sync preference (default on).
        await initHttpSync();
        advanceBoot();
        if (getAutoSync() && getActiveTransport().isReady()) startAutoSync();
        setReady(true);
        // If the first connect missed (e.g. phone launched before WiFi was up),
        // retry a couple of times shortly after — no tap needed.
        if (!getActiveTransport().isReady() && hasHttpConfig()) {
          window.setTimeout(() => void ensureSync(), 4000);
          window.setTimeout(() => void ensureSync(), 12000);
        }
      } catch (err) {
        console.error('Failed to init DB:', err);
        setError('Failed to initialize database. See console for details.');
      }
    })();

    // Reconnect + pull whenever the app regains focus or the network returns.
    window.addEventListener('focus', ensureSync);
    window.addEventListener('online', ensureSync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      clearInterval(reconnectTimer);
      window.removeEventListener('focus', ensureSync);
      window.removeEventListener('online', ensureSync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-dvh bg-parchment text-ink">
        <div className="text-center space-y-2">
          <div className="text-2xl">🗺️</div>
          <div className="font-serif text-lg">Meridian</div>
          <div className="text-sm text-red-500">{error}</div>
        </div>
      </div>
    );
  }

  // Loader circumference (r=38 → 2πr ≈ 238.76), matching `.loader-fill`'s
  // stroke-dasharray in index.css — a real progress ring rather than an
  // endless spin, filling as the boot steps above actually complete.
  const LOADER_CIRCUMFERENCE = 238.76;

  // Phone UI redraft (MOTION_PLAN.md Part II, P1): a phone shows exactly one of
  // {the active tab's list, a detail/compose view} at a time, and — since the
  // drawer is gone — which one is showing is fully DERIVED from what's
  // selected, rather than a separately toggled flag. Desktop is unaffected: it
  // shows Sidebar and MainPane side by side regardless of this. `mapExpanded`
  // is included because the mobile Map FAB and the full-screen map both live
  // inside MainPane — without it, expanding the map from the Timeline tab
  // would have no visible effect (MainPane would still be CSS-hidden).
  const mobileDetailOpen = !!(
    selectedEvent || selectedDay || selectedTrip || composing || editing || yearReviewOpen || mapExpanded
  );

  // Both phone FABs float above the bottom-right/bottom-left of whatever the
  // active tab is showing — which is fine over a scrolling list, and wrong over
  // Settings and Data, whose own trailing controls ("Save settings", the export
  // buttons) live in exactly that strip and were sitting UNDER them. Neither
  // "write an entry" nor "open the map" belongs on those two tabs anyway, so
  // they simply don't appear there. (Reported 2026-08-08.)
  const fabTabsAllowed = activeTab !== 'settings' && activeTab !== 'data';

  return (
    <>
      {ready && (
        <div className={`relative flex h-dvh w-screen overflow-hidden ${wxClass || 'bg-parchment'}`}>
          {/* One animated weather backdrop behind every panel — the sidebar and main
              pane sit transparently over it, so the scene spills across both. */}
          <AmbientBackground />

      {/* First run only. Rendered over the finished app rather than instead of it,
          so the backdrop is already alive behind the introduction. Existing
          installs are migrated to `onboarded: true` in the settings loader, so an
          established user never sees this. */}
      <Presence when={!onboarded} exitMs={160} exitClassName="mo-fade-out-plain">
        <Suspense fallback={null}>
          <Onboarding />
        </Suspense>
      </Presence>

      {/* Opened with ⌘K / Ctrl+K on a keyboard, or the 🔍 button in the sidebar
          header on a phone. Not rendered while onboarding is up. */}
      {onboarded && paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}

      {/* Transient notifications + the Undo affordance for a delete. */}
      <ToastHost />

      <Disclosure open={needsReconnect} className="absolute top-0 inset-x-0 z-[60]">
        <div className="flex items-center justify-center gap-3 px-4 pb-2 safe-pt bg-terracotta text-white text-sm shadow">
          <span>📁 Your journal file{linkedFileName ? ` (${linkedFileName})` : ''} isn't connected this session.</span>
          <button
            onClick={handleReconnect}
            className="px-2.5 py-1 rounded bg-surface/20 hover:bg-surface/30 font-medium transition-colors"
          >
            Reconnect
          </button>
        </div>
      </Disclosure>

      {/* List / navigation. Desktop: an in-flow column that collapses its width
          when hidden (unchanged by P1 — "Hide the list" still works exactly as
          before). Phone: no more drawer/scrim at all — BottomTabBar.tsx is the
          only navigation, and this element is simply shown or hidden (a plain
          `hidden`/`flex` swap, no transform, no animation) depending on
          `mobileDetailOpen`. Always mounted on both breakpoints so state
          (scroll position, in-progress search text, the map's WebGL context in
          MainPane) survives switching. */}
      <div
        className={`${mobileDetailOpen ? 'hidden' : 'flex'} md:flex h-full flex-col z-10 shrink-0 w-full md:static md:z-auto md:overflow-hidden md:transition-[width] md:duration-300 md:ease-out mo-fade-in-plain ${
          sidebarOpen ? 'md:w-[340px]' : 'md:w-0'
        }`}
        style={stagger(0)}
      >
        <Sidebar />
      </div>

      {/* Reading / writing surface — the mobile home, and the desktop main pane.
          Staggers in a beat after the sidebar, as the last part of the M1
          loading→app handoff (see index.css "Loading → app handoff"). On a
          phone this is hidden (not unmounted, for the same reason as above)
          whenever the tab bar's list is what's showing instead. */}
      <div
        className={`relative h-full min-w-0 flex-1 animate-fade-in-up ${mobileDetailOpen ? 'flex' : 'hidden'} md:flex flex-col`}
        style={stagger(1)}
      >
        {/* THE REAL FIX (found empirically, in a live browser, after the
            `mo-fade-in-plain` swap below turned out NOT to be enough — see the
            2026-08-08 Bug Fixes entry in PROJECT_MEMORY.md for the full story):
            `<Presence>` always wraps `children` in its OWN plain `<div>`. ANY
            `enterClassName`/`exitClassName` that carries an `animation` — even
            `mo-fade-in-plain`, which only touches `opacity`, not `transform` —
            makes THAT WRAPPER a stacking context: per spec, an element that is
            the target of an animation affecting `opacity` or `transform` is
            treated as establishing a stacking context FOR AS LONG AS THE
            ANIMATION APPLIES, and with `animation-fill-mode: both` the
            animation never really "ends" — it holds its final frame forever,
            so the wrapper is PERMANENTLY a stacking context, confirmed live:
            forcing `opacity`/`transform` back with an inline `!important`
            style does NOT undo this, because a running/filling animation
            outranks even `!important` in the cascade.
              Putting `position`/`z-index` on the BUTTON while the ANIMATION
            lives on Presence's SEPARATE wrapper splits the two: the wrapper
            (not the button) is what actually competes in the OUTER stacking
            order, and the wrapper has no `z-index` of its own (`auto`) — so it
            loses to whatever paints after it (`<MainPane/>`'s own content),
            trapping the button's `z-20` uselessly one level too deep. Verified
            in a real Chrome instance: a synthetic clone with the button's own
            classes but a PLAIN (unanimated) wrapper wins the hit-test; the
            same clone under the real `mo-fade-in-plain` wrapper loses it.
              The fix used correctly elsewhere in this file (MainPane.tsx's own
            Presence-wrapped map buttons/FAB) is to put `position` + `z-index`
            on Presence's OWN `className` — the SAME element that ends up
            hosting the animation — so there is only ONE element to reason
            about, and ITS z-index is what the outer comparison actually sees. */}
        {/* Desktop-only now (P1): a phone navigates entirely through
            BottomTabBar.tsx and never had a column to re-expand this way. */}
        <Presence
          when={!sidebarOpen && !composing && !editing && !selectedEvent && !selectedDay}
          exitMs={160}
          enterClassName="mo-fade-in-plain"
          exitClassName="mo-fade-out-plain"
          className="hidden md:block absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20"
        >
          <button
            onClick={toggleSidebar}
            className="px-3 py-1.5 bg-surface border border-water rounded shadow-sm text-sm hover:bg-land transition-colors"
          >
            ☰ Meridian
          </button>
        </Presence>

        <MainPane />
      </div>

      {/* Mobile-only "open the map" FAB — moved here from MainPane.tsx (P1):
          MainPane is CSS-hidden on a phone whenever the active tab's list is
          showing, so a trigger button living inside it would be exactly as
          unreachable as the map it opens. Visible in precisely that situation
          (`!mobileDetailOpen`); once tapped, `mapExpanded` flips MainPane back
          into view (see `mobileDetailOpen` above) showing the full-screen map. */}
      <Presence
        when={!mobileDetailOpen && fabTabsAllowed}
        exitMs={160}
        enterClassName="mo-rise-in"
        exitClassName="mo-fade-out"
        className="md:hidden absolute right-4 bottom-[calc(var(--tabbar-clear)+1rem)] z-30"
      >
        <button
          onClick={() => setMapExpanded(true)}
          aria-label="Open the map"
          className="flex items-center gap-1.5 rounded-full border border-water bg-surface px-4 py-2.5 text-sm shadow-md hover:bg-land"
        >
          🗺️ Map
        </button>
      </Presence>

      <CaptureFab />
      <BottomTabBar />

      {/* Mobile left-edge swipe back touch target zone */}
      <Presence
        when={mobileDetailOpen}
        exitMs={160}
        enterClassName="mo-fade-in-plain"
        exitClassName="mo-fade-out-plain"
        className="md:hidden fixed top-0 left-0 bottom-0 w-6 z-50 pointer-events-none"
      >
        <div aria-label="Swipe back edge" className="w-full h-full" />
      </Presence>
        </div>
      )}

      {showLoaderOverlay && (
        <div className={`loader-overlay flex items-center justify-center bg-parchment text-ink ${handoff ? 'loader-dissolve' : ''}`}>
          <div className="flex flex-col items-center gap-6 animate-fade-in-up">
            {/* A compass whose ring sweeps and needle gently seeks — a calmer,
                more crafted "loading" than a spinner, matched to the theme.
                Handoff (M1): once boot finishes, the needle eases to true
                north (.loader-needle-settle) and this whole overlay fades out
                a beat later (.loader-dissolve), revealing the shell above,
                which has been staggering in underneath the whole time. */}
            <div className="loader-compass" aria-hidden="true">
              <svg viewBox="0 0 88 88" width="84" height="84">
                <circle className="loader-ring" cx="44" cy="44" r="38" />
                <circle className="loader-arc" cx="44" cy="44" r="38" />
                <circle
                  className="loader-fill"
                  cx="44"
                  cy="44"
                  r="38"
                  style={{ strokeDashoffset: LOADER_CIRCUMFERENCE * (1 - bootProgress) }}
                />
                <g className={`loader-needle ${handoff ? 'loader-needle-settle' : ''}`}>
                  <polygon className="loader-needle-n" points="44,14 50,44 44,50 38,44" />
                  <polygon className="loader-needle-s" points="44,74 50,44 44,38 38,44" />
                </g>
                <circle className="loader-hub" cx="44" cy="44" r="3.4" />
              </svg>
            </div>
            <div className="text-center space-y-1">
              <div className="font-serif text-xl font-bold tracking-wide">Meridian</div>
              <div className="loader-tagline text-[13px] text-ink/45">Charting your journal…</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
