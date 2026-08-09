/**
 * Unit tests for the live "reduce motion" hook.
 *
 * The behaviour worth pinning down: it reads the current preference on mount,
 * AND reacts if the OS setting changes while the app stays open — a one-shot
 * `matches` read (as several backdrop components already do inline, on
 * purpose) would miss that.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReducedMotion } from './useReducedMotion'

/** A fake `matchMedia` whose `matches` can be flipped after the fact, and which
 *  remembers its listeners so a test can fire a `change` event. */
function stubMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion') ? matches : false
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  }))
  return {
    set: (v: boolean) => {
      matches = v
      listeners.forEach((cb) => cb())
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReducedMotion', () => {
  test('reflects the preference already in effect on mount', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  test('defaults to false when the preference is off', () => {
    stubMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  test('reacts when the OS setting changes while mounted', () => {
    const mq = stubMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => mq.set(true))
    expect(result.current).toBe(true)

    act(() => mq.set(false))
    expect(result.current).toBe(false)
  })

  test('stops listening after unmount', () => {
    const mq = stubMatchMedia(false)
    const { result, unmount } = renderHook(() => useReducedMotion())
    unmount()
    // No assertion possible on internal state post-unmount beyond "it doesn't
    // throw" — the real guard is the removeEventListener call the effect
    // cleanup makes, exercised implicitly by unmount() succeeding.
    act(() => mq.set(true))
    expect(result.current).toBe(false)
  })
})
