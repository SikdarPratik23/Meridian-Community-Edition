/**
 * Unit tests for the pure helpers BACKDROP_BRIEF Phase 4 added to scene.ts.
 *
 * All three were previously inline logic with no tests at all: `hemisphereFor`
 * decides which constellation set is even geometrically possible to see,
 * `windSignFor` had been duplicated verbatim in two components, and
 * `cairnBucketFor` decides when the trail cairn gains a stone. Extracted here
 * specifically so each can be pinned down without mounting a component or
 * seeding a real journal.
 */
import { describe, expect, test } from 'vitest'
import { hemisphereFor, windSignFor, cairnBucketFor } from './scene'

describe('hemisphereFor', () => {
  test('a positive latitude is northern', () => {
    expect(hemisphereFor(49.4521)).toBe('N')
  })

  test('a negative latitude is southern', () => {
    expect(hemisphereFor(-33.8688)).toBe('S')
  })

  test('the equator itself counts as northern (not < 0)', () => {
    expect(hemisphereFor(0)).toBe('N')
  })

  test('no location fix defaults to northern', () => {
    expect(hemisphereFor(null)).toBe('N')
    expect(hemisphereFor(undefined)).toBe('N')
  })
})

describe('windSignFor', () => {
  test('a wind from the eastern half (0–180°) blows things leftward', () => {
    expect(windSignFor(45)).toBe(-1)
    expect(windSignFor(179)).toBe(-1)
  })

  test('a wind from the western half (180–360°) blows things rightward', () => {
    expect(windSignFor(181)).toBe(1)
    expect(windSignFor(270)).toBe(1)
    expect(windSignFor(360)).toBe(1)
  })

  test('the boundary values (0° and 180°) both read as rightward', () => {
    expect(windSignFor(0)).toBe(1)
    expect(windSignFor(180)).toBe(1)
  })

  test('no reading yet defaults to the original always-rightward behaviour', () => {
    expect(windSignFor(null)).toBe(1)
    expect(windSignFor(undefined)).toBe(1)
  })
})

describe('cairnBucketFor', () => {
  test('an empty journal has no cairn at all', () => {
    expect(cairnBucketFor(0)).toBe(0)
  })

  test('milestones land at 1, 3, 7, 15, 31, 63 and 127 entries', () => {
    expect(cairnBucketFor(1)).toBe(1)
    expect(cairnBucketFor(3)).toBe(2)
    expect(cairnBucketFor(7)).toBe(3)
    expect(cairnBucketFor(15)).toBe(4)
    expect(cairnBucketFor(31)).toBe(5)
    expect(cairnBucketFor(63)).toBe(6)
    expect(cairnBucketFor(127)).toBe(7)
  })

  test('the bucket only advances strictly at a milestone, not just past it', () => {
    expect(cairnBucketFor(2)).toBe(1)
    expect(cairnBucketFor(6)).toBe(2)
    expect(cairnBucketFor(14)).toBe(3)
  })

  test('caps at 7 stones — the component only draws 7 shapes', () => {
    expect(cairnBucketFor(128)).toBe(7)
    expect(cairnBucketFor(10_000)).toBe(7)
  })

  test('a negative count (should not happen, but is not a crash) reads as zero', () => {
    expect(cairnBucketFor(-5)).toBe(0)
  })
})
