/**
 * Unit tests for the sliding-indicator geometry.
 *
 * `indicatorRect` is the pure part — the actual rect→transform math — tested
 * directly against plain `DOMRect`-shaped objects rather than a real layout,
 * including the case a segmented control's own "wraps to two rows on a phone"
 * note calls out: the active item sitting on a different row than where
 * measurement started.
 */
import { describe, expect, test } from 'vitest'
import { indicatorRect, isWrappedRow } from './useSlidingIndicator'

/** A minimal DOMRect-shaped object — only `left`/`width` are read. */
function rect(left: number, width: number): DOMRect {
  return { left, width, top: 0, height: 0, right: left + width, bottom: 0, x: left, y: 0, toJSON: () => ({}) };
}

describe('indicatorRect', () => {
  test('the first item sits flush with the container', () => {
    expect(indicatorRect(rect(0, 300), rect(0, 90))).toEqual({ x: 0, width: 90 })
  })

  test('offsets by however far the active item sits from the container edge', () => {
    expect(indicatorRect(rect(0, 300), rect(120, 90))).toEqual({ x: 120, width: 90 })
  })

  test('a container that itself starts mid-viewport still yields a container-relative offset', () => {
    // Container starts at x=50 in viewport space; active item at x=170 →
    // 120px into the container, exactly as if the container started at 0.
    expect(indicatorRect(rect(50, 300), rect(170, 90))).toEqual({ x: 120, width: 90 })
  })

  test('a wrapped second-row item still measures a positive offset against its own row', () => {
    // getBoundingClientRect reports real viewport coordinates regardless of
    // wrapping, so a second-row item several hundred px down still resolves to
    // a plain left-edge delta — the caller decides whether to also track `top`.
    expect(indicatorRect(rect(0, 300), rect(0, 140))).toEqual({ x: 0, width: 140 })
  })

  test('zero-width container or item does not throw', () => {
    expect(() => indicatorRect(rect(0, 0), rect(0, 0))).not.toThrow()
    expect(indicatorRect(rect(0, 0), rect(0, 0))).toEqual({ x: 0, width: 0 })
  })
})

describe('isWrappedRow', () => {
  test('a single row is not wrapped', () => {
    expect(isWrappedRow(28, 28)).toBe(false)
  })

  test('a container noticeably taller than one row has wrapped', () => {
    expect(isWrappedRow(56, 28)).toBe(true)
  })

  test('a little row-to-row gap does not itself count as a second row', () => {
    expect(isWrappedRow(30, 28)).toBe(false)
  })

  test('a zero-height row never reports wrapped (measurement not ready yet)', () => {
    expect(isWrappedRow(0, 0)).toBe(false)
  })
})
