/**
 * Unit tests for the "Today's focus" side selection.
 *
 * Two behaviours here are worth pinning down. The **default side is the prompt**
 * (changed 2026-08-05 at the user's request), which is easy to flip back by
 * accident while editing the fallback chain. And a `preferred` side that has since
 * become unavailable must NOT be honoured — a stale preference would strand the
 * card on a view with nothing in it, which reads as a broken card rather than as
 * "no signal".
 */
import { describe, expect, test } from 'vitest'
import { focusMode } from './focusMode'

describe('focusMode', () => {
  describe('with no preference expressed', () => {
    test('shows the PROMPT when both sides are available', () => {
      // The headline behaviour: opening the app invites you to write, rather than
      // showing a photograph of somewhere else.
      expect(focusMode(null, true, true)).toBe('prompt')
    })

    test('shows the prompt when no place is available', () => {
      expect(focusMode(null, true, false)).toBe('prompt')
    })

    test('falls back to a place when the prompt is switched off', () => {
      expect(focusMode(null, false, true)).toBe('place')
    })
  })

  describe('honouring an explicit toggle', () => {
    test('a chosen place wins over the default', () => {
      expect(focusMode('place', true, true)).toBe('place')
    })

    test('a chosen prompt is kept even when a place is available', () => {
      expect(focusMode('prompt', true, true)).toBe('prompt')
    })
  })

  describe('when a preference has gone stale', () => {
    test('a chosen place is abandoned once no place is available', () => {
      // Lookups switched off, or the signal (and so the pool) was lost.
      expect(focusMode('place', true, false)).toBe('prompt')
    })

    test('a chosen prompt is abandoned once the prompt is switched off', () => {
      expect(focusMode('prompt', false, true)).toBe('place')
    })
  })

  test('never returns a side the card cannot render, whatever the inputs', () => {
    // With neither side available DailyFocus renders nothing at all, so the return
    // value is unused — but every reachable combination must be self-consistent.
    for (const preferred of [null, 'prompt', 'place'] as const) {
      for (const canPrompt of [true, false]) {
        for (const canPlace of [true, false]) {
          if (!canPrompt && !canPlace) continue
          const mode = focusMode(preferred, canPrompt, canPlace)
          const available = mode === 'prompt' ? canPrompt : canPlace
          expect(available, `focusMode(${preferred}, ${canPrompt}, ${canPlace}) → ${mode}`).toBe(true)
        }
      }
    }
  })
})
