/**
 * Component tests for the toast host.
 *
 * Behaviour worth pinning: an Undo press runs the action AND removes the toast (a
 * lingering Undo you could press twice would restore an entry twice), the stack
 * auto-dismisses on its timer, and a toast with no timer stays put.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToastHost from './ToastHost'
import { useToasts, toast } from './toasts'

beforeEach(() => {
  useToasts.getState().clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rendering', () => {
  test('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastHost />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('renders a toast’s message', () => {
    toast.success('Entry saved')
    render(<ToastHost />)
    expect(screen.getByText('Entry saved')).toBeInTheDocument()
  })

  test('renders several toasts at once', () => {
    toast.info('one')
    toast.info('two')
    render(<ToastHost />)
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  test('announces politely rather than interrupting', () => {
    // A confirmation should not preempt whatever a screen reader is saying.
    toast.info('Saved')
    render(<ToastHost />)
    expect(screen.getByRole('status').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
  })

  test('a plain toast has no action button', () => {
    toast.success('Saved')
    render(<ToastHost />)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})

describe('dismissal', () => {
  test('the ✕ button removes the toast', async () => {
    toast.info('Saved')
    render(<ToastHost />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useToasts.getState().toasts).toHaveLength(0)
  })

  test('auto-dismisses after its duration', async () => {
    vi.useFakeTimers()
    useToasts.getState().show({ message: 'Saved', durationMs: 1000 })
    render(<ToastHost />)
    expect(useToasts.getState().toasts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1100)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })

  test('a duration of 0 never auto-dismisses', async () => {
    vi.useFakeTimers()
    useToasts.getState().show({ message: 'Stay', durationMs: 0 })
    render(<ToastHost />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(useToasts.getState().toasts).toHaveLength(1)
  })
})

describe('the Undo action', () => {
  test('shows the action button', () => {
    toast.undoable('Entry deleted', () => {})
    render(<ToastHost />)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  test('pressing it runs the action', async () => {
    const undo = vi.fn()
    toast.undoable('Entry deleted', undo)
    render(<ToastHost />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
  })

  test('pressing it also dismisses the toast, so it cannot be run twice', async () => {
    // Running an entry-restore twice would be a real bug, hence the assertion.
    const undo = vi.fn()
    toast.undoable('Entry deleted', undo)
    render(<ToastHost />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))
    expect(useToasts.getState().toasts).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  test('a custom label is used', () => {
    toast.undoable('Entry deleted', () => {}, 'Bring it back')
    render(<ToastHost />)
    expect(screen.getByRole('button', { name: 'Bring it back' })).toBeInTheDocument()
  })
})

describe('the exit lingers (Wave 2, M7)', () => {
  test('a dismissed toast stays in the DOM briefly, mid-fade, before disappearing', async () => {
    vi.useFakeTimers()
    toast.info('Saved')
    render(<ToastHost />)
    // A plain `fireEvent` click, not `userEvent` — userEvent's own internal
    // delays don't mix with fake timers and hang the test.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    // Gone from the store immediately...
    expect(useToasts.getState().toasts).toHaveLength(0)
    // ...but the row itself is still there, mid-exit.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveClass('toast-exit')

    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('dismissing one toast does not disturb another still-active one', async () => {
    vi.useFakeTimers()
    toast.info('first')
    toast.info('second')
    render(<ToastHost />)
    const firstRow = screen.getByText('first').closest('[role="status"]') as HTMLElement
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Dismiss' }))

    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(screen.queryByText('first')).not.toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })
})
