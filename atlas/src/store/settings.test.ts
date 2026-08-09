/**
 * Unit tests for the settings store.
 *
 * Settings are the app's only persisted preferences, and every one of them is read
 * by something on screen. Two behaviours carry real risk:
 *
 *  - **Forward compatibility.** A settings blob written by an older version is
 *    missing whatever keys were added since. Those must fill in from defaults, or
 *    a released update turns some control into `undefined` and breaks the screen
 *    that reads it.
 *  - **The `onboarded` migration.** It defaults to false so a fresh install sees
 *    the introduction, but an EXISTING install must be treated as already
 *    introduced — otherwise shipping the feature interrupts everyone who has been
 *    using the app for weeks.
 *
 * The store reads localStorage at module load, so these tests re-import it with a
 * fresh module registry (`vi.resetModules`) to exercise the loader.
 */
import { beforeEach, describe, expect, test } from 'vitest'

const KEY = 'meridian_settings'
const LEGACY_NAME_KEY = 'meridian_name'

/** Load a fresh copy of the store, so `load()` runs against current storage. */
async function freshStore() {
  const { useSettings } = await import('./settings')
  return useSettings
}

beforeEach(() => {
  localStorage.clear()
  // Each test needs the module's load() to re-run against its own storage state.
  return import('vitest').then(({ vi }) => vi.resetModules())
})

describe('defaults on a fresh install', () => {
  test('starts un-onboarded so the introduction shows', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().onboarded).toBe(false)
  })

  test('graphics quality starts at low for maximum compatibility', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().graphicsQuality).toBe('low')
  })

  test('the hybrid (satellite + labels) basemap is the default', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().mapStyle).toBe('hybrid')
  })

  test('language starts as English', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().language).toBe('en')
  })

  test('photo GPS and pane transitions are on by default', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().photoGps).toBe(true)
    expect(useSettings.getState().paneTransitions).toBe(true)
  })

  test('interface motion starts full', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().motion).toBe('full')
  })

  test('theme follows the system', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().theme).toBe('system')
  })
})

describe('the onboarded migration', () => {
  test('an EXISTING install is treated as already introduced', async () => {
    // The scenario that matters: someone has been using Meridian, then updates to
    // the version that adds onboarding. They must not be shown an introduction.
    localStorage.setItem(KEY, JSON.stringify({ name: 'Pratik', theme: 'dark' }))
    const useSettings = await freshStore()
    expect(useSettings.getState().onboarded).toBe(true)
  })

  test('even a completely empty stored object counts as an existing install', async () => {
    // The presence of the key is the signal, not its contents.
    localStorage.setItem(KEY, '{}')
    const useSettings = await freshStore()
    expect(useSettings.getState().onboarded).toBe(true)
  })

  test('an explicitly stored false is respected, not overwritten', async () => {
    // Someone who skipped halfway and reloaded should still be mid-introduction.
    localStorage.setItem(KEY, JSON.stringify({ onboarded: false }))
    const useSettings = await freshStore()
    expect(useSettings.getState().onboarded).toBe(false)
  })

  test('no stored settings at all means a fresh install', async () => {
    const useSettings = await freshStore()
    expect(useSettings.getState().onboarded).toBe(false)
  })
})

describe('the basemap-default migration', () => {
  // The default basemap moved parchment → hybrid. Every existing install carries an
  // explicit `mapStyle` in its stored blob, so raising the default alone would have
  // changed nothing for anyone; the install has to be nudged across exactly once.
  const NUDGE = 'meridian_basemap_default_v2'

  test('an install still on the OLD default is moved to the new one', async () => {
    localStorage.setItem(KEY, JSON.stringify({ name: 'Pratik', mapStyle: 'parchment' }))
    const useSettings = await freshStore()
    expect(useSettings.getState().mapStyle).toBe('hybrid')
  })

  test('it happens once — choosing parchment afterwards sticks', async () => {
    localStorage.setItem(KEY, JSON.stringify({ mapStyle: 'parchment' }))
    const first = await freshStore()
    expect(first.getState().mapStyle).toBe('hybrid')

    // The user deliberately picks parchment back, then reloads.
    first.getState().update('mapStyle', 'parchment')
    const { vi } = await import('vitest')
    vi.resetModules()
    const reloaded = await freshStore()
    expect(reloaded.getState().mapStyle).toBe('parchment')
  })

  test('a basemap the user actively chose is never touched', async () => {
    localStorage.setItem(KEY, JSON.stringify({ mapStyle: 'osm' }))
    const useSettings = await freshStore()
    expect(useSettings.getState().mapStyle).toBe('osm')
  })

  test('the marker is set even on a fresh install, so it can never fire later', async () => {
    // Otherwise someone who installs today and later picks parchment would be
    // silently moved off it the next time they open the app.
    await freshStore()
    expect(localStorage.getItem(NUDGE)).toBe('1')
  })
})

describe('loading stored settings', () => {
  test('stored values override defaults', async () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark', tempUnit: 'F', mapZoom: 13 }))
    const useSettings = await freshStore()
    const state = useSettings.getState()
    expect(state.theme).toBe('dark')
    expect(state.tempUnit).toBe('F')
    expect(state.mapZoom).toBe(13)
  })

  test('keys absent from an older blob fall back to defaults', async () => {
    // A blob written before mapStyle/language/photoGps existed.
    localStorage.setItem(KEY, JSON.stringify({ name: 'Pratik', theme: 'dark' }))
    const useSettings = await freshStore()
    const state = useSettings.getState()
    expect(state.mapStyle).toBe('hybrid')
    expect(state.language).toBe('en')
    expect(state.photoGps).toBe(true)
    expect(state.paneTransitions).toBe(true)
    expect(state.motion).toBe('full')
    // …without losing what WAS stored.
    expect(state.name).toBe('Pratik')
    expect(state.theme).toBe('dark')
  })

  test('corrupt JSON falls back to all defaults instead of throwing', async () => {
    localStorage.setItem(KEY, 'not json at all {{{')
    const useSettings = await freshStore()
    expect(useSettings.getState().theme).toBe('system')
  })

  test('migrates the legacy standalone name key', async () => {
    localStorage.setItem(LEGACY_NAME_KEY, 'Pratik')
    const useSettings = await freshStore()
    expect(useSettings.getState().name).toBe('Pratik')
  })

  test('a stored name wins over the legacy key', async () => {
    localStorage.setItem(KEY, JSON.stringify({ name: 'Newer' }))
    localStorage.setItem(LEGACY_NAME_KEY, 'Older')
    const useSettings = await freshStore()
    expect(useSettings.getState().name).toBe('Newer')
  })
})

describe('update', () => {
  test('changes the value in the store', async () => {
    const useSettings = await freshStore()
    useSettings.getState().update('theme', 'dark')
    expect(useSettings.getState().theme).toBe('dark')
  })

  test('persists to localStorage immediately', async () => {
    const useSettings = await freshStore()
    useSettings.getState().update('tempUnit', 'F')
    expect(JSON.parse(localStorage.getItem(KEY)!).tempUnit).toBe('F')
  })

  test('does not persist the store’s own methods', async () => {
    // `update`/`reset`/`flush` are functions; JSON.stringify would drop them, but
    // an accidental spread could still write junk keys. Assert the shape is clean.
    const useSettings = await freshStore()
    useSettings.getState().update('theme', 'dark')
    const stored = JSON.parse(localStorage.getItem(KEY)!)
    expect('update' in stored).toBe(false)
    expect('reset' in stored).toBe(false)
    expect('flush' in stored).toBe(false)
  })

  test('successive updates accumulate rather than overwriting each other', async () => {
    const useSettings = await freshStore()
    useSettings.getState().update('theme', 'dark')
    useSettings.getState().update('tempUnit', 'F')
    const stored = JSON.parse(localStorage.getItem(KEY)!)
    expect(stored.theme).toBe('dark')
    expect(stored.tempUnit).toBe('F')
  })

  test('survives a reload', async () => {
    const useSettings = await freshStore()
    useSettings.getState().update('language', 'bn')

    const { vi } = await import('vitest')
    vi.resetModules()
    const reloaded = await freshStore()
    expect(reloaded.getState().language).toBe('bn')
  })

  test('the motion setting round-trips through persistence', async () => {
    const useSettings = await freshStore()
    useSettings.getState().update('motion', 'off')

    const { vi } = await import('vitest')
    vi.resetModules()
    const reloaded = await freshStore()
    expect(reloaded.getState().motion).toBe('off')
  })
})

describe('flush', () => {
  test('writes the current state to storage', async () => {
    const useSettings = await freshStore()
    useSettings.setState({ name: 'Set directly' })
    useSettings.getState().flush()
    expect(JSON.parse(localStorage.getItem(KEY)!).name).toBe('Set directly')
  })
})

describe('reset', () => {
  test('restores defaults and clears storage', async () => {
    const useSettings = await freshStore()
    useSettings.getState().update('theme', 'dark')
    useSettings.getState().reset()
    expect(useSettings.getState().theme).toBe('system')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  test('clears the legacy name key too', async () => {
    localStorage.setItem(LEGACY_NAME_KEY, 'Pratik')
    const useSettings = await freshStore()
    useSettings.getState().reset()
    expect(localStorage.getItem(LEGACY_NAME_KEY)).toBeNull()
  })
})
