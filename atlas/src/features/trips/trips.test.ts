/**
 * Unit tests for trip grouping.
 *
 * Trips are DERIVED — nothing is persisted beyond each entry's `trip` name — so
 * every number the Trips tab shows (span, distance, places) is computed here. The
 * behaviour worth pinning down: entries group by trip name, tombstones never
 * appear, and an unlocated entry doesn't drag the route through Null Island.
 */
import { describe, expect, test } from 'vitest'
import { computeTrips, tripDateRange, tripNames } from './trips'
import { COORDS, journal } from '../../test/factories'

const alps = (over = {}) => journal({ trip: 'Alps 2026', ...over })

describe('computeTrips', () => {
  test('groups entries that share a trip name', () => {
    const trips = computeTrips([
      alps({ timestamp: '2026-08-12T09:00:00.000Z' }),
      alps({ timestamp: '2026-08-13T09:00:00.000Z' }),
      journal({ trip: 'Baltic', timestamp: '2026-06-01T09:00:00.000Z' }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips.map((t) => t.name).sort()).toEqual(['Alps 2026', 'Baltic'])
  })

  test('a trip’s id is its name, so lookups are stable', () => {
    const [trip] = computeTrips([alps()])
    expect(trip.id).toBe('Alps 2026')
    expect(trip.name).toBe('Alps 2026')
  })

  test('untagged entries are ignored entirely', () => {
    expect(computeTrips([journal(), journal(), journal()])).toEqual([])
  })

  test('a whitespace-only trip name does not create a trip', () => {
    expect(computeTrips([journal({ trip: '   ' })])).toEqual([])
  })

  test('trip names are trimmed, so " Alps" and "Alps" are one trip', () => {
    const trips = computeTrips([journal({ trip: ' Alps ' }), journal({ trip: 'Alps' })])
    expect(trips).toHaveLength(1)
    expect(trips[0].events).toHaveLength(2)
  })

  test('a single tagged entry still forms a trip', () => {
    // There is no minimum-size rule any more (the old auto-clustering had one).
    const trips = computeTrips([alps()])
    expect(trips).toHaveLength(1)
    expect(trips[0].events).toHaveLength(1)
  })

  test('tombstoned entries are excluded', () => {
    const trips = computeTrips([
      alps({ timestamp: '2026-08-12T09:00:00.000Z' }),
      alps({ timestamp: '2026-08-13T09:00:00.000Z', deleted_at: '2026-08-14T00:00:00.000Z' }),
    ])
    expect(trips[0].events).toHaveLength(1)
  })

  test('a trip whose every entry is deleted disappears', () => {
    const trips = computeTrips([alps({ deleted_at: '2026-08-14T00:00:00.000Z' })])
    expect(trips).toEqual([])
  })

  test('entries within a trip are ordered oldest → newest', () => {
    const trips = computeTrips([
      alps({ title: 'C', timestamp: '2026-08-14T09:00:00.000Z' }),
      alps({ title: 'A', timestamp: '2026-08-12T09:00:00.000Z' }),
      alps({ title: 'B', timestamp: '2026-08-13T09:00:00.000Z' }),
    ])
    expect(trips[0].events.map((e) => e.title)).toEqual(['A', 'B', 'C'])
  })

  test('trips are ordered newest-ending first', () => {
    const trips = computeTrips([
      journal({ trip: 'Old', timestamp: '2026-01-01T09:00:00.000Z' }),
      journal({ trip: 'Recent', timestamp: '2026-08-01T09:00:00.000Z' }),
      journal({ trip: 'Middle', timestamp: '2026-05-01T09:00:00.000Z' }),
    ])
    expect(trips.map((t) => t.name)).toEqual(['Recent', 'Middle', 'Old'])
  })

  test('startTs and endTs bracket the trip', () => {
    const trips = computeTrips([
      alps({ timestamp: '2026-08-14T09:00:00.000Z' }),
      alps({ timestamp: '2026-08-12T09:00:00.000Z' }),
    ])
    expect(trips[0].startTs).toBe('2026-08-12T09:00:00.000Z')
    expect(trips[0].endTs).toBe('2026-08-14T09:00:00.000Z')
  })

  describe('spanDays', () => {
    test('a same-day trip spans 1 day, not 0', () => {
      const trips = computeTrips([
        alps({ timestamp: '2026-08-12T09:00:00.000Z' }),
        alps({ timestamp: '2026-08-12T18:00:00.000Z' }),
      ])
      expect(trips[0].spanDays).toBe(1)
    })

    test('is inclusive of both end days', () => {
      const trips = computeTrips([
        alps({ timestamp: '2026-08-12T09:00:00.000Z' }),
        alps({ timestamp: '2026-08-15T09:00:00.000Z' }),
      ])
      expect(trips[0].spanDays).toBe(4) // 12th, 13th, 14th, 15th
    })

    test('a single-entry trip spans 1 day', () => {
      expect(computeTrips([alps()])[0].spanDays).toBe(1)
    })
  })

  describe('distanceKm', () => {
    test('is zero when nothing is located', () => {
      const trips = computeTrips([alps(), alps({ timestamp: '2026-08-13T09:00:00.000Z' })])
      expect(trips[0].distanceKm).toBe(0)
    })

    test('is zero for a single located entry (no hop to measure)', () => {
      const trips = computeTrips([
        alps({ longitude: COORDS.nuremberg[0], latitude: COORDS.nuremberg[1] }),
      ])
      expect(trips[0].distanceKm).toBe(0)
    })

    test('sums consecutive located hops in time order', () => {
      const trips = computeTrips([
        alps({
          timestamp: '2026-08-12T09:00:00.000Z',
          longitude: COORDS.nuremberg[0],
          latitude: COORDS.nuremberg[1],
        }),
        alps({
          timestamp: '2026-08-13T09:00:00.000Z',
          longitude: COORDS.munich[0],
          latitude: COORDS.munich[1],
        }),
      ])
      expect(trips[0].distanceKm).toBeCloseTo(150.6, 0)
    })

    test('unlocated entries in the middle do not route through Null Island', () => {
      // The bug this guards: including the 0,0 sentinel in the route would add
      // two ~5000 km legs to a 150 km trip.
      const trips = computeTrips([
        alps({
          timestamp: '2026-08-12T09:00:00.000Z',
          longitude: COORDS.nuremberg[0],
          latitude: COORDS.nuremberg[1],
        }),
        alps({ timestamp: '2026-08-12T12:00:00.000Z' }), // unlocated
        alps({
          timestamp: '2026-08-13T09:00:00.000Z',
          longitude: COORDS.munich[0],
          latitude: COORDS.munich[1],
        }),
      ])
      expect(trips[0].distanceKm).toBeCloseTo(150.6, 0)
      expect(trips[0].located).toHaveLength(2)
      expect(trips[0].events).toHaveLength(3)
    })
  })

  describe('placeNames', () => {
    test('collects distinct place names in first-appearance order', () => {
      const trips = computeTrips([
        alps({ timestamp: '2026-08-12T09:00:00.000Z', location_name: 'Nuremberg' }),
        alps({ timestamp: '2026-08-13T09:00:00.000Z', location_name: 'Munich' }),
        alps({ timestamp: '2026-08-14T09:00:00.000Z', location_name: 'Nuremberg' }),
      ])
      expect(trips[0].placeNames).toEqual(['Nuremberg', 'Munich'])
    })

    test('ignores blank and whitespace-only place names', () => {
      const trips = computeTrips([
        alps({ timestamp: '2026-08-12T09:00:00.000Z', location_name: '  ' }),
        alps({ timestamp: '2026-08-13T09:00:00.000Z', location_name: 'Munich' }),
      ])
      expect(trips[0].placeNames).toEqual(['Munich'])
    })
  })

  test('handles a large journal without pathological cost', () => {
    const events = Array.from({ length: 2000 }, (_, i) =>
      journal({
        trip: `Trip ${i % 20}`,
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
        longitude: 11 + (i % 100) / 1000,
        latitude: 49 + (i % 100) / 1000,
      }),
    )
    const trips = computeTrips(events)
    expect(trips).toHaveLength(20)
    expect(trips.reduce((n, t) => n + t.events.length, 0)).toBe(2000)
  })
})

describe('tripNames', () => {
  test('lists distinct names, most-recently-used first', () => {
    const names = tripNames([
      journal({ trip: 'Old', timestamp: '2026-01-01T09:00:00.000Z' }),
      journal({ trip: 'New', timestamp: '2026-08-01T09:00:00.000Z' }),
      journal({ trip: 'Mid', timestamp: '2026-05-01T09:00:00.000Z' }),
    ])
    expect(names).toEqual(['New', 'Mid', 'Old'])
  })

  test('a name is listed once, dated by its newest entry', () => {
    const names = tripNames([
      journal({ trip: 'Alps', timestamp: '2026-01-01T09:00:00.000Z' }),
      journal({ trip: 'Alps', timestamp: '2026-09-01T09:00:00.000Z' }),
      journal({ trip: 'Baltic', timestamp: '2026-05-01T09:00:00.000Z' }),
    ])
    expect(names).toEqual(['Alps', 'Baltic'])
  })

  test('skips tombstones and untagged entries', () => {
    const names = tripNames([
      journal(),
      journal({ trip: 'Gone', deleted_at: '2026-08-14T00:00:00.000Z' }),
      journal({ trip: 'Kept' }),
    ])
    expect(names).toEqual(['Kept'])
  })

  test('is empty for an empty journal', () => {
    expect(tripNames([])).toEqual([])
  })
})

describe('tripDateRange', () => {
  // These labels go through Intl with the runner's default locale, so assert
  // structure rather than an exact en-GB/en-US string.
  const rangeFor = (start: string, end: string) =>
    tripDateRange(computeTrips([alps({ timestamp: start }), alps({ timestamp: end })])[0])

  test('a same-day trip shows a single date', () => {
    const label = rangeFor('2026-08-12T09:00:00.000Z', '2026-08-12T18:00:00.000Z')
    expect(label).not.toContain('–')
    expect(label).toMatch(/2026/)
  })

  test('a within-month trip joins the two days with an en dash', () => {
    const label = rangeFor('2026-08-12T09:00:00.000Z', '2026-08-15T09:00:00.000Z')
    expect(label).toContain('–')
    expect(label).toMatch(/12/)
    expect(label).toMatch(/15/)
  })

  test('a cross-month trip shows both full dates', () => {
    const label = rangeFor('2026-07-28T09:00:00.000Z', '2026-08-03T09:00:00.000Z')
    expect(label).toContain(' – ')
    // Two distinct months must appear.
    expect(label).toMatch(/Jul/)
    expect(label).toMatch(/Aug/)
  })

  test('a cross-year trip shows both years', () => {
    const label = rangeFor('2026-12-28T09:00:00.000Z', '2027-01-03T09:00:00.000Z')
    expect(label).toMatch(/2026/)
    expect(label).toMatch(/2027/)
  })
})
