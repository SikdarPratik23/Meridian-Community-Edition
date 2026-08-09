/**
 * Unit tests for `partialLine` (M31, the route's progressive first-draw) and
 * `flightPlan` (M37, arcing long flights) — pure geometry/threshold math kept
 * in `features/map/mapMotion.ts` rather than in `Map.tsx` itself, specifically
 * so they're importable in a test file at all: `Map.tsx` imports `maplibre-gl`,
 * which self-executes a `window.URL.createObjectURL` call at module scope that
 * jsdom doesn't implement, crashing any test file that imports anything from
 * `Map.tsx`, pure export or not.
 */
import { describe, expect, test } from 'vitest'
import { partialLine, flightPlan } from './mapMotion'

describe('partialLine', () => {
  // On the equator, one degree of longitude is a fixed, easy-to-reason-about
  // distance, so these coordinates keep the assertions about SHAPE rather
  // than coupling them to the exact haversine constant.
  const straight: [number, number][] = [[0, 0], [2, 0]]
  const multiSegment: [number, number][] = [[0, 0], [1, 0], [3, 0]]

  test('p <= 0 returns just the starting point', () => {
    expect(partialLine(straight, 0)).toEqual([[0, 0]])
    expect(partialLine(straight, -1)).toEqual([[0, 0]])
  })

  test('p >= 1 returns the full line unchanged', () => {
    expect(partialLine(straight, 1)).toEqual(straight)
    expect(partialLine(multiSegment, 1.5)).toEqual(multiSegment)
  })

  test('fewer than two points is returned as-is regardless of p', () => {
    expect(partialLine([], 0.5)).toEqual([])
    expect(partialLine([[1, 1]], 0.5)).toEqual([[1, 1]])
  })

  test('the midpoint of a straight two-point line lands halfway between them', () => {
    const result = partialLine(straight, 0.5)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0, 0])
    expect(result[1][0]).toBeCloseTo(1, 5) // halfway between lon 0 and lon 2
    expect(result[1][1]).toBeCloseTo(0, 10)
  })

  test('a cut early in a multi-segment line stays within the first segment', () => {
    // Segment 1 (0->1) is exactly a third of the total distance (1 vs 1+2=3
    // degrees at the same latitude, so lengths scale with the longitude delta).
    const result = partialLine(multiSegment, 0.1)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0, 0])
    expect(result[1][0]).toBeGreaterThan(0)
    expect(result[1][0]).toBeLessThan(1)
  })

  test('a cut past the first segment includes the first vertex and interpolates into the second', () => {
    const result = partialLine(multiSegment, 0.6)
    expect(result[0]).toEqual([0, 0])
    expect(result[1]).toEqual([1, 0])
    expect(result).toHaveLength(3)
    expect(result[2][0]).toBeGreaterThan(1)
    expect(result[2][0]).toBeLessThan(3)
  })

  test('progress is monotonic: a later p never yields a shorter prefix', () => {
    const lengths = [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => partialLine(multiSegment, p).length)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1])
    }
  })

  test('a degenerate line (every point coincides) returns the full line rather than dividing by zero', () => {
    const samePoint: [number, number][] = [[5, 5], [5, 5], [5, 5]]
    expect(partialLine(samePoint, 0.5)).toEqual(samePoint)
  })
})

describe('flightPlan', () => {
  test('a short hop stays direct: no curve, a snappier speed, unchanged duration', () => {
    const plan = flightPlan([0, 0], [0, 0.01], 1200) // ~1.1km
    expect(plan).toEqual({ duration: 1200, curve: 1, speed: 1.6 })
  })

  test('a mid-distance flight uses the ordinary maplibre-ish defaults', () => {
    const plan = flightPlan([0, 0], [1, 0], 1200) // ~111km
    expect(plan).toEqual({ duration: 1200, curve: 1.42, speed: 1.2 })
  })

  test('a long-haul flight pulls back and swoops: higher curve, slower speed, a longer duration', () => {
    const plan = flightPlan([0, 0], [10, 0], 1200) // ~1112km
    expect(plan.curve).toBe(1.6)
    expect(plan.speed).toBe(0.9)
    expect(plan.duration).toBeGreaterThan(1200)
  })

  test("a very long flight's duration is capped, so it never drags on forever", () => {
    const plan = flightPlan([0, 0], [179.9, 0], 1200) // ~half the equator's circumference, ~20,000km
    expect(plan.duration).toBe(4000)
  })

  test('the duration boundary sits exactly at 500km', () => {
    // Just under 500km: still "mid-distance" (unchanged duration).
    const justUnder = flightPlan([0, 0], [4.48, 0], 1200) // ~499km
    expect(justUnder.duration).toBe(1200)
    expect(justUnder.curve).toBe(1.42)
  })
})
