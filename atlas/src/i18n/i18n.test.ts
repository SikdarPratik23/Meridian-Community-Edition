/**
 * Unit tests for the i18n foundation.
 *
 * Two things here are load-bearing beyond the obvious "does it look up a string".
 *
 * The FALLBACK: Bengali coverage will trail behind for a while, and the failure
 * mode of getting that wrong is invisible in review and glaring in the app — a
 * blank button, or a button reading `editor.save`. So the English fallback is
 * tested against the real catalogue with a key genuinely removed, not against a
 * fixture.
 *
 * The INTERPOLATION: values passed in are user data — trip names, place names
 * from a geocoder, imported titles. A value containing `{…}` must not trigger a
 * second substitution pass, and a placeholder nobody supplied must stay visible
 * rather than turn into the word "undefined". Both are tested explicitly.
 *
 * Keys missing from BOTH catalogues can't happen through the type, but they can
 * arrive through persisted or synced data written by a different build, which is
 * why `translate` falls back to the key itself and why that path is exercised
 * here through a deliberate cast.
 */
import { describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSettings } from '../store/settings'
import { en } from './en'
import { bn } from './bn'
import {
  LOCALES,
  localeTag,
  translate,
  useT,
  type Locale,
  type TranslationKey,
} from './index'

const enKeys = Object.keys(en) as TranslationKey[]
const bnKeys = Object.keys(bn) as TranslationKey[]

/**
 * Keys whose Bengali value contains no Bengali letters at all. Kept as an
 * explicit list so adding an untranslated string is a conscious act with a
 * reason, not a silently weakened assertion.
 *   - welcome.greetingWithName: pure structure (`{greeting}, {name}`) — both
 *     halves are themselves translated, and Bengali joins them the same way.
 *   - editor.linkUrl: the label of a URL field. "URL" is what the Bengali web
 *     writes, and there is no accepted Bengali expansion.
 */
const NO_BENGALI_LETTERS: TranslationKey[] = ['welcome.greetingWithName', 'editor.linkUrl']

/** Technical terms and product names left in Latin script INSIDE a Bengali
 *  string. Stripped before asserting the string is really Bengali. */
const LATIN_KEPT = /GeoJSON|Markdown|Meridian|JSON|GPS|GPX|PDF|GIS|URL|WiFi/g

const BENGALI = /[ঀ-৿]/

/** Placeholder names in a template, in order of appearance. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

describe('the catalogues', () => {
  test('English covers the whole UI, not a token slice of it', () => {
    expect(enKeys.length).toBeGreaterThan(120)
  })

  test('every key is a dotted area.name', () => {
    for (const key of enKeys) {
      expect(key, key).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
    }
  })

  test('every key belongs to a known area', () => {
    const areas = new Set(enKeys.map((k) => k.split('.')[0]))
    expect([...areas].sort()).toEqual([
      'capture', 'common', 'confirm', 'data', 'day', 'editor', 'empty', 'error',
      'nav', 'reader', 'search', 'settings', 'timeline', 'trips', 'welcome',
    ])
  })

  test('no English value is empty or whitespace-only', () => {
    for (const key of enKeys) {
      expect(en[key].trim(), key).not.toBe('')
    }
  })

  test('no Bengali value is empty or whitespace-only', () => {
    for (const key of bnKeys) {
      expect((bn[key] ?? '').trim(), key).not.toBe('')
    }
  })

  test('no value is padded with stray whitespace', () => {
    for (const key of enKeys) expect(en[key], key).toBe(en[key].trim())
    for (const key of bnKeys) expect(bn[key], key).toBe(bn[key]?.trim())
  })

  test('no value carries an emoji — components own their glyphs', () => {
    for (const key of enKeys) {
      expect(en[key], key).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })

  test('the search filter chips all have keys', () => {
    // These arrived with the filter bar; they are the newest strings in the app
    // and the easiest to forget when the chips are wired up.
    for (const key of [
      'search.hasPhoto', 'search.hasAudio', 'search.hasLocation', 'search.mood',
      'search.trip', 'search.dateFrom', 'search.dateTo', 'search.nearMe',
      'search.clearAll', 'search.nFilters',
    ] as TranslationKey[]) {
      expect(enKeys, key).toContain(key)
    }
  })
})

describe('key parity', () => {
  test('Bengali has every English key', () => {
    const missing = enKeys.filter((k) => bn[k] === undefined)
    expect(missing).toEqual([])
  })

  test('Bengali has no key English does not', () => {
    const extra = bnKeys.filter((k) => en[k] === undefined)
    expect(extra).toEqual([])
  })

  test('every Bengali value is actually in Bengali script', () => {
    const notBengali = bnKeys.filter((k) => !BENGALI.test((bn[k] ?? '').replace(LATIN_KEPT, '')))
    expect(notBengali.sort()).toEqual([...NO_BENGALI_LETTERS].sort())
  })

  test('the script-free keys are the untranslated ones, matching English exactly', () => {
    for (const key of NO_BENGALI_LETTERS) {
      expect(bn[key], key).toBe(en[key])
    }
  })

  test('a Bengali value keeping a technical term in Latin still reads as Bengali', () => {
    // e.g. "GeoJSON রপ্তানি" — the format name stays recognisable, the verb doesn't.
    expect(bn['data.exportGeoJSON']).toContain('GeoJSON')
    expect(BENGALI.test(bn['data.exportGeoJSON'] ?? '')).toBe(true)
  })

  test('Bengali keeps the same placeholders as English', () => {
    // Word order may differ freely; the SET of placeholders may not, or a
    // translated string silently drops the value it was meant to show.
    for (const key of bnKeys) {
      expect([...placeholders(bn[key] ?? '')].sort(), key).toEqual([...placeholders(en[key])].sort())
    }
  })
})

describe('LOCALES', () => {
  test('lists English and Bengali, in that order', () => {
    expect(LOCALES.map((l) => l.id)).toEqual(['en', 'bn'])
  })

  test('every entry has both a native and an English label', () => {
    for (const locale of LOCALES) {
      expect(locale.label.length).toBeGreaterThan(0)
      expect(locale.englishLabel.length).toBeGreaterThan(0)
    }
  })

  test('the Bengali label is written in Bengali', () => {
    const entry = LOCALES.find((l) => l.id === 'bn')
    expect(entry?.label).toBe('বাংলা')
    expect(entry?.englishLabel).toBe('Bengali')
  })

  test('ids are unique', () => {
    expect(new Set(LOCALES.map((l) => l.id)).size).toBe(LOCALES.length)
  })
})

describe('localeTag', () => {
  test('English is en-US', () => {
    expect(localeTag('en')).toBe('en-US')
  })

  test('Bengali is bn-IN', () => {
    expect(localeTag('bn')).toBe('bn-IN')
  })

  test('every locale has a well-formed BCP-47 tag', () => {
    for (const locale of LOCALES) {
      expect(localeTag(locale.id), locale.id).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  test('an unknown locale falls back to English', () => {
    expect(localeTag('de' as Locale)).toBe('en-US')
  })

  test('the tag is usable by Intl', () => {
    // The point of the tag: Bengali dates in Bengali numerals.
    const formatted = new Intl.DateTimeFormat(localeTag('bn')).format(new Date('2026-08-05T12:00:00Z'))
    expect(formatted.length).toBeGreaterThan(0)
  })
})

describe('translate', () => {
  test('returns the English string for en', () => {
    expect(translate('en', 'common.cancel')).toBe('Cancel')
    expect(translate('en', 'nav.timeline')).toBe('Timeline')
  })

  test('returns the Bengali string for bn', () => {
    expect(translate('bn', 'common.cancel')).toBe('বাতিল')
    expect(translate('bn', 'nav.timeline')).toBe('সময়রেখা')
  })

  test('never returns a blank string, for any key in any locale', () => {
    for (const locale of LOCALES) {
      for (const key of enKeys) {
        expect(translate(locale.id, key), `${locale.id}/${key}`).not.toBe('')
      }
    }
  })

  test('an unknown locale reads as English', () => {
    expect(translate('de' as Locale, 'common.save')).toBe('Save')
  })

  test('is pure — it does not read localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    translate('bn', 'editor.placeholder')
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  test('is pure — the language setting does not affect it', () => {
    act(() => useSettings.getState().update('language', 'bn'))
    expect(translate('en', 'common.save')).toBe('Save')
    act(() => useSettings.getState().update('language', 'en'))
  })
})

describe('the fallback chain', () => {
  test('a key missing from Bengali falls back to the English string', () => {
    const key: TranslationKey = 'timeline.emptyTitle'
    const saved = bn[key]
    delete bn[key]
    try {
      expect(translate('bn', key)).toBe(en[key])
    } finally {
      bn[key] = saved
    }
  })

  test('the English fallback still interpolates', () => {
    const key: TranslationKey = 'common.nEntries'
    const saved = bn[key]
    delete bn[key]
    try {
      expect(translate('bn', key, { count: 3 })).toBe('3 entries')
    } finally {
      bn[key] = saved
    }
  })

  test('a blank Bengali value falls back too, rather than showing nothing', () => {
    const key: TranslationKey = 'common.close'
    const saved = bn[key]
    bn[key] = ''
    try {
      expect(translate('bn', key)).toBe('Close')
    } finally {
      bn[key] = saved
    }
  })

  test('a key missing from BOTH returns the key itself, not an empty string', () => {
    // Unreachable through the type; reachable through data written by another build.
    const ghost = 'editor.doesNotExist' as TranslationKey
    expect(translate('en', ghost)).toBe('editor.doesNotExist')
    expect(translate('bn', ghost)).toBe('editor.doesNotExist')
  })
})

describe('interpolation', () => {
  test('substitutes a supplied placeholder', () => {
    expect(translate('en', 'welcome.since', { month: 'July 2026' })).toBe('since July 2026')
  })

  test('substitutes numbers', () => {
    expect(translate('en', 'common.nEntries', { count: 12 })).toBe('12 entries')
  })

  test('substitutes zero rather than treating it as missing', () => {
    expect(translate('en', 'common.nEntries', { count: 0 })).toBe('0 entries')
  })

  test('substitutes every placeholder in a multi-placeholder string', () => {
    expect(translate('en', 'welcome.greetingWithName', { greeting: 'Good morning', name: 'Pratik' }))
      .toBe('Good morning, Pratik')
  })

  test('substitutes into the Bengali string as readily as the English', () => {
    expect(translate('bn', 'common.nEntries', { count: 4 })).toBe('4টি লেখা')
  })

  test('leaves an unsupplied placeholder visible, never "undefined"', () => {
    const out = translate('en', 'welcome.greetingWithName', { greeting: 'Good morning' })
    expect(out).toBe('Good morning, {name}')
    expect(out).not.toContain('undefined')
  })

  test('leaves every placeholder alone when no vars are passed at all', () => {
    expect(translate('en', 'welcome.greetingWithName')).toBe('{greeting}, {name}')
  })

  test('ignores vars the string does not use', () => {
    expect(translate('en', 'common.nEntries', { count: 2, unused: 'x' })).toBe('2 entries')
  })

  test('substitutes a repeated placeholder everywhere it appears', () => {
    // Cast: this exercises the interpolator through the public API, using the
    // key-itself fallback as the template.
    const template = '{a} then {a} again' as TranslationKey
    expect(translate('en', template, { a: 'here' })).toBe('here then here again')
  })

  test('a value containing braces is NOT substituted a second time', () => {
    const template = 'Trip: {name}' as TranslationKey
    expect(translate('en', template, { name: '{a}', a: 'boom' })).toBe('Trip: {a}')
  })

  test('a value that looks like the whole template survives intact', () => {
    const template = '{a}' as TranslationKey
    expect(translate('en', template, { a: '{a}' })).toBe('{a}')
  })

  test('handles a value with regex-special characters', () => {
    expect(translate('en', 'search.noMatches', { query: '$1 (a|b) \\d' }))
      .toBe('Nothing found for “$1 (a|b) \\d”. Try a different word, place or tag.')
  })
})

describe('useT', () => {
  test('translates into English by default', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('nav.trips')).toBe('Trips')
  })

  test('translates into Bengali when the language setting is bn', () => {
    act(() => useSettings.getState().update('language', 'bn'))
    const { result } = renderHook(() => useT())
    expect(result.current('nav.trips')).toBe('ভ্রমণ')
    act(() => useSettings.getState().update('language', 'en'))
  })

  test('re-renders and re-binds when the language changes', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('common.save')).toBe('Save')
    act(() => useSettings.getState().update('language', 'bn'))
    expect(result.current('common.save')).toBe('সংরক্ষণ')
    act(() => useSettings.getState().update('language', 'en'))
    expect(result.current('common.save')).toBe('Save')
  })

  test('interpolates through the bound t', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('day.deleteAll', { count: 5 })).toBe('Delete all 5 entries')
  })

  test('keeps a stable identity across re-renders at the same language', () => {
    const { result, rerender } = renderHook(() => useT())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  test('falls back to English inside Bengali for a missing key', () => {
    const key: TranslationKey = 'trips.emptyTitle'
    const saved = bn[key]
    delete bn[key]
    act(() => useSettings.getState().update('language', 'bn'))
    try {
      const { result } = renderHook(() => useT())
      expect(result.current(key)).toBe(en[key])
    } finally {
      bn[key] = saved
      act(() => useSettings.getState().update('language', 'en'))
    }
  })
})
