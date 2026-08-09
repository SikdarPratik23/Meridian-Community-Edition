/**
 * Unit tests for <Presence> — the "animate the leaving, not just the arriving"
 * primitive. Behaviour worth pinning: children stay mounted for `exitMs` after
 * `when` goes false, a `when` flip back to true mid-exit cancels the unmount,
 * and motion being off skips the delay entirely (an exit animation IS motion).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import Presence from './Presence'
import { useSettings } from '../../store/settings'

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
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useSettings.setState({ motion: 'full' })
})

describe('mounting', () => {
  test('renders children while `when` is true', () => {
    stubReducedMotion(false)
    render(<Presence when={true} exitMs={200}>content</Presence>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  test('renders nothing when `when` starts false', () => {
    stubReducedMotion(false)
    const { container } = render(<Presence when={false} exitMs={200}>content</Presence>)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('exiting', () => {
  test('stays mounted for exitMs after `when` goes false, applying the exit class', () => {
    stubReducedMotion(false)
    vi.useFakeTimers()
    const { rerender } = render(
      <Presence when={true} exitMs={200} exitClassName="leaving">content</Presence>,
    )
    rerender(<Presence when={false} exitMs={200} exitClassName="leaving">content</Presence>)

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByText('content').className).toContain('leaving')
  })

  test('unmounts once exitMs elapses', async () => {
    stubReducedMotion(false)
    vi.useFakeTimers()
    const { rerender } = render(<Presence when={true} exitMs={200}>content</Presence>)
    rerender(<Presence when={false} exitMs={200}>content</Presence>)

    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(screen.queryByText('content')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  test('a `when` flip back to true mid-exit cancels the unmount and re-enters', async () => {
    stubReducedMotion(false)
    vi.useFakeTimers()
    const { rerender } = render(
      <Presence when={true} exitMs={200} enterClassName="entering" exitClassName="leaving">content</Presence>,
    )
    rerender(<Presence when={false} exitMs={200} enterClassName="entering" exitClassName="leaving">content</Presence>)
    await vi.advanceTimersByTimeAsync(100)
    rerender(<Presence when={true} exitMs={200} enterClassName="entering" exitClassName="leaving">content</Presence>)

    // Past when the original exit would have unmounted — it must not have.
    await vi.advanceTimersByTimeAsync(200)
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.getByText('content').className).toContain('entering')
  })
})

describe('motion off', () => {
  test('unmounts immediately, with no exit delay', () => {
    stubReducedMotion(false)
    useSettings.setState({ motion: 'off' })
    vi.useFakeTimers()
    const { rerender } = render(<Presence when={true} exitMs={200}>content</Presence>)
    rerender(<Presence when={false} exitMs={200}>content</Presence>)

    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  test('the OS reduced-motion preference has the same effect', () => {
    stubReducedMotion(true)
    const { rerender } = render(<Presence when={true} exitMs={200}>content</Presence>)
    rerender(<Presence when={false} exitMs={200}>content</Presence>)

    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })
})
