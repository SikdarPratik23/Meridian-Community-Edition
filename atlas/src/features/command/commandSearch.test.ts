/**
 * Unit tests for the command palette's fuzzy matcher.
 *
 * A palette lives or dies on whether the obvious thing comes FIRST, which is
 * exactly what's tedious to check by clicking and easy to assert here. So most of
 * these tests are comparative — "this should outrank that" — rather than checking
 * absolute scores, which are an implementation detail free to change.
 */
import { describe, expect, test } from 'vitest'
import { fuzzyMatch, highlightParts, rank } from './commandSearch'

/** Score a query against a text, or -Infinity when it doesn't match at all. */
const score = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? -Infinity

describe('fuzzyMatch — what matches at all', () => {
  test('an exact match matches', () => {
    expect(fuzzyMatch('summit', 'summit')).not.toBeNull()
  })

  test('a prefix matches', () => {
    expect(fuzzyMatch('sum', 'summit day')).not.toBeNull()
  })

  test('a subsequence matches even with gaps', () => {
    expect(fuzzyMatch('smt', 'summit')).not.toBeNull()
  })

  test('initials match a multi-word label', () => {
    expect(fuzzyMatch('ny', 'New York')).not.toBeNull()
  })

  test('is case-insensitive both ways', () => {
    expect(fuzzyMatch('SUMMIT', 'summit day')).not.toBeNull()
    expect(fuzzyMatch('summit', 'SUMMIT DAY')).not.toBeNull()
  })

  test('leading and trailing query whitespace is ignored', () => {
    expect(fuzzyMatch('  sum  ', 'summit')).not.toBeNull()
  })

  test('out-of-order characters do NOT match', () => {
    // Order is the whole point of a subsequence match.
    expect(fuzzyMatch('tim', 'summit')).toBeNull()
  })

  test('a character absent from the text does not match', () => {
    expect(fuzzyMatch('summitz', 'summit')).toBeNull()
  })

  test('a query longer than the text does not match', () => {
    expect(fuzzyMatch('summit day', 'summit')).toBeNull()
  })

  test('an empty query matches everything with score 0', () => {
    // Keeps the palette's default listing in its natural order.
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
    expect(fuzzyMatch('   ', 'anything')).toEqual({ score: 0, indices: [] })
  })

  test('matches unicode text, including Bengali', () => {
    expect(fuzzyMatch('হাঁ', 'হাঁটা')).not.toBeNull()
  })

  test('reports the indices that matched', () => {
    // 'summit' is s-u-m-m-i-t, so the 'm' is found at 2 (the FIRST m, searching
    // forward from the 's'), not at 3.
    expect(fuzzyMatch('sm', 'summit')!.indices).toEqual([0, 2])
  })

  test('indices are strictly increasing', () => {
    const { indices } = fuzzyMatch('smt', 'summit day')!
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1])
    }
  })
})

describe('fuzzyMatch — ranking behaviour', () => {
  test('a match at the start beats a match in the middle', () => {
    expect(score('day', 'day at the lake')).toBeGreaterThan(score('day', 'a long summer day'))
  })

  test('a word-start match beats a mid-word match', () => {
    expect(score('york', 'New York')).toBeGreaterThan(score('ork', 'Corking'))
  })

  test('consecutive characters beat scattered ones', () => {
    expect(score('sum', 'summit')).toBeGreaterThan(score('sum', 'sunny umbrella'))
  })

  test('a shorter label beats a longer one for the same match', () => {
    expect(score('alps', 'Alps')).toBeGreaterThan(
      score('alps', 'Alps and the long walk back down again'),
    )
  })

  test('an exact match beats a prefix match of a longer label', () => {
    expect(score('alps', 'Alps')).toBeGreaterThan(score('alps', 'Alps 2026'))
  })

  test('a tighter gap beats a wider one', () => {
    expect(score('ab', 'axb')).toBeGreaterThan(score('ab', 'axxxxxxxxb'))
  })
})

describe('rank', () => {
  const item = (label: string, keywords?: string[]) => ({ label, keywords })

  test('returns only matching items', () => {
    // NB 'al' IS a subsequence of "Baltic" (b-A-L-tic), which is correct fuzzy
    // behaviour — so this uses a query that genuinely only matches one candidate.
    const results = rank([item('Alps'), item('Baltic'), item('Andes')], 'alp')
    expect(results.map((r) => r.item.label)).toEqual(['Alps'])
  })

  test('a subsequence spanning a word IS a match, by design', () => {
    // Documents the looseness deliberately: scoring, not filtering, is what keeps
    // the obvious result on top.
    expect(rank([item('Baltic')], 'al')).toHaveLength(1)
  })

  test('orders best match first', () => {
    const results = rank([item('The Alps trip'), item('Alps'), item('Alpine meadow')], 'alps')
    expect(results[0].item.label).toBe('Alps')
  })

  test('an empty query returns everything in its original order', () => {
    const items = [item('Zebra'), item('Apple'), item('Mango')]
    expect(rank(items, '').map((r) => r.item.label)).toEqual(['Zebra', 'Apple', 'Mango'])
  })

  test('respects the limit', () => {
    const items = Array.from({ length: 100 }, (_, i) => item(`Entry ${i}`))
    expect(rank(items, 'entry', 10)).toHaveLength(10)
  })

  test('matches on invisible keywords', () => {
    const results = rank([item('Toggle theme', ['dark', 'light', 'night'])], 'dark')
    expect(results).toHaveLength(1)
  })

  test('a label match outranks the same match in a keyword', () => {
    // A result whose visible text explains why it matched should come first.
    const results = rank([item('Something else', ['alps']), item('Alps')], 'alps')
    expect(results[0].item.label).toBe('Alps')
  })

  test('a keyword match reports no highlight indices', () => {
    const results = rank([item('Toggle theme', ['dark'])], 'dark')
    expect(results[0].indices).toEqual([])
  })

  test('ordering is deterministic for equal scores', () => {
    // Without a stable tie-break, equally-scored rows shuffle between keystrokes,
    // which reads as flicker in the palette.
    const items = [item('Beta'), item('Alpha'), item('Gamma')]
    const first = rank(items, 'a').map((r) => r.item.label)
    const second = rank(items, 'a').map((r) => r.item.label)
    expect(first).toEqual(second)
  })

  test('does not mutate the input array', () => {
    const items = [item('Zebra'), item('Apple')]
    rank(items, 'a')
    expect(items.map((i) => i.label)).toEqual(['Zebra', 'Apple'])
  })

  test('handles an empty candidate list', () => {
    expect(rank([], 'anything')).toEqual([])
  })

  test('copes with a realistic journal-sized candidate list', () => {
    const items = Array.from({ length: 3000 }, (_, i) => item(`Entry number ${i} in the field`))
    const results = rank(items, 'entry 42')
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(40)
  })
})

describe('highlightParts', () => {
  test('no indices means one unmatched run', () => {
    expect(highlightParts('Alps', [])).toEqual([{ text: 'Alps', match: false }])
  })

  test('splits a leading match', () => {
    expect(highlightParts('Alps', [0, 1])).toEqual([
      { text: 'Al', match: true },
      { text: 'ps', match: false },
    ])
  })

  test('splits a trailing match', () => {
    expect(highlightParts('Alps', [2, 3])).toEqual([
      { text: 'Al', match: false },
      { text: 'ps', match: true },
    ])
  })

  test('splits scattered matches into alternating runs', () => {
    expect(highlightParts('summit', [0, 3])).toEqual([
      { text: 's', match: true },
      { text: 'um', match: false },
      { text: 'm', match: true },
      { text: 'it', match: false },
    ])
  })

  test('a fully matched label is a single matched run', () => {
    expect(highlightParts('abc', [0, 1, 2])).toEqual([{ text: 'abc', match: true }])
  })

  test('the parts always reassemble into the original label', () => {
    for (const [label, indices] of [
      ['Summit day', [0, 3, 7]],
      ['Alps', [1]],
      ['হাঁটা', [0]],
      ['x', [0]],
    ] as Array<[string, number[]]>) {
      expect(highlightParts(label, indices).map((p) => p.text).join('')).toBe(label)
    }
  })

  test('round-trips with fuzzyMatch output', () => {
    const label = 'Zugspitze summit'
    const match = fuzzyMatch('zsum', label)!
    const parts = highlightParts(label, match.indices)
    expect(parts.map((p) => p.text).join('')).toBe(label)
    expect(parts.some((p) => p.match)).toBe(true)
  })
})
