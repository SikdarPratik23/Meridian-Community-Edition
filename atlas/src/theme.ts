import type { ThemeMode } from './store/settings';

/** Page background per mode — mirrors --color-parchment in index.css. Kept here
 *  so the JS that sets <html> background / the PWA theme-color stays in sync with
 *  the CSS, and matches the anti-flash snippet in index.html. */
export const THEME_BG: Record<'light' | 'dark', string> = {
  light: '#FDFBF7',
  dark: '#14181E',
};

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** Resolve the chosen mode to an actual light/dark, honouring the OS for 'system'. */
export function resolveDark(theme: ThemeMode): boolean {
  return theme === 'dark' || (theme === 'system' && prefersDark());
}

/** Apply the theme to the document: toggle `.dark`, set color-scheme (native
 *  controls/scrollbars), the html background, and the PWA status-bar colour. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const dark = resolveDark(theme);
  const bg = dark ? THEME_BG.dark : THEME_BG.light;
  const de = document.documentElement;
  de.classList.toggle('dark', dark);
  de.style.colorScheme = dark ? 'dark' : 'light';
  de.style.backgroundColor = bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}
