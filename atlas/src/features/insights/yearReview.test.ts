/**
 * Unit tests for the year-in-review numbers.
 *
 * Everything here is DERIVED from the entries the store holds, so these are the
 * only guards on the figures a "2026 in review" screen would show. The behaviour
 * worth pinning down: a year means the local calendar year, tombstones never
 * count, an unlocated entry doesn't drag the route through Null Island, streaks
 * break on real day gaps, and an empty year is a valid all-zero review rather
 * than a crash.
 *
 * Timestamps deliberately sit at 12:00 UTC: that lands on the same calendar day
 * in every plausible runner timezone, so these assertions don't depend on where
 * the suite runs.
 */
import { describe, expect, test } from 'vitest'
import { computeYearReview, journalYears } from './yearReview'
import { COORDS, audio, image, journal, place } from '../../test/factories'

/** `longitude`/`latitude` overrides from a [lon, lat] pair. */
const at = (c: [number, number]) => ({ longitude: c[0], latitude: c[1] })

/** Noon-UTC timestamp for a given date, safe against the runner's timezone. */
const day = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00.000Z`

describe('journalYears', () => {
  test('lists the years with entries, newest first', () => {
    const years = journalYears([
      journal({ timestamp: day(2024, 5, 1) }),
      journal({ timestamp: day(2026, 1, 1) }),
      journal({ timestamp: day(2025, 9, 1) }),
    ])
    expect(years).toEqual([2026, 2025, 2024])
  })

  test('a year is listed once however many entries it has', () => {
    const years = journalYears([
      journal({ timestamp: day(2026, 1, 1) }),
      journal({ timestamp: day(2026, 6, 1) }),
      journal({ timestamp: day(2026, 12, 1) }),
    ])
    expect(years).toEqual([2026])
  })

  test('skips tombstoned entries', () => {
    const years = journalYears([
      journal({ timestamp: day(2026, 3, 1) }),
      journal({ timestamp: day(2025, 3, 1), deleted_at: day(2025, 4, 1) }),
    ])
    expect(years).toEqual([2026])
  })

  test('a year whose every entry is deleted disappears', () => {
    expect(journalYears([journal({ deleted_at: day(2026, 8, 1) })])).toEqual([])
  })

  test('places count as journal activity too', () => {
    expect(journalYears([place({ timestamp: day(2023, 4, 2) })])).toEqual([2023])
  })

  test('is empty for an empty journal', () => {
    expect(journalYears([])).toEqual([])
  })
})

describe('computeYearReview', () => {
  test('reports the year it was asked for', () => {
    expect(computeYearReview([], 2026).year).toBe(2026)
  })

  test('counts only the entries inside the requested year', () => {
    const review = computeYearReview(
      [
        journal({ timestamp: day(2025, 12, 20) }),
        journal({ timestamp: day(2026, 1, 5) }),
        journal({ timestamp: day(2026, 11, 5) }),
        journal({ timestamp: day(2027, 1, 2) }),
      ],
      2026,
    )
    expect(review.totalEntries).toBe(2)
  })

  test('excludes tombstoned entries', () => {
    const review = computeYearReview(
      [
        journal({ timestamp: day(2026, 2, 1) }),
        journal({ timestamp: day(2026, 2, 2), deleted_at: day(2026, 2, 3) }),
      ],
      2026,
    )
    expect(review.totalEntries).toBe(1)
    expect(review.daysJournaled).toBe(1)
  })

  test('a tombstoned entry contributes no places, tags, photos or words', () => {
    const review = computeYearReview(
      [
        journal({
          timestamp: day(2026, 2, 2),
          deleted_at: day(2026, 2, 3),
          location_name: 'Munich',
          tags: ['alps'],
          content_markdown: 'three whole words',
          media_attachments: [image()],
          ...at(COORDS.munich),
        }),
      ],
      2026,
    )
    expect(review.topPlaces).toEqual([])
    expect(review.topTags).toEqual([])
    expect(review.photoCount).toBe(0)
    expect(review.wordCount).toBe(0)
    expect(review.located).toEqual([])
  })

  test('neighbouring years never leak into the totals', () => {
    const review = computeYearReview(
      [
        journal({ timestamp: day(2025, 7, 1), location_name: 'Berlin', tags: ['old'] }),
        journal({ timestamp: day(2026, 7, 1), location_name: 'Munich', tags: ['new'] }),
      ],
      2026,
    )
    expect(review.topPlaces).toEqual([{ name: 'Munich', count: 1 }])
    expect(review.topTags).toEqual([{ name: 'new', count: 1 }])
  })

  test('an empty year is a valid all-zero review', () => {
    expect(computeYearReview([], 2020)).toEqual({
      year: 2020,
      totalEntries: 0,
      entriesPerMonth: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      daysJournaled: 0,
      longestStreak: 0,
      distanceKm: 0,
      topPlaces: [],
      topTags: [],
      moods: [],
      trips: [],
      entriesWithPhotos: 0,
      photoCount: 0,
      wordCount: 0,
      located: [],
      busiestDay: null,
      firstEntry: null,
      lastEntry: null,
    })
  })

  test('a year with entries elsewhere is still empty, not a crash', () => {
    const review = computeYearReview([journal({ timestamp: day(2026, 5, 5) })], 1999)
    expect(review.totalEntries).toBe(0)
    expect(review.busiestDay).toBeNull()
    expect(review.firstEntry).toBeNull()
  })

  describe('entriesPerMonth', () => {
    test('always has exactly 12 buckets, even for an empty year', () => {
      expect(computeYearReview([], 2026).entriesPerMonth).toHaveLength(12)
      expect(computeYearReview([journal()], 2026).entriesPerMonth).toHaveLength(12)
    })

    test('index 0 is January and index 11 is December', () => {
      const review = computeYearReview(
        [journal({ timestamp: day(2026, 1, 15) }), journal({ timestamp: day(2026, 12, 15) })],
        2026,
      )
      expect(review.entriesPerMonth[0]).toBe(1)
      expect(review.entriesPerMonth[11]).toBe(1)
    })

    test('sums the entries within a month', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 4, 1) }),
          journal({ timestamp: day(2026, 4, 18) }),
          journal({ timestamp: day(2026, 4, 30) }),
        ],
        2026,
      )
      expect(review.entriesPerMonth[3]).toBe(3)
      expect(review.entriesPerMonth.reduce((a, b) => a + b, 0)).toBe(3)
    })

    test('the buckets add up to totalEntries', () => {
      const review = computeYearReview(
        Array.from({ length: 24 }, (_, i) => journal({ timestamp: day(2026, (i % 12) + 1, 3) })),
        2026,
      )
      expect(review.entriesPerMonth.reduce((a, b) => a + b, 0)).toBe(review.totalEntries)
      expect(review.entriesPerMonth.every((n) => n === 2)).toBe(true)
    })
  })

  describe('daysJournaled', () => {
    test('counts distinct calendar days', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1) }),
          journal({ timestamp: day(2026, 3, 2) }),
          journal({ timestamp: day(2026, 6, 9) }),
        ],
        2026,
      )
      expect(review.daysJournaled).toBe(3)
    })

    test('several entries on one day count as one day', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: '2026-03-01T09:00:00.000Z' }),
          journal({ timestamp: '2026-03-01T12:00:00.000Z' }),
          journal({ timestamp: '2026-03-01T15:00:00.000Z' }),
        ],
        2026,
      )
      expect(review.daysJournaled).toBe(1)
      expect(review.totalEntries).toBe(3)
    })
  })

  describe('longestStreak', () => {
    test('is 0 for an empty year', () => {
      expect(computeYearReview([], 2026).longestStreak).toBe(0)
    })

    test('a single journaled day is a streak of 1, not 0', () => {
      expect(computeYearReview([journal({ timestamp: day(2026, 3, 1) })], 2026).longestStreak).toBe(1)
    })

    test('counts a run of consecutive days', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1) }),
          journal({ timestamp: day(2026, 3, 2) }),
          journal({ timestamp: day(2026, 3, 3) }),
        ],
        2026,
      )
      expect(review.longestStreak).toBe(3)
    })

    test('a missed day breaks the run and the longest one wins', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1) }),
          journal({ timestamp: day(2026, 3, 2) }),
          // 3 March missed.
          journal({ timestamp: day(2026, 3, 4) }),
          journal({ timestamp: day(2026, 3, 5) }),
          journal({ timestamp: day(2026, 3, 6) }),
        ],
        2026,
      )
      expect(review.longestStreak).toBe(3)
    })

    test('extra entries on the same day do not inflate the streak', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: '2026-03-01T09:00:00.000Z' }),
          journal({ timestamp: '2026-03-01T12:00:00.000Z' }),
          journal({ timestamp: '2026-03-01T18:00:00.000Z' }),
        ],
        2026,
      )
      expect(review.longestStreak).toBe(1)
    })

    test('carries across a month boundary', () => {
      // Day arithmetic must be calendar-aware: 31 Jan → 1 Feb is consecutive even
      // though the day-of-month number drops.
      const review = computeYearReview(
        [journal({ timestamp: day(2026, 1, 31) }), journal({ timestamp: day(2026, 2, 1) })],
        2026,
      )
      expect(review.longestStreak).toBe(2)
    })

    test('carries across a leap day', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2024, 2, 28) }),
          journal({ timestamp: day(2024, 2, 29) }),
          journal({ timestamp: day(2024, 3, 1) }),
        ],
        2024,
      )
      expect(review.longestStreak).toBe(3)
    })

    test('does not continue across the year boundary', () => {
      // 31 Dec belongs to the previous year's review, so the 2026 streak is 1 —
      // a review must never borrow days from a year it isn't reporting on.
      const events = [journal({ timestamp: day(2025, 12, 31) }), journal({ timestamp: day(2026, 1, 1) })]
      expect(computeYearReview(events, 2026).longestStreak).toBe(1)
      expect(computeYearReview(events, 2025).longestStreak).toBe(1)
    })

    test('finds the run even when the input is unordered', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 5, 12) }),
          journal({ timestamp: day(2026, 5, 10) }),
          journal({ timestamp: day(2026, 5, 11) }),
        ],
        2026,
      )
      expect(review.longestStreak).toBe(3)
    })
  })

  describe('distanceKm', () => {
    test('is zero when nothing in the year is located', () => {
      const review = computeYearReview(
        [journal({ timestamp: day(2026, 3, 1) }), journal({ timestamp: day(2026, 3, 2) })],
        2026,
      )
      expect(review.distanceKm).toBe(0)
      expect(review.located).toEqual([])
    })

    test('is zero for a single located entry (no hop to measure)', () => {
      const review = computeYearReview([journal({ ...at(COORDS.nuremberg) })], 2026)
      expect(review.distanceKm).toBe(0)
      expect(review.located).toHaveLength(1)
    })

    test('sums consecutive located hops in timestamp order', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), ...at(COORDS.nuremberg) }),
          journal({ timestamp: day(2026, 3, 2), ...at(COORDS.munich) }),
        ],
        2026,
      )
      expect(review.distanceKm).toBeCloseTo(150.6, 0)
    })

    test('interleaved unlocated entries do not route through Null Island', () => {
      // The bug this guards: counting the 0,0 sentinel as a waypoint would add
      // two ~5000 km legs to a 150 km year.
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), ...at(COORDS.nuremberg) }),
          journal({ timestamp: day(2026, 3, 2) }), // unlocated
          journal({ timestamp: day(2026, 3, 3) }), // unlocated
          journal({ timestamp: day(2026, 3, 4), ...at(COORDS.munich) }),
        ],
        2026,
      )
      expect(review.distanceKm).toBeCloseTo(150.6, 0)
      expect(review.located).toHaveLength(2)
      expect(review.totalEntries).toBe(4)
    })

    test('measures hops in time order, not input order', () => {
      const unordered = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 2), ...at(COORDS.munich) }),
          journal({ timestamp: day(2026, 3, 1), ...at(COORDS.nuremberg) }),
        ],
        2026,
      )
      expect(unordered.distanceKm).toBeCloseTo(150.6, 0)
      expect(unordered.located.map((e) => e.timestamp)).toEqual([day(2026, 3, 1), day(2026, 3, 2)])
    })

    test('ignores located entries from other years', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2025, 12, 31), ...at(COORDS.sydney) }),
          journal({ timestamp: day(2026, 3, 1), ...at(COORDS.nuremberg) }),
          journal({ timestamp: day(2026, 3, 2), ...at(COORDS.munich) }),
        ],
        2026,
      )
      expect(review.distanceKm).toBeCloseTo(150.6, 0)
    })

    test('places take part in the route alongside journal entries', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), ...at(COORDS.nuremberg) }),
          place({ timestamp: day(2026, 3, 2), ...at(COORDS.munich) }),
        ],
        2026,
      )
      expect(review.located).toHaveLength(2)
      expect(review.distanceKm).toBeCloseTo(150.6, 0)
    })
  })

  describe('topPlaces', () => {
    test('counts visits per place, most-visited first', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), location_name: 'Munich' }),
          journal({ timestamp: day(2026, 3, 2), location_name: 'Nuremberg' }),
          journal({ timestamp: day(2026, 3, 3), location_name: 'Nuremberg' }),
        ],
        2026,
      )
      expect(review.topPlaces).toEqual([
        { name: 'Nuremberg', count: 2 },
        { name: 'Munich', count: 1 },
      ])
    })

    test('equal counts are broken by name, so the order is stable', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), location_name: 'Zurich' }),
          journal({ timestamp: day(2026, 3, 2), location_name: 'Aarau' }),
        ],
        2026,
      )
      expect(review.topPlaces.map((p) => p.name)).toEqual(['Aarau', 'Zurich'])
    })

    test('trims names so " Munich" and "Munich" are one place', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), location_name: ' Munich ' }),
          journal({ timestamp: day(2026, 3, 2), location_name: 'Munich' }),
        ],
        2026,
      )
      expect(review.topPlaces).toEqual([{ name: 'Munich', count: 2 }])
    })

    test('ignores blank and whitespace-only place names', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), location_name: '   ' }),
          journal({ timestamp: day(2026, 3, 2) }),
          journal({ timestamp: day(2026, 3, 3), location_name: 'Munich' }),
        ],
        2026,
      )
      expect(review.topPlaces).toEqual([{ name: 'Munich', count: 1 }])
    })

    test('a place name counts even when the entry has no pin', () => {
      const review = computeYearReview([journal({ location_name: 'Somewhere' })], 2026)
      expect(review.topPlaces).toEqual([{ name: 'Somewhere', count: 1 }])
      expect(review.located).toEqual([])
    })
  })

  describe('topTags', () => {
    test('counts tags, most-used first', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), tags: ['fieldwork', 'geology'] }),
          journal({ timestamp: day(2026, 3, 2), tags: ['fieldwork'] }),
        ],
        2026,
      )
      expect(review.topTags).toEqual([
        { name: 'fieldwork', count: 2 },
        { name: 'geology', count: 1 },
      ])
    })

    test('a tag repeated on one entry counts once for that entry', () => {
      // Duplicate tags on a single entry would otherwise double its weight in the
      // leaderboard, which reads as journaling that never happened.
      const review = computeYearReview([journal({ tags: ['alps', 'alps', ' alps '] })], 2026)
      expect(review.topTags).toEqual([{ name: 'alps', count: 1 }])
    })

    test('equal counts are broken by name', () => {
      const review = computeYearReview([journal({ tags: ['weather', 'alps', 'moss'] })], 2026)
      expect(review.topTags.map((t) => t.name)).toEqual(['alps', 'moss', 'weather'])
    })

    test('ignores blank tags', () => {
      const review = computeYearReview([journal({ tags: ['', '  ', 'alps'] })], 2026)
      expect(review.topTags).toEqual([{ name: 'alps', count: 1 }])
    })

    test('is empty when nothing is tagged', () => {
      expect(computeYearReview([journal(), journal()], 2026).topTags).toEqual([])
    })
  })

  describe('moods', () => {
    test('counts moods, most-frequent first', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), mood: 'calm' }),
          journal({ timestamp: day(2026, 3, 2), mood: 'tired' }),
          journal({ timestamp: day(2026, 3, 3), mood: 'calm' }),
        ],
        2026,
      )
      expect(review.moods).toEqual([
        { name: 'calm', count: 2 },
        { name: 'tired', count: 1 },
      ])
    })

    test('equal counts are broken by name', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), mood: 'weary' }),
          journal({ timestamp: day(2026, 3, 2), mood: 'bright' }),
        ],
        2026,
      )
      expect(review.moods.map((m) => m.name)).toEqual(['bright', 'weary'])
    })

    test('entries without a mood are not counted', () => {
      const review = computeYearReview([journal({ mood: 'calm' }), journal(), place()], 2026)
      expect(review.moods).toEqual([{ name: 'calm', count: 1 }])
    })
  })

  describe('photos', () => {
    test('entriesWithPhotos counts entries carrying at least one photo', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), media_attachments: [image(), image()] }),
          journal({ timestamp: day(2026, 3, 2), media_attachments: [image()] }),
          journal({ timestamp: day(2026, 3, 3) }),
        ],
        2026,
      )
      expect(review.entriesWithPhotos).toBe(2)
    })

    test('photoCount totals every attachment across the year', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), media_attachments: [image(), image()] }),
          journal({ timestamp: day(2026, 3, 2), media_attachments: [image()] }),
        ],
        2026,
      )
      expect(review.photoCount).toBe(3)
    })

    test('audio notes are not photos', () => {
      // `media_attachments` mixes images and voice notes; only images are photos.
      const review = computeYearReview([journal({ media_attachments: [audio(), image()] })], 2026)
      expect(review.photoCount).toBe(1)
      expect(review.entriesWithPhotos).toBe(1)
    })

    test('an entry of only audio counts as no photos', () => {
      const review = computeYearReview([journal({ media_attachments: [audio()] })], 2026)
      expect(review.photoCount).toBe(0)
      expect(review.entriesWithPhotos).toBe(0)
    })

    test('a place with no media array at all is handled', () => {
      const review = computeYearReview([place()], 2026)
      expect(review.photoCount).toBe(0)
      expect(review.entriesWithPhotos).toBe(0)
    })

    test('photos on a place are counted', () => {
      const review = computeYearReview([place({ media_attachments: [image()] })], 2026)
      expect(review.photoCount).toBe(1)
      expect(review.entriesWithPhotos).toBe(1)
    })
  })

  describe('wordCount', () => {
    test('counts the words in entry bodies', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1), content_markdown: 'four words in here' }),
          journal({ timestamp: day(2026, 3, 2), content_markdown: 'two more' }),
        ],
        2026,
      )
      expect(review.wordCount).toBe(6)
    })

    test('runs of whitespace and newlines are not words', () => {
      const review = computeYearReview(
        [journal({ content_markdown: '  ridge   walk\n\nabove\tthe   cloud  ' })],
        2026,
      )
      expect(review.wordCount).toBe(5)
    })

    test('an empty body contributes nothing', () => {
      expect(computeYearReview([journal({ content_markdown: '' })], 2026).wordCount).toBe(0)
      expect(computeYearReview([journal({ content_markdown: '   ' })], 2026).wordCount).toBe(0)
    })

    test('places carry no body and so no words', () => {
      expect(computeYearReview([place()], 2026).wordCount).toBe(0)
    })
  })

  describe('busiestDay', () => {
    test('reports the day with the most entries', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 3, 1) }),
          journal({ timestamp: '2026-03-05T09:00:00.000Z' }),
          journal({ timestamp: '2026-03-05T12:00:00.000Z' }),
          journal({ timestamp: '2026-03-05T15:00:00.000Z' }),
        ],
        2026,
      )
      expect(review.busiestDay).toEqual({ dayKey: '2026-03-05', count: 3 })
    })

    test('a tie keeps the earlier day, whatever the input order', () => {
      const events = [
        journal({ timestamp: '2026-03-09T12:00:00.000Z' }),
        journal({ timestamp: '2026-03-02T12:00:00.000Z' }),
        journal({ timestamp: '2026-03-09T14:00:00.000Z' }),
        journal({ timestamp: '2026-03-02T14:00:00.000Z' }),
      ]
      expect(computeYearReview(events, 2026).busiestDay).toEqual({ dayKey: '2026-03-02', count: 2 })
      expect(computeYearReview(events.slice().reverse(), 2026).busiestDay).toEqual({
        dayKey: '2026-03-02',
        count: 2,
      })
    })

    test('a lone entry is its own busiest day', () => {
      const review = computeYearReview([journal({ timestamp: day(2026, 3, 1) })], 2026)
      expect(review.busiestDay).toEqual({ dayKey: '2026-03-01', count: 1 })
    })

    test('is null for an empty year', () => {
      expect(computeYearReview([], 2026).busiestDay).toBeNull()
    })
  })

  describe('trips', () => {
    test('lists distinct trip names, newest-ending first', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 1, 10), trip: 'Baltic' }),
          journal({ timestamp: day(2026, 8, 10), trip: 'Alps 2026' }),
          journal({ timestamp: day(2026, 8, 12), trip: 'Alps 2026' }),
          journal({ timestamp: day(2026, 5, 3), trip: 'Harz' }),
        ],
        2026,
      )
      expect(review.trips).toEqual(['Alps 2026', 'Harz', 'Baltic'])
    })

    test('only trips with an entry inside the year are listed', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2025, 8, 1), trip: 'Last year' }),
          journal({ timestamp: day(2026, 8, 1), trip: 'This year' }),
        ],
        2026,
      )
      expect(review.trips).toEqual(['This year'])
    })

    test('untagged and whitespace-named entries add no trips', () => {
      const review = computeYearReview([journal(), journal({ trip: '   ' })], 2026)
      expect(review.trips).toEqual([])
    })
  })

  describe('firstEntry and lastEntry', () => {
    test('bracket the year', () => {
      const review = computeYearReview(
        [
          journal({ timestamp: day(2026, 6, 6) }),
          journal({ timestamp: day(2026, 1, 4) }),
          journal({ timestamp: day(2026, 11, 30) }),
        ],
        2026,
      )
      expect(review.firstEntry).toBe(day(2026, 1, 4))
      expect(review.lastEntry).toBe(day(2026, 11, 30))
    })

    test('a single entry is both first and last', () => {
      const review = computeYearReview([journal({ timestamp: day(2026, 6, 6) })], 2026)
      expect(review.firstEntry).toBe(day(2026, 6, 6))
      expect(review.lastEntry).toBe(day(2026, 6, 6))
    })
  })

  test('handles a large journal without pathological cost', () => {
    // 3000 entries spread over three years, one every 6 hours from 1 Jan 2025.
    const events = Array.from({ length: 3000 }, (_, i) =>
      journal({
        timestamp: new Date(Date.UTC(2025, 0, 1, 12) + i * 6 * 3600_000).toISOString(),
        tags: [`tag-${i % 7}`],
        location_name: `Place ${i % 11}`,
        longitude: 11 + (i % 100) / 1000,
        latitude: 49 + (i % 100) / 1000,
        content_markdown: 'one two three',
      }),
    )
    const years = journalYears(events)
    expect(years).toEqual([2027, 2026, 2025])

    const review = computeYearReview(events, 2026)
    expect(review.totalEntries).toBe(365 * 4)
    expect(review.entriesPerMonth.reduce((a, b) => a + b, 0)).toBe(review.totalEntries)
    expect(review.daysJournaled).toBe(365)
    expect(review.longestStreak).toBe(365)
    expect(review.topTags).toHaveLength(7)
    expect(review.topPlaces).toHaveLength(11)
    expect(review.wordCount).toBe(365 * 4 * 3)
    expect(review.located).toHaveLength(365 * 4)

    const total = years.reduce((n, y) => n + computeYearReview(events, y).totalEntries, 0)
    expect(total).toBe(3000)
  })
})
