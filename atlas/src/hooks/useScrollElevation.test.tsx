/**
 * Unit tests for `useScrollElevation` — the IntersectionObserver-driven
 * "has the header been scrolled past" flag (MOTION_PLAN.md M22).
 *
 * Rendered through a small harness component (rather than bare `renderHook`)
 * so the sentinel ref is attached the way real usage attaches it — via JSX
 * during commit, before the hook's own effect runs and reads `.current`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useScrollElevation } from './useScrollElevation'

/** A fake IntersectionObserver that remembers its callback so a test can fire it. */
function stubIntersectionObserver() {
  let lastCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null
  const observe = vi.fn()
  const disconnect = vi.fn()
  class FakeObserver {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      lastCallback = cb
    }
    observe = observe
    disconnect = disconnect
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  return {
    fire: (isIntersecting: boolean) => lastCallback?.([{ isIntersecting }]),
    observe,
    disconnect,
  }
}

function Harness() {
  const { sentinelRef, elevated } = useScrollElevation()
  return (
    <div>
      <div ref={sentinelRef} data-testid="sentinel" />
      <span data-testid="state">{elevated ? 'elevated' : 'flat'}</span>
    </div>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useScrollElevation', () => {
  test('starts not elevated', () => {
    stubIntersectionObserver()
    render(<Harness />)
    expect(screen.getByTestId('state')).toHaveTextContent('flat')
  })

  test('observes the sentinel node', () => {
    const io = stubIntersectionObserver()
    render(<Harness />)
    expect(io.observe).toHaveBeenCalledWith(screen.getByTestId('sentinel'))
  })

  test('becomes elevated once the sentinel scrolls out of view', () => {
    const io = stubIntersectionObserver()
    render(<Harness />)
    act(() => io.fire(false))
    expect(screen.getByTestId('state')).toHaveTextContent('elevated')
  })

  test('returns to not-elevated once the sentinel is back in view', () => {
    const io = stubIntersectionObserver()
    render(<Harness />)
    act(() => io.fire(false))
    expect(screen.getByTestId('state')).toHaveTextContent('elevated')
    act(() => io.fire(true))
    expect(screen.getByTestId('state')).toHaveTextContent('flat')
  })

  test('disconnects the observer on unmount', () => {
    const io = stubIntersectionObserver()
    const { unmount } = render(<Harness />)
    unmount()
    expect(io.disconnect).toHaveBeenCalled()
  })

  test('does nothing (and does not throw) when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    expect(() => render(<Harness />)).not.toThrow()
  })
})
