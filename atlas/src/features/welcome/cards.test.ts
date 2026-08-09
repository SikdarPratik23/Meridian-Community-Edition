/**
 * Unit tests for the welcome-card registry.
 *
 * `reconcileOrder` is the self-healing step that runs against a user's SAVED
 * order every load. It has to survive two version drifts: a card added since the
 * order was saved (must appear, not vanish) and a card removed since (must be
 * dropped, not crash the renderer). Both have bitten this app before — the
 * `'prompt'` card was removed in July 2026 and stale saved orders still name it.
 */
import { describe, expect, test } from 'vitest'
import {
  WELCOME_CARDS,
  WELCOME_CARD_IDS,
  WELCOME_CARD_META,
  defaultHiddenCards,
  reconcileOrder,
} from './cards'

describe('the registry itself', () => {
  test('every card id is unique', () => {
    expect(new Set(WELCOME_CARD_IDS).size).toBe(WELCOME_CARD_IDS.length)
  })

  test('WELCOME_CARD_IDS mirrors WELCOME_CARDS in order', () => {
    expect(WELCOME_CARD_IDS).toEqual(WELCOME_CARDS.map((c) => c.id))
  })

  test('every card has a label and a hint for the settings UI', () => {
    for (const card of WELCOME_CARDS) {
      expect(card.label.length).toBeGreaterThan(0)
      expect(card.hint.length).toBeGreaterThan(0)
    }
  })

  test('the meta lookup resolves every id', () => {
    for (const id of WELCOME_CARD_IDS) {
      expect(WELCOME_CARD_META[id].id).toBe(id)
    }
  })

  test('the removed "prompt" card is really gone from the registry', () => {
    // It lives inside the Today's-focus card now, not as a reorderable row.
    expect(WELCOME_CARD_IDS).not.toContain('prompt')
  })

  test('the POI card is the only one that needs the network', () => {
    const online = WELCOME_CARDS.filter((c) => c.online).map((c) => c.id)
    expect(online).toEqual(['poi'])
  })
})

describe('defaultHiddenCards', () => {
  test('all current cards are on by default, so nothing is hidden', () => {
    expect(defaultHiddenCards()).toEqual([])
  })
})

describe('reconcileOrder', () => {
  test('undefined (a fresh install) yields the canonical order', () => {
    expect(reconcileOrder(undefined)).toEqual(WELCOME_CARD_IDS)
  })

  test('an empty saved order yields the canonical order', () => {
    expect(reconcileOrder([])).toEqual(WELCOME_CARD_IDS)
  })

  test('a complete saved order is preserved exactly', () => {
    const saved = ['poi', 'almanac', 'holidays']
    expect(reconcileOrder(saved)).toEqual(saved)
  })

  test('a card added since the order was saved is APPENDED, not dropped', () => {
    // The saved order predates 'poi'; it must still show up, at the bottom.
    expect(reconcileOrder(['almanac', 'holidays'])).toEqual(['almanac', 'holidays', 'poi'])
  })

  test('a card removed since the order was saved is dropped', () => {
    // 'prompt' was a real card once; a stale saved order must self-heal.
    expect(reconcileOrder(['almanac', 'prompt', 'holidays'])).toEqual([
      'almanac',
      'holidays',
      'poi',
    ])
  })

  test('unknown junk ids are ignored', () => {
    expect(reconcileOrder(['nonsense', 'almanac', ''])).toEqual(['almanac', 'holidays', 'poi'])
  })

  test('a duplicated id appears only once, at its first position', () => {
    expect(reconcileOrder(['poi', 'almanac', 'poi'])).toEqual(['poi', 'almanac', 'holidays'])
  })

  test('the result always contains every known card exactly once', () => {
    for (const saved of [
      undefined,
      [],
      ['poi'],
      ['prompt', 'nonsense'],
      ['holidays', 'holidays', 'almanac'],
      [...WELCOME_CARD_IDS].reverse(),
    ]) {
      const out = reconcileOrder(saved)
      expect([...out].sort()).toEqual([...WELCOME_CARD_IDS].sort())
    }
  })

  test('is idempotent — reconciling its own output changes nothing', () => {
    const once = reconcileOrder(['prompt', 'poi'])
    expect(reconcileOrder(once)).toEqual(once)
  })

  test('does not mutate the array it is given', () => {
    const saved = ['almanac', 'prompt']
    reconcileOrder(saved)
    expect(saved).toEqual(['almanac', 'prompt'])
  })
})
