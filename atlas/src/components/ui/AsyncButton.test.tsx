/**
 * Unit tests for <AsyncButton> — the shared working→done treatment.
 *
 * What matters: it never fires a second run while one is in flight, it shows
 * the right label at each phase, `onSettled` fires on success (and NOT on
 * error, since an error usually means "stay put"), and it reverts to idle
 * after `settleMs` regardless of outcome.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AsyncButton from './AsyncButton'

afterEach(() => {
  vi.useRealTimers()
})

describe('the idle state', () => {
  test('shows the idle label', () => {
    render(<AsyncButton run={async () => ({ ok: true })} idleLabel="Save" />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

describe('running', () => {
  test('shows the working label and disables the button while in flight', async () => {
    let resolveRun: (() => void) | undefined
    const run = () => new Promise<{ ok: boolean }>((resolve) => { resolveRun = () => resolve({ ok: true }) })
    render(<AsyncButton run={run} idleLabel="Save" workingLabel="Saving…" />)

    await userEvent.setup().click(screen.getByRole('button'))

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')

    await act(async () => resolveRun?.())
  })

  test('a second click while working does not call run again', async () => {
    const run = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    render(<AsyncButton run={run} idleLabel="Save" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button'))

    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('success', () => {
  test('shows the done label and a checkmark', async () => {
    render(<AsyncButton run={async () => ({ ok: true })} idleLabel="Save" doneLabel="Saved" />)
    await userEvent.setup().click(screen.getByRole('button'))

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(document.querySelector('.async-btn-tick')).not.toBeNull()
  })

  test('a run resolving to nothing counts as success', async () => {
    render(<AsyncButton run={async () => {}} idleLabel="Save" doneLabel="Saved" />)
    await userEvent.setup().click(screen.getByRole('button'))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
  })

  test('calls onSettled after the checkmark draw, with the result', async () => {
    vi.useFakeTimers()
    const onSettled = vi.fn()
    render(<AsyncButton run={async () => ({ ok: true, data: 'the-entry' })} onSettled={onSettled} idleLabel="Save" />)

    await act(async () => {
      screen.getByRole('button').click()
    })
    expect(onSettled).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(onSettled).toHaveBeenCalledWith({ ok: true, data: 'the-entry' })
  })

  test('reverts to the idle label after settleMs', async () => {
    vi.useFakeTimers()
    render(<AsyncButton run={async () => ({ ok: true })} idleLabel="Save" doneLabel="Saved" settleMs={1000} />)

    await act(async () => {
      screen.getByRole('button').click()
    })
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

describe('failure', () => {
  test('a { ok: false } result shows the error label', async () => {
    render(<AsyncButton run={async () => ({ ok: false })} idleLabel="Connect" errorLabel="Couldn’t connect" />)
    await userEvent.setup().click(screen.getByRole('button'))
    expect(await screen.findByRole('button', { name: 'Couldn’t connect' })).toBeInTheDocument()
  })

  test('a thrown error is treated as failure, not left hanging in "working"', async () => {
    render(<AsyncButton run={async () => { throw new Error('nope') }} idleLabel="Connect" errorLabel="Failed" />)
    await userEvent.setup().click(screen.getByRole('button'))
    expect(await screen.findByRole('button', { name: 'Failed' })).toBeInTheDocument()
  })

  test('does NOT call onSettled on failure', async () => {
    vi.useFakeTimers()
    const onSettled = vi.fn()
    render(<AsyncButton run={async () => ({ ok: false })} onSettled={onSettled} idleLabel="Connect" />)

    await act(async () => {
      screen.getByRole('button').click()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(onSettled).not.toHaveBeenCalled()
  })

  test('no checkmark is drawn on failure', async () => {
    render(<AsyncButton run={async () => ({ ok: false })} idleLabel="Connect" errorLabel="Failed" />)
    await userEvent.setup().click(screen.getByRole('button'))
    await screen.findByRole('button', { name: 'Failed' })
    expect(document.querySelector('.async-btn-tick')).toBeNull()
  })
})

describe('external disabling', () => {
  test('a caller-supplied `disabled` is respected in the idle state', () => {
    render(<AsyncButton run={async () => ({ ok: true })} idleLabel="Save" disabled />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
