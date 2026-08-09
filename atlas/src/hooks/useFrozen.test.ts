/**
 * Unit tests for `useFrozen` — the "remember the last value while `keep` was
 * true" hook that lets a Presence exit fade out real content instead of empty
 * content. Behaviour worth pinning: it tracks the live value while `keep` is
 * true, and holds the last one once `keep` goes false.
 */
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFrozen } from './useFrozen'

describe('useFrozen', () => {
  test('returns the live value while keep is true', () => {
    const { result } = renderHook(() => useFrozen('hello', true))
    expect(result.current).toBe('hello')
  })

  test('tracks updates while keep stays true', () => {
    const { result, rerender } = renderHook(({ value, keep }) => useFrozen(value, keep), {
      initialProps: { value: 'a', keep: true },
    })
    rerender({ value: 'b', keep: true })
    expect(result.current).toBe('b')
  })

  test('holds the last value once keep flips to false', () => {
    const { result, rerender } = renderHook(({ value, keep }) => useFrozen(value, keep), {
      initialProps: { value: 'a', keep: true },
    })
    rerender({ value: '', keep: false })
    expect(result.current).toBe('a')
  })

  test('further changes to value are ignored while keep is false', () => {
    const { result, rerender } = renderHook(({ value, keep }) => useFrozen(value, keep), {
      initialProps: { value: 'a', keep: true },
    })
    rerender({ value: '', keep: false })
    rerender({ value: 'stale-write-attempt', keep: false })
    expect(result.current).toBe('a')
  })

  test('resumes tracking once keep flips back to true', () => {
    const { result, rerender } = renderHook(({ value, keep }) => useFrozen(value, keep), {
      initialProps: { value: 'a', keep: true },
    })
    rerender({ value: '', keep: false })
    rerender({ value: 'b', keep: true })
    expect(result.current).toBe('b')
  })
})
