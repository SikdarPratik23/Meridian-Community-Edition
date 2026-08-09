/**
 * Unit tests for search filtering.
 *
 * The behaviours worth pinning: filters combine with AND, an inactive filter set
 * returns nothing (not the whole journal), tombstones never surface, and "Near me"
 * without a known centre degrades to ignoring the spatial filter rather than
 * silently returning zero results.
 */
import { describe, expect, test } from 'vitest'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  availableMoods,
  availableTags,
  isFilterActive,
  matchesQuery,
  type SearchFilters,
} from './filters'
import { COORDS, audio, image, journal, place } from '../../test/factories'

const filters = (over: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...over })
const ids = (results: ReturnType<typeof applyFilters>) => results.map((r) => r.event.id)

describe('activeFilterCount / isFilterActive', () => {
  test('nothing is active by default', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(isFilterActive(EMPTY_FILTERS)).toBe(false)
  })

  test('a text query counts', () => {
    expect(activeFilterCount(filters({ query: 'alps' }))).toBe(1)
  })

  test('a whitespace-only query does not count', () => {
    expect(activeFilterCount(filters({ query: '   ' }))).toBe(0)
  })

  test('each chip adds one', () => {
    expect(
      activeFilterCount(
        filters({ hasPhoto: true, hasAudio: true, hasLocation: true, nearMe: true }),
      ),
    ).toBe(4)
  })

  test('mood, trip and both date bounds each count', () => {
    expect(
      activeFilterCount(filters({ mood: 'calm', trip: 'Alps', from: '2026-01-01', to: '2026-12-31' })),
    ).toBe(4)
  })

  test('the radius alone does not count — it only matters with Near me', () => {
    expect(activeFilterCount(filters({ radiusKm: 50 }))).toBe(0)
  })
})

describe('matchesQuery', () => {
  const entry = journal({
    title: 'Summit day',
    content_markdown: 'The air was thin and cold.',
    location_name: 'Zugspitze',
    tags: ['hiking', 'alps'],
    trip: 'Alps 2026',
  })

  test('an empty query matches everything', () => {
    expect(matchesQuery(entry, '')).toBe(true)
    expect(matchesQuery(entry, '   ')).toBe(true)
  })

  test('matches the title', () => {
    expect(matchesQuery(entry, 'summit')).toBe(true)
  })

  test('matches the body', () => {
    expect(matchesQuery(entry, 'thin and cold')).toBe(true)
  })

  test('matches the place name', () => {
    expect(matchesQuery(entry, 'zugspitze')).toBe(true)
  })

  test('matches a tag', () => {
    expect(matchesQuery(entry, 'hiking')).toBe(true)
  })

  test('matches the trip name', () => {
    expect(matchesQuery(entry, 'alps 2026')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(matchesQuery(entry, 'SUMMIT')).toBe(true)
    expect(matchesQuery(entry, 'ZuGsPiTzE')).toBe(true)
  })

  test('matches partial words', () => {
    expect(matchesQuery(entry, 'summ')).toBe(true)
  })

  test('does not match absent text', () => {
    expect(matchesQuery(entry, 'volcano')).toBe(false)
  })

  test('matches Bengali content', () => {
    const bengali = journal({ content_markdown: 'আজ আমি হাঁটলাম' })
    expect(matchesQuery(bengali, 'হাঁটলাম')).toBe(true)
  })

  test('a place entry has no body but still matches its title', () => {
    expect(matchesQuery(place({ title: 'Cafe Kranzler' }), 'kranzler')).toBe(true)
  })
})

describe('applyFilters', () => {
  test('returns nothing when no filter is active', () => {
    // The timeline is for browsing everything; search shows results only once
    // the user has actually asked for something.
    expect(applyFilters([journal(), journal()], EMPTY_FILTERS, null)).toEqual([])
  })

  test('excludes tombstoned entries', () => {
    const results = applyFilters(
      [
        journal({ id: 'live', title: 'alps' }),
        journal({ id: 'dead', title: 'alps', deleted_at: '2026-08-01T00:00:00.000Z' }),
      ],
      filters({ query: 'alps' }),
      null,
    )
    expect(ids(results)).toEqual(['live'])
  })

  test('filters by text query', () => {
    const results = applyFilters(
      [journal({ id: 'a', title: 'Alps' }), journal({ id: 'b', title: 'Baltic' })],
      filters({ query: 'alps' }),
      null,
    )
    expect(ids(results)).toEqual(['a'])
  })

  describe('attachment chips', () => {
    const withPhoto = journal({ id: 'photo', media_attachments: [image()] })
    const withAudio = journal({ id: 'audio', media_attachments: [audio()] })
    const withBoth = journal({ id: 'both', media_attachments: [image(), audio()] })
    const withNone = journal({ id: 'none' })
    const all = [withPhoto, withAudio, withBoth, withNone]

    test('hasPhoto keeps only entries with an image', () => {
      expect(ids(applyFilters(all, filters({ hasPhoto: true }), null)).sort()).toEqual([
        'both',
        'photo',
      ])
    })

    test('hasAudio keeps only entries with audio', () => {
      expect(ids(applyFilters(all, filters({ hasAudio: true }), null)).sort()).toEqual([
        'audio',
        'both',
      ])
    })

    test('hasPhoto AND hasAudio requires both', () => {
      expect(ids(applyFilters(all, filters({ hasPhoto: true, hasAudio: true }), null))).toEqual([
        'both',
      ])
    })

    test('an entry with an empty attachment array is excluded', () => {
      const empty = journal({ id: 'empty', media_attachments: [] })
      expect(ids(applyFilters([empty], filters({ hasPhoto: true }), null))).toEqual([])
    })

    test('a place entry without the field is excluded, not a crash', () => {
      expect(ids(applyFilters([place({ id: 'p' })], filters({ hasPhoto: true }), null))).toEqual([])
    })
  })

  describe('hasLocation', () => {
    test('keeps only pinned entries', () => {
      const results = applyFilters(
        [
          journal({ id: 'pinned', longitude: 11, latitude: 49 }),
          journal({ id: 'unpinned' }),
        ],
        filters({ hasLocation: true }),
        null,
      )
      expect(ids(results)).toEqual(['pinned'])
    })

    test('treats the 0,0 sentinel as unlocated', () => {
      expect(
        ids(applyFilters([journal({ id: 'zero', longitude: 0, latitude: 0 })], filters({ hasLocation: true }), null)),
      ).toEqual([])
    })

    test('an entry on the equator alone IS located', () => {
      expect(
        ids(applyFilters([journal({ id: 'eq', longitude: 11, latitude: 0 })], filters({ hasLocation: true }), null)),
      ).toEqual(['eq'])
    })
  })

  describe('mood and trip', () => {
    test('mood matches exactly', () => {
      const results = applyFilters(
        [journal({ id: 'a', mood: 'calm' }), journal({ id: 'b', mood: 'elated' })],
        filters({ mood: 'calm' }),
        null,
      )
      expect(ids(results)).toEqual(['a'])
    })

    test('an entry with no mood is excluded by a mood filter', () => {
      expect(ids(applyFilters([journal({ id: 'a' })], filters({ mood: 'calm' }), null))).toEqual([])
    })

    test('trip matches exactly, after trimming', () => {
      const results = applyFilters(
        [journal({ id: 'a', trip: ' Alps 2026 ' }), journal({ id: 'b', trip: 'Baltic' })],
        filters({ trip: 'Alps 2026' }),
        null,
      )
      expect(ids(results)).toEqual(['a'])
    })

    test('an untagged entry is excluded by a trip filter', () => {
      expect(ids(applyFilters([journal({ id: 'a' })], filters({ trip: 'Alps' }), null))).toEqual([])
    })
  })

  describe('date range', () => {
    const june = journal({ id: 'june', timestamp: '2026-06-15T12:00:00.000Z' })
    const july = journal({ id: 'july', timestamp: '2026-07-15T12:00:00.000Z' })
    const august = journal({ id: 'august', timestamp: '2026-08-15T12:00:00.000Z' })
    const all = [june, july, august]

    test('from is inclusive', () => {
      expect(ids(applyFilters(all, filters({ from: '2026-07-15' }), null)).sort()).toEqual([
        'august',
        'july',
      ])
    })

    test('to is inclusive', () => {
      expect(ids(applyFilters(all, filters({ to: '2026-07-15' }), null)).sort()).toEqual([
        'july',
        'june',
      ])
    })

    test('both bounds together form a closed range', () => {
      expect(ids(applyFilters(all, filters({ from: '2026-07-01', to: '2026-07-31' }), null))).toEqual(
        ['july'],
      )
    })

    test('a single-day range matches that day only', () => {
      expect(
        ids(applyFilters(all, filters({ from: '2026-07-15', to: '2026-07-15' }), null)),
      ).toEqual(['july'])
    })

    test('an impossible range matches nothing', () => {
      expect(ids(applyFilters(all, filters({ from: '2026-09-01', to: '2026-01-01' }), null))).toEqual(
        [],
      )
    })
  })

  describe('Near me', () => {
    const near = journal({ id: 'near', longitude: 11.08, latitude: 49.45 }) // ~0 km
    const far = journal({ id: 'far', longitude: COORDS.munich[0], latitude: COORDS.munich[1] }) // ~150 km
    const unlocated = journal({ id: 'unlocated' })
    const all = [near, far, unlocated]

    test('keeps entries within the radius', () => {
      expect(ids(applyFilters(all, filters({ nearMe: true, radiusKm: 10 }), COORDS.nuremberg))).toEqual(
        ['near'],
      )
    })

    test('a wider radius reaches further', () => {
      expect(
        ids(applyFilters(all, filters({ nearMe: true, radiusKm: 200 }), COORDS.nuremberg)).sort(),
      ).toEqual(['far', 'near'])
    })

    test('excludes unlocated entries', () => {
      const results = applyFilters(all, filters({ nearMe: true, radiusKm: 20000 }), COORDS.nuremberg)
      expect(ids(results)).not.toContain('unlocated')
    })

    test('sorts nearest first', () => {
      expect(
        ids(applyFilters(all, filters({ nearMe: true, radiusKm: 500 }), COORDS.nuremberg)),
      ).toEqual(['near', 'far'])
    })

    test('reports the distance for each result', () => {
      const results = applyFilters(all, filters({ nearMe: true, radiusKm: 500 }), COORDS.nuremberg)
      expect(results[0].distanceKm).toBeCloseTo(0, 0)
      expect(results[1].distanceKm).toBeCloseTo(150.6, 0)
    })

    test('without a known centre, the spatial filter is IGNORED rather than emptying the list', () => {
      // Returning nothing here would look like a bug to the user — they asked to
      // search near themselves and the app doesn't know where that is yet.
      const results = applyFilters(all, filters({ nearMe: true, radiusKm: 1 }), null)
      expect(ids(results).sort()).toEqual(['far', 'near', 'unlocated'])
    })

    test('distance is null when no centre is known', () => {
      const results = applyFilters(all, filters({ nearMe: true }), null)
      expect(results.every((r) => r.distanceKm === null)).toBe(true)
    })
  })

  describe('combining filters', () => {
    test('filters narrow with AND', () => {
      const events = [
        journal({ id: 'match', title: 'Alps', mood: 'calm', media_attachments: [image()] }),
        journal({ id: 'wrongMood', title: 'Alps', mood: 'tired', media_attachments: [image()] }),
        journal({ id: 'noPhoto', title: 'Alps', mood: 'calm' }),
        journal({ id: 'wrongText', title: 'Baltic', mood: 'calm', media_attachments: [image()] }),
      ]
      const results = applyFilters(
        events,
        filters({ query: 'alps', mood: 'calm', hasPhoto: true }),
        null,
      )
      expect(ids(results)).toEqual(['match'])
    })

    test('text plus Near me applies both', () => {
      const events = [
        journal({ id: 'both', title: 'Alps', longitude: 11.08, latitude: 49.45 }),
        journal({ id: 'textOnly', title: 'Alps', longitude: COORDS.berlin[0], latitude: COORDS.berlin[1] }),
        journal({ id: 'nearOnly', title: 'Baltic', longitude: 11.08, latitude: 49.45 }),
      ]
      const results = applyFilters(
        events,
        filters({ query: 'alps', nearMe: true, radiusKm: 10 }),
        COORDS.nuremberg,
      )
      expect(ids(results)).toEqual(['both'])
    })
  })

  test('non-spatial results are newest first', () => {
    const results = applyFilters(
      [
        journal({ id: 'old', title: 'x', timestamp: '2026-01-01T00:00:00.000Z' }),
        journal({ id: 'new', title: 'x', timestamp: '2026-08-01T00:00:00.000Z' }),
        journal({ id: 'mid', title: 'x', timestamp: '2026-04-01T00:00:00.000Z' }),
      ],
      filters({ query: 'x' }),
      null,
    )
    expect(ids(results)).toEqual(['new', 'mid', 'old'])
  })

  test('does not mutate the input array', () => {
    const events = [
      journal({ id: 'a', title: 'x', timestamp: '2026-01-01T00:00:00.000Z' }),
      journal({ id: 'b', title: 'x', timestamp: '2026-08-01T00:00:00.000Z' }),
    ]
    applyFilters(events, filters({ query: 'x' }), null)
    expect(events.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('availableMoods', () => {
  test('lists distinct moods alphabetically', () => {
    const moods = availableMoods([
      journal({ mood: 'tired' }),
      journal({ mood: 'calm' }),
      journal({ mood: 'calm' }),
    ])
    expect(moods).toEqual(['calm', 'tired'])
  })

  test('ignores blank moods, tombstones and place entries', () => {
    expect(
      availableMoods([
        journal({ mood: '  ' }),
        journal({ mood: 'gone', deleted_at: '2026-08-01T00:00:00.000Z' }),
        place(),
        journal({ mood: 'kept' }),
      ]),
    ).toEqual(['kept'])
  })

  test('is empty for an empty journal', () => {
    expect(availableMoods([])).toEqual([])
  })
})

describe('availableTags', () => {
  test('orders by use count, then alphabetically', () => {
    const tags = availableTags([
      journal({ tags: ['alps', 'hiking'] }),
      journal({ tags: ['hiking'] }),
      journal({ tags: ['hiking', 'winter'] }),
    ])
    expect(tags).toEqual(['hiking', 'alps', 'winter'])
  })

  test('trims and ignores blank tags', () => {
    expect(availableTags([journal({ tags: [' alps ', '', '  '] })])).toEqual(['alps'])
  })

  test('ignores tombstones', () => {
    expect(
      availableTags([journal({ tags: ['gone'], deleted_at: '2026-08-01T00:00:00.000Z' })]),
    ).toEqual([])
  })
})
