import { useEffect, useState } from 'react';

const QUERY = '(min-width: 768px)';

function readIsTwoPane(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : true;
}

/**
 * Live "is this the desktop two-pane layout" breakpoint (matches Tailwind's
 * `md:` and `store/atlas.ts`'s own `isTwoPane()`, which only reads it once for
 * an initial value). Unlike a plain CSS `md:hidden` class, this actually stops
 * a component from being MOUNTED below the breakpoint — needed wherever a
 * component's own side effects (network requests, geolocation) shouldn't run
 * twice just because a desktop-only and a phone-only copy both sit in the DOM
 * at once, merely one of them hidden by CSS. See `WelcomeDashboard.tsx`'s two
 * mount sites (`WelcomeState.tsx` desktop, `Timeline.tsx` phone) for why this
 * hook exists rather than a `md:hidden` wrapper.
 */
export function useIsTwoPane(): boolean {
  const [isTwoPane, setIsTwoPane] = useState(readIsTwoPane);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsTwoPane(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isTwoPane;
}
