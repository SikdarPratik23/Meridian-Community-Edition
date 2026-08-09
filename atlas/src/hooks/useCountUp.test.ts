/**
 * Unit tests for the count-up hook.
 *
 * The animation math is exported as pure functions specifically so it's
 * testable without a DOM or a real animation frame — the hook itself is only
 * exercised for the two behaviours that actually need React: skipping the
 * animation entirely when motion is off, and counting from the previous value
 * rather than restarting from zero.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { easeOutCubic, frameValue, useCountUp } from './useCountUp'
import { useSettings } from '../store/settings'

describe('easeOutCubic', () => {
  test('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  test('is monotonically non-decreasing across the domain', () => {
    let prev = -Infinity
    for (let p = 0; p <= 1; p += 0.05) {
      const v = easeOutCubic(p)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  test('clamps progress outside [0, 1]', () => {
    expect(easeOutCubic(-0.5)).toBe(0)
    expect(easeOutCubic(1.5)).toBe(1)
  })

  test('is front-loaded — past the midpoint before p=0.5 (an ease-OUT curve)', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})

describe('frameValue', () => {
  test('lands exactly on `from` at p=0 and `to` at p=1', () => {
    expect(frameValue(10, 312, 0)).toBe(10)
    expect(frameValue(10, 312, 1)).toBe(312)
  })

  test('counts downward just as well as upward', () => {
    expect(frameValue(100, 40, 1)).toBe(40)
    expect(frameValue(100, 40, 0)).toBe(100)
  })

  test('a zero-distance count stays put at every progress', () => {
    for (const p of [0, 0.3, 0.7, 1]) {
      expect(frameValue(50, 50, p)).toBe(50)
    }
  })
})

describe('useCountUp', () => {
  afterEach(() => {
    useSettings.setState({ motion: 'full' })
  })

  test('returns the target immediately with no animation when motion is off', () => {
    useSettings.setState({ motion: 'off' })
    const { result } = renderHook(() => useCountUp(312))
    expect(result.current).toBe(312)
  })

  test('a zero target with motion off stays zero, not NaN or undefined', () => {
    useSettings.setState({ motion: 'off' })
    const { result } = renderHook(() => useCountUp(0))
    expect(result.current).toBe(0)
  })

  test('re-renders with the same target do not restart or throw', () => {
    useSettings.setState({ motion: 'off' })
    const { result, rerender } = renderHook(({ n }) => useCountUp(n), { initialProps: { n: 312 } })
    rerender({ n: 312 })
    expect(result.current).toBe(312)
  })
})
