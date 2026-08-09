/**
 * Unit tests for `flipTransform` — the pure FLIP geometry behind the
 * lightbox's zoom-from-thumbnail entrance/exit (MOTION_PLAN.md M19).
 */
import { describe, expect, test } from 'vitest'
import { flipTransform } from './Lightbox'

describe('flipTransform', () => {
  test('a thumbnail the same size and position as the final image yields the identity transform', () => {
    const rect = { top: 100, left: 100, width: 200, height: 200 }
    expect(flipTransform(rect, rect)).toBe('translate(0px, 0px) scale(1, 1)')
  })

  test('a smaller, offset thumbnail scales down and translates toward it', () => {
    // Thumbnail: 50x50 at (10,10) -> centre (35,35). Final: 200x200 at (100,100) -> centre (200,200).
    const origin = { top: 10, left: 10, width: 50, height: 50 }
    const final = { top: 100, left: 100, width: 200, height: 200 }
    expect(flipTransform(origin, final)).toBe('translate(-165px, -165px) scale(0.25, 0.25)')
  })

  test('handles non-square (letterboxed) rects with independent x/y scale', () => {
    const origin = { top: 0, left: 0, width: 40, height: 20 }
    const final = { top: 0, left: 0, width: 80, height: 80 }
    expect(flipTransform(origin, final)).toBe('translate(-20px, -30px) scale(0.5, 0.25)')
  })

  test('returns no transform (rather than dividing by zero) when the final rect has no size yet', () => {
    const origin = { top: 10, left: 10, width: 50, height: 50 }
    const final = { top: 0, left: 0, width: 0, height: 0 }
    expect(flipTransform(origin, final)).toBe('')
  })
})
