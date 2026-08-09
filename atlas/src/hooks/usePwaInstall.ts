import { useEffect, useState } from 'react';

/**
 * Drives the "Install app" affordance. Three things make installing Meridian as
 * a real home-screen app (not a browser shortcut) fiddly across phones:
 *
 *  - Chrome / older Samsung Internet fire `beforeinstallprompt`, which we can
 *    capture and replay from a button — the one-tap path.
 *  - Newer Samsung Internet (27.x+) dropped `beforeinstallprompt` and uses its
 *    own menu heuristic, so there's no event to catch; the user must pick
 *    "Add page to → Apps" from the browser menu. We detect this and show steps.
 *  - iOS Safari never had the event; it's always Share → "Add to Home Screen".
 *
 * The hook exposes a single `install()` that uses the captured prompt when we
 * have one, plus enough state for the UI to show the right manual instructions
 * when we don't.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'android-prompt' | 'samsung' | 'ios' | 'other';

/** True when the app is already running as an installed/standalone PWA. */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS Safari exposes a non-standard `navigator.standalone` instead.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(displayMode || iosStandalone);
}

function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  return 'other';
}

export interface PwaInstall {
  /** Already installed / running standalone — hide the prompt entirely. */
  installed: boolean;
  /** A captured `beforeinstallprompt` is ready — one-tap install is possible. */
  canPrompt: boolean;
  /** Which manual flow to describe when one-tap isn't available. */
  platform: InstallPlatform;
  /** Fire the captured prompt. Resolves to the user's choice, or null if none. */
  install: () => Promise<'accepted' | 'dismissed' | null>;
}

export function usePwaInstall(): PwaInstall {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(detectStandalone);
  const [platform] = useState<InstallPlatform>(detectPlatform);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Stop Chrome's mini-infobar; we surface our own button instead.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Re-check standalone if the user installs and the display-mode flips.
    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setInstalled(detectStandalone());
    mql?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mql?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const install = async (): Promise<'accepted' | 'dismissed' | null> => {
    if (!deferred) return null;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // A prompt can only be used once; drop it so the button reflects reality.
    setDeferred(null);
    return outcome;
  };

  return {
    installed,
    canPrompt: deferred !== null,
    platform: deferred !== null ? 'android-prompt' : platform,
    install,
  };
}
