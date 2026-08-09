/**
 * Unit tests for the anti-repetition picker.
 *
 * `pickFresh` is what stops the almanac fact and writing prompt repeating on
 * consecutive visits. The two failure modes it must avoid: locking up (a recency
 * window as large as the pool would leave nothing to choose from) and throwing
 * when localStorage is unavailable (Safari private mode, storage full).
 */
import { describe, expect, test, vi } from 'vitest'
import { pickFresh } from './pickFresh'

const KEY = (bucket: string) => `meridian_seen:${bucket}`

describe('pickFresh', () => {
  test('returns undefined for an empty pool', () => {
    expect(pickFresh('empty', [])).toBeUndefined()
  })

  test('returns the only item when the pool has one', () => {
    expect(pickFresh('single', ['only'])).toBe('only')
  })

  test('a single-item pool keeps returning it forever', () => {
    // cap = min(1 - 1, 50) = 0, so nothing is ever remembered and the one item
    // stays eligible. Without that guard this would return undefined.
    for (let i = 0; i < 5; i++) expect(pickFresh('single', ['only'])).toBe('only')
  })

  test('always returns a member of the pool', () => {
    const items = ['a', 'b', 'c', 'd']
    for (let i = 0; i < 20; i++) {
      expect(items).toContain(pickFresh('members', items))
    }
  })

  test('records the chosen item as recently seen', () => {
    const chosen = pickFresh('records', ['a', 'b', 'c'])
    expect(JSON.parse(localStorage.getItem(KEY('records'))!)).toContain(chosen)
  })

  test('does not repeat an item while fresher ones remain', () => {
    // With 3 items the recency cap is 2, so three successive picks must be the
    // three distinct items in some order.
    const items = ['a', 'b', 'c']
    const picks = [
      pickFresh('cycle', items),
      pickFresh('cycle', items),
      pickFresh('cycle', items),
    ]
    expect(new Set(picks).size).toBe(3)
  })

  test('resets once the pool is exhausted rather than returning undefined', () => {
    const items = ['a', 'b', 'c']
    const picks = Array.from({ length: 12 }, () => pickFresh('reset', items))
    expect(picks.every((p) => p !== undefined)).toBe(true)
    expect(new Set(picks).size).toBe(3)
  })

  test('never lets the recency window swallow the whole pool', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    for (let i = 0; i < 50; i++) expect(pickFresh('window', items)).toBeDefined()
    const recent = JSON.parse(localStorage.getItem(KEY('window'))!)
    expect(recent.length).toBeLessThanOrEqual(items.length - 1)
  })

  test('caps the remembered window at 50 for a large pool', () => {
    const items = Array.from({ length: 200 }, (_, i) => `item-${i}`)
    for (let i = 0; i < 80; i++) pickFresh('big', items)
    expect(JSON.parse(localStorage.getItem(KEY('big'))!).length).toBeLessThanOrEqual(50)
  })

  test('buckets are independent', () => {
    pickFresh('bucket-a', ['a', 'b', 'c'])
    expect(localStorage.getItem(KEY('bucket-b'))).toBeNull()
  })

  test('uses the supplied idOf for object pools', () => {
    const items = [{ id: 'x', text: 'one' }, { id: 'y', text: 'two' }]
    const chosen = pickFresh('objects', items, (i) => i.id)!
    expect(JSON.parse(localStorage.getItem(KEY('objects'))!)).toEqual([chosen.id])
  })

  test('object pools cycle through every member', () => {
    const items = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    const picks = Array.from({ length: 3 }, () => pickFresh('objcycle', items, (i) => i.id)!.id)
    expect(new Set(picks).size).toBe(3)
  })

  describe('storage failures degrade to a plain random pick', () => {
    test('unreadable storage still returns an item', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      expect(['a', 'b', 'c']).toContain(pickFresh('unreadable', ['a', 'b', 'c']))
    })

    test('unwritable storage (quota exceeded) still returns an item', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      expect(['a', 'b', 'c']).toContain(pickFresh('unwritable', ['a', 'b', 'c']))
    })

    test('corrupt JSON in storage is ignored', () => {
      localStorage.setItem(KEY('corrupt'), 'not json{')
      expect(['a', 'b', 'c']).toContain(pickFresh('corrupt', ['a', 'b', 'c']))
    })

    test('a non-array value in storage is ignored', () => {
      localStorage.setItem(KEY('notarray'), '{"seen":true}')
      expect(['a', 'b', 'c']).toContain(pickFresh('notarray', ['a', 'b', 'c']))
    })
  })

  test('stale ids from a changed pool do not block picking', () => {
    // The pool's contents change between app versions; ids that no longer exist
    // must not count against the new pool.
    localStorage.setItem(KEY('stale'), JSON.stringify(['gone-1', 'gone-2', 'gone-3']))
    expect(['a', 'b']).toContain(pickFresh('stale', ['a', 'b']))
  })
})
