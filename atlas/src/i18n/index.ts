/**
 * Meridian's UI translation layer — the `t()` for the app's own chrome.
 *
 * Journal CONTENT was never the problem: Bengali fonts and Bengali dictation
 * already ship, and you can always write in any script. What this module
 * translates is Meridian talking to you — tabs, buttons, placeholders, empty
 * states.
 *
 * Three decisions worth knowing:
 *
 *   1. `translate` is PURE. It reads its locale from its argument, never from the
 *      store, the DOM or localStorage. That makes the whole catalogue testable
 *      without a React tree, and it lets non-React code (exports, print output,
 *      notifications) translate for an explicit locale rather than "whatever the
 *      user happens to have set". `useT` is the only store-aware thing here.
 *
 *   2. Fallback is per KEY, not per locale. A key missing from `bn` resolves to
 *      the English string — never to a blank and never to the raw key. Bengali
 *      coverage will be incomplete for a while, and a screen with a few English
 *      labels still works; a screen of `editor.placeholder` does not. The key
 *      itself is the last resort, for a key that exists in neither catalogue
 *      (impossible through the type, reachable through persisted/synced data).
 *
 *   3. Interpolation is a single pass. `{name}` is substituted once, so a value
 *      that itself contains braces (a trip called "Alps {2026}", a place name
 *      from a geocoder) can never trigger a second round of substitution. An
 *      unsupplied placeholder is left visible as `{name}` rather than becoming
 *      the string "undefined" — a gap you can see and diagnose beats a gap that
 *      reads like a bug in someone else's code.
 *
 * There is deliberately no locale auto-detection: `language` is an explicit
 * setting (see `store/settings.ts`), because guessing from `navigator.language`
 * would flip the whole UI to Bengali for anyone with a Bengali keyboard layout.
 */
import { useCallback } from 'react';
import { useSettings } from '../store/settings';
import { en } from './en';
import { bn } from './bn';

export type Locale = 'en' | 'bn';

/** Keys are derived from the English catalogue so a typo is a compile error. */
export type TranslationKey = keyof typeof en;

export type TranslationVars = Record<string, string | number>;

/** `label` is the language's name in itself — the only form worth showing in a
 *  language picker. `englishLabel` is for anything that must stay legible to
 *  someone who can't read the script (support, bug reports, the settings hint). */
export const LOCALES: Array<{ id: Locale; label: string; englishLabel: string }> = [
  { id: 'en', label: 'English', englishLabel: 'English' },
  { id: 'bn', label: 'বাংলা', englishLabel: 'Bengali' },
];

const CATALOGUES: Record<Locale, Partial<Record<TranslationKey, string>>> = { en, bn };

/**
 * BCP-47 tags for `Intl` date/number formatting. `bn-IN` rather than `bn-BD`:
 * Indian Bengali is the larger written variant and matches the app's default
 * dictation option, and the two agree on everything Meridian formats.
 */
const TAGS: Record<Locale, string> = { en: 'en-US', bn: 'bn-IN' };

/** The BCP-47 tag for the locale — for Intl date/number formatting. */
export function localeTag(locale: Locale): string {
  return TAGS[locale] || TAGS.en;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** One pass, so a substituted value containing `{…}` is never re-substituted. */
function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Translate a key for a locale, with {placeholder} interpolation. */
export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  // Optional access: `locale` is typed, but a persisted setting from an older or
  // newer build can hold anything, and an unknown locale should read as English
  // rather than throw.
  const value = CATALOGUES[locale]?.[key] || en[key] || key;
  return interpolate(value, vars);
}

/**
 * React hook returning a bound `t` for the user's current locale (reads the
 * `language` setting from useSettings). Must re-render on language change.
 */
export function useT(): (key: TranslationKey, vars?: TranslationVars) => string {
  const locale = useSettings((s) => s.language);
  return useCallback(
    (key: TranslationKey, vars?: TranslationVars) => translate(locale, key, vars),
    [locale],
  );
}
