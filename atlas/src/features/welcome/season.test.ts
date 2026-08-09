/**
 * Unit tests for season detection.
 *
 * Meteorological seasons from the month, flipped for the southern hemisphere.
 * The hemisphere flip is the part worth guarding — it's easy to regress and only
 * a southern-hemisphere user would notice.
 */
import { describe, expect, test } from 'vitest'
import { seasonFor } from './season'

const NORTH = 49.4521
const SOUTH = -33.8688
/** Month is 0-indexed, matching Date. */
const on = (month: number, lat: number | null) => seasonFor(new Date(2026, month, 15), lat).key

describe('seasonFor — northern hemisphere', () => {
  test('December, January and February are winter', () => {
    expect(on(11, NORTH)).toBe('winter')
    expect(on(0, NORTH)).toBe('winter')
    expect(on(1, NORTH)).toBe('winter')
  })

  test('March through May are spring', () => {
    expect(on(2, NORTH)).toBe('spring')
    expect(on(3, NORTH)).toBe('spring')
    expect(on(4, NORTH)).toBe('spring')
  })

  test('June through August are summer', () => {
    expect(on(5, NORTH)).toBe('summer')
    expect(on(6, NORTH)).toBe('summer')
    expect(on(7, NORTH)).toBe('summer')
  })

  test('September through November are autumn', () => {
    expect(on(8, NORTH)).toBe('autumn')
    expect(on(9, NORTH)).toBe('autumn')
    expect(on(10, NORTH)).toBe('autumn')
  })
})

describe('seasonFor — southern hemisphere', () => {
  test('the seasons are flipped', () => {
    expect(on(11, SOUTH)).toBe('summer') // December
    expect(on(2, SOUTH)).toBe('autumn') // March
    expect(on(5, SOUTH)).toBe('winter') // June
    expect(on(8, SOUTH)).toBe('spring') // September
  })

  test('every month is the opposite of the northern season', () => {
    const opposite: Record<string, string> = {
      winter: 'summer',
      summer: 'winter',
      spring: 'autumn',
      autumn: 'spring',
    }
    for (let m = 0; m < 12; m++) {
      expect(on(m, SOUTH)).toBe(opposite[on(m, NORTH)])
    }
  })
})

describe('seasonFor — hemisphere boundary and unknown location', () => {
  test('the equator counts as northern', () => {
    expect(on(5, 0)).toBe('summer')
  })

  test('a null latitude defaults to northern rather than throwing', () => {
    // The welcome screen renders before any location fix.
    expect(on(5, null)).toBe('summer')
    expect(on(11, null)).toBe('winter')
  })

  test('just south of the equator is southern', () => {
    expect(on(5, -0.1)).toBe('winter')
  })
})

describe('seasonFor — returned metadata', () => {
  test('carries a label, emoji and particle for the backdrop', () => {
    const meta = seasonFor(new Date(2026, 5, 15), NORTH)
    expect(meta.key).toBe('summer')
    expect(meta.label).toBe('Summer')
    expect(meta.emoji.length).toBeGreaterThan(0)
    expect(meta.particle.length).toBeGreaterThan(0)
  })

  test('the label always matches the key', () => {
    for (let m = 0; m < 12; m++) {
      const meta = seasonFor(new Date(2026, m, 15), NORTH)
      expect(meta.label.toLowerCase()).toBe(meta.key)
    }
  })

  test('all four seasons appear across a year', () => {
    const keys = new Set(Array.from({ length: 12 }, (_, m) => on(m, NORTH)))
    expect(keys).toEqual(new Set(['winter', 'spring', 'summer', 'autumn']))
  })
})
