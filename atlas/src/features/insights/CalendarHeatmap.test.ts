/**
 * Unit tests for `waveDelay` — the pure `(row + col) * ~26ms` diagonal-wave
 * math behind the calendar grid's entrance (MOTION_PLAN.md M26). The visible
 * animation itself (an entrance keyed to remount on month change, never on
 * hover/pick) isn't verifiable in jsdom; what's testable is that the delay
 * formula actually produces a diagonal — later rows AND later columns both
 * push a cell's delay out, and it scales with `--mo-dur` the same way
 * `stagger()` does.
 */
import { describe, expect, test } from 'vitest'
import { waveDelay } from './CalendarHeatmap'

describe('waveDelay', () => {
  test('the top-left cell (row 0, col 0) has no delay', () => {
    expect(waveDelay(0)).toEqual({ animationDelay: 'calc(var(--mo-dur, 1) * 0ms)' })
  })

  test('moving across a row increases the delay (col contribution)', () => {
    // 7-column grid: index 3 is row 0, col 3.
    expect(waveDelay(3)).toEqual({ animationDelay: 'calc(var(--mo-dur, 1) * 78ms)' })
  })

  test('moving down a row increases the delay (row contribution)', () => {
    // index 7 is row 1, col 0.
    expect(waveDelay(7)).toEqual({ animationDelay: 'calc(var(--mo-dur, 1) * 26ms)' })
  })

  test('row and column contributions add — a true diagonal, not just a row or column wave', () => {
    // index 9 is row 1, col 2 -> (1 + 2) * 26 = 78, same as row 0 col 3 above.
    expect(waveDelay(9)).toEqual(waveDelay(3))
  })

  test('the delay expression references --mo-dur, so Reduced/Off motion scales it down', () => {
    expect(waveDelay(15).animationDelay).toContain('var(--mo-dur, 1)')
  })
})
