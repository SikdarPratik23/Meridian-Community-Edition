/**
 * Unit tests for the View Transitions wrapper.
 *
 * The only thing that genuinely matters here is that the state change ALWAYS
 * happens, exactly once, on every path — with the API, without it, when the API
 * throws, when the transition rejects, when the setting is off, when reduced
 * motion is on. A missing cross-fade is cosmetic; a swallowed state change would
 * mean a pane that never opens.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { viewTransitionsAvailable, withViewTransition } from './viewTransition'
import { useSettings } from '../store/settings'

/** Install a fake `document.startViewTransition`. Returns the spy. */
function stubApi(impl?: (cb: () => void) => { finished: Promise<void> }) {
  const fn = vi.fn(
    impl ??
      ((cb: () => void) => {
        cb()
        return { finished: Promise.resolve() }
      }),
  )
  Object.defineProperty(document, 'startViewTransition', {
    value: fn,
    configurable: true,
    writable: true,
  })
  return fn
}

function removeApi() {
  Reflect.deleteProperty(document as object, 'startViewTransition')
}

/** Force the reduced-motion media query to a given answer. */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  removeApi()
  useSettings.setState({ paneTransitions: true })
})

describe('viewTransitionsAvailable', () => {
  test('false when the browser lacks the API', () => {
    removeApi()
    stubReducedMotion(false)
    expect(viewTransitionsAvailable()).toBe(false)
  })

  test('true when the API exists, motion is allowed and the setting is on', () => {
    stubApi()
    stubReducedMotion(false)
    useSettings.setState({ paneTransitions: true })
    expect(viewTransitionsAvailable()).toBe(true)
  })

  test('false when the user prefers reduced motion', () => {
    // Checked in JS as well as CSS so no snapshot work happens at all.
    stubApi()
    stubReducedMotion(true)
    expect(viewTransitionsAvailable()).toBe(false)
  })

  test('false when the setting is off', () => {
    stubApi()
    stubReducedMotion(false)
    useSettings.setState({ paneTransitions: false })
    expect(viewTransitionsAvailable()).toBe(false)
  })
})

describe('withViewTransition', () => {
  test('runs the change through the API when available', () => {
    const start = stubApi()
    stubReducedMotion(false)
    const change = vi.fn()

    withViewTransition(change)

    expect(start).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledTimes(1)
  })

  test('runs the change directly when the API is absent', () => {
    removeApi()
    stubReducedMotion(false)
    const change = vi.fn()

    withViewTransition(change)

    expect(change).toHaveBeenCalledTimes(1)
  })

  test('runs the change exactly once when reduced motion is preferred', () => {
    stubApi()
    stubReducedMotion(true)
    const change = vi.fn()

    withViewTransition(change)

    expect(change).toHaveBeenCalledTimes(1)
  })

  test('runs the change when the setting is off, without calling the API', () => {
    const start = stubApi()
    stubReducedMotion(false)
    useSettings.setState({ paneTransitions: false })
    const change = vi.fn()

    withViewTransition(change)

    expect(change).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  test('falls back to a direct call when the API throws', () => {
    // Some engines throw if a transition is already running. The callback has not
    // run at that point, so it must still be invoked.
    stubApi(() => {
      throw new Error('a transition is already active')
    })
    stubReducedMotion(false)
    const change = vi.fn()

    withViewTransition(change)

    expect(change).toHaveBeenCalledTimes(1)
  })

  test('a rejected transition does not throw or double-apply the change', async () => {
    const change = vi.fn()
    stubApi((cb) => {
      cb()
      return { finished: Promise.reject(new Error('interrupted')) }
    })
    stubReducedMotion(false)

    expect(() => withViewTransition(change)).not.toThrow()
    // Let the rejection settle — an unhandled rejection here would fail the run.
    await Promise.resolve()
    await Promise.resolve()
    expect(change).toHaveBeenCalledTimes(1)
  })

  test('the change is never applied twice on any path', () => {
    stubReducedMotion(false)
    for (const setup of [
      () => stubApi(),
      () => removeApi(),
      () => stubApi(() => { throw new Error('nope') }),
    ]) {
      setup()
      const change = vi.fn()
      withViewTransition(change)
      expect(change).toHaveBeenCalledTimes(1)
    }
  })

  test('passes the caller’s own function through, not a wrapper', () => {
    // Guards against a refactor that rebuilds the callback and loses its identity
    // (which would break anything relying on referential equality).
    const start = stubApi()
    stubReducedMotion(false)
    const change = () => {}

    withViewTransition(change)

    expect(start).toHaveBeenCalledWith(change)
  })
})

describe('direction (M13)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.vtDirection
  })

  test('defaults to forward when no direction is given', () => {
    stubApi((cb) => { cb(); return { finished: Promise.resolve() } })
    stubReducedMotion(false)

    withViewTransition(() => {
      expect(document.documentElement.dataset.vtDirection).toBe('forward')
    })
  })

  test('sets the requested direction on <html> while the change runs', () => {
    stubApi((cb) => { cb(); return { finished: Promise.resolve() } })
    stubReducedMotion(false)

    withViewTransition(() => {
      expect(document.documentElement.dataset.vtDirection).toBe('back')
    }, 'back')
  })

  test('clears the direction once the transition finishes', async () => {
    stubApi((cb) => { cb(); return { finished: Promise.resolve() } })
    stubReducedMotion(false)

    withViewTransition(() => {}, 'back')
    await Promise.resolve()
    await Promise.resolve()

    expect(document.documentElement.dataset.vtDirection).toBeUndefined()
  })

  test('clears the direction even when the transition rejects', async () => {
    stubApi(() => ({ finished: Promise.reject(new Error('interrupted')) }))
    stubReducedMotion(false)

    withViewTransition(() => {}, 'back')
    await Promise.resolve()
    await Promise.resolve()

    expect(document.documentElement.dataset.vtDirection).toBeUndefined()
  })

  test('clears the direction when the API throws synchronously', () => {
    stubApi(() => { throw new Error('nope') })
    stubReducedMotion(false)

    withViewTransition(() => {}, 'back')

    expect(document.documentElement.dataset.vtDirection).toBeUndefined()
  })

  test('never sets a direction when the API is absent (change runs directly)', () => {
    removeApi()
    stubReducedMotion(false)

    withViewTransition(() => {}, 'back')

    expect(document.documentElement.dataset.vtDirection).toBeUndefined()
  })
})
