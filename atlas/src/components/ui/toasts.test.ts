/**
 * Unit tests for the toast store.
 *
 * The important behaviour is the **Undo path**, because that's now the safety net
 * under deleting an entry: the action must be invoked exactly once, and the toast
 * must be gone afterwards. Second is the visible-count cap — deleting a whole day
 * raises several toasts in a burst, and burying the screen would be worse than
 * saying nothing.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ACTION_DURATION_MS,
  DEFAULT_DURATION_MS,
  MAX_VISIBLE,
  toast,
  useToasts,
} from './toasts'

beforeEach(() => {
  useToasts.getState().clear()
})

describe('show', () => {
  test('adds a toast', () => {
    useToasts.getState().show({ message: 'Saved' })
    expect(useToasts.getState().toasts).toHaveLength(1)
    expect(useToasts.getState().toasts[0].message).toBe('Saved')
  })

  test('defaults to the info variant', () => {
    useToasts.getState().show({ message: 'Note' })
    expect(useToasts.getState().toasts[0].variant).toBe('info')
  })

  test('returns the new toast’s id', () => {
    const id = useToasts.getState().show({ message: 'Saved' })
    expect(useToasts.getState().toasts[0].id).toBe(id)
  })

  test('ids are unique across calls', () => {
    const ids = Array.from({ length: 10 }, (_, i) =>
      useToasts.getState().show({ message: `n${i}` }),
    )
    expect(new Set(ids).size).toBe(10)
  })

  test('newest appears first', () => {
    useToasts.getState().show({ message: 'first' })
    useToasts.getState().show({ message: 'second' })
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['second', 'first'])
  })

  test('caps the number on screen, dropping the oldest', () => {
    for (let i = 1; i <= MAX_VISIBLE + 3; i++) {
      useToasts.getState().show({ message: `n${i}` })
    }
    const toasts = useToasts.getState().toasts
    expect(toasts).toHaveLength(MAX_VISIBLE)
    // The newest survive; the earliest are gone.
    expect(toasts[0].message).toBe(`n${MAX_VISIBLE + 3}`)
    expect(toasts.some((t) => t.message === 'n1')).toBe(false)
  })

  describe('durations', () => {
    test('a plain toast gets the default duration', () => {
      useToasts.getState().show({ message: 'Saved' })
      expect(useToasts.getState().toasts[0].durationMs).toBe(DEFAULT_DURATION_MS)
    })

    test('an actionable toast lives longer — you must notice AND decide', () => {
      useToasts.getState().show({ message: 'Deleted', action: { label: 'Undo', run: () => {} } })
      expect(useToasts.getState().toasts[0].durationMs).toBe(ACTION_DURATION_MS)
      expect(ACTION_DURATION_MS).toBeGreaterThan(DEFAULT_DURATION_MS)
    })

    test('an explicit duration wins', () => {
      useToasts.getState().show({ message: 'x', durationMs: 500 })
      expect(useToasts.getState().toasts[0].durationMs).toBe(500)
    })

    test('a duration of 0 means "stay until dismissed"', () => {
      useToasts.getState().show({ message: 'x', durationMs: 0 })
      expect(useToasts.getState().toasts[0].durationMs).toBe(0)
    })
  })
})

describe('dismiss', () => {
  test('removes only the named toast', () => {
    const keep = useToasts.getState().show({ message: 'keep' })
    const drop = useToasts.getState().show({ message: 'drop' })
    useToasts.getState().dismiss(drop)
    expect(useToasts.getState().toasts.map((t) => t.id)).toEqual([keep])
  })

  test('dismissing an unknown id is harmless', () => {
    useToasts.getState().show({ message: 'keep' })
    useToasts.getState().dismiss('toast-does-not-exist')
    expect(useToasts.getState().toasts).toHaveLength(1)
  })

  test('dismissing twice is harmless', () => {
    const id = useToasts.getState().show({ message: 'x' })
    useToasts.getState().dismiss(id)
    useToasts.getState().dismiss(id)
    expect(useToasts.getState().toasts).toHaveLength(0)
  })
})

describe('clear', () => {
  test('removes everything', () => {
    useToasts.getState().show({ message: 'a' })
    useToasts.getState().show({ message: 'b' })
    useToasts.getState().clear()
    expect(useToasts.getState().toasts).toHaveLength(0)
  })
})

describe('the imperative helpers', () => {
  test('success and error carry their variants', () => {
    toast.success('Saved')
    expect(useToasts.getState().toasts[0].variant).toBe('success')
    toast.error('Failed')
    expect(useToasts.getState().toasts[0].variant).toBe('danger')
  })

  test('info is the plain variant', () => {
    toast.info('Note')
    expect(useToasts.getState().toasts[0].variant).toBe('info')
  })

  test('they work without a React component — the point of a store', () => {
    // `useDeleteEntry`'s restore helper and the sync layer are not components.
    expect(() => toast.success('from anywhere')).not.toThrow()
    expect(useToasts.getState().toasts).toHaveLength(1)
  })
})

describe('undoable — the delete safety net', () => {
  test('attaches an action labelled Undo by default', () => {
    toast.undoable('Entry deleted', () => {})
    expect(useToasts.getState().toasts[0].action?.label).toBe('Undo')
  })

  test('accepts a custom action label', () => {
    toast.undoable('Entry deleted', () => {}, 'Bring it back')
    expect(useToasts.getState().toasts[0].action?.label).toBe('Bring it back')
  })

  test('the action is not run until it is invoked', () => {
    const undo = vi.fn()
    toast.undoable('Entry deleted', undo)
    expect(undo).not.toHaveBeenCalled()
  })

  test('invoking the action runs it exactly once', () => {
    const undo = vi.fn()
    toast.undoable('Entry deleted', undo)
    useToasts.getState().toasts[0].action!.run()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  test('an undoable toast is given the longer duration', () => {
    toast.undoable('Entry deleted', () => {})
    expect(useToasts.getState().toasts[0].durationMs).toBe(ACTION_DURATION_MS)
  })

  test('several deletions in a burst still leave the newest undoable', () => {
    // Deleting a whole day entry-by-entry must not lose the last Undo.
    for (let i = 0; i < MAX_VISIBLE + 2; i++) toast.undoable(`deleted ${i}`, () => {})
    expect(useToasts.getState().toasts[0].action).toBeDefined()
  })
})
