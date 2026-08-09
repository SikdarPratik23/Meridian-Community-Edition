/**
 * Unit tests for the motion helpers.
 *
 * The one thing that must never be wrong: a user who has told their OS to
 * reduce motion gets motion off, no matter what the in-app Motion setting says
 * — it's a stated accessibility need, not a preference the app setting can
 * override.
 */
import { describe, expect, test } from 'vitest'
import { effectiveMotion, stagger } from './motion'
import type { MotionLevel } from '../store/settings'

describe('effectiveMotion', () => {
  const LEVELS: MotionLevel[] = ['full', 'reduced', 'off']

  test('the OS preference forces off regardless of the setting', () => {
    for (const level of LEVELS) {
      expect(effectiveMotion(level, true)).toBe('off')
    }
  })

  test('without the OS preference, the setting passes through unchanged', () => {
    for (const level of LEVELS) {
      expect(effectiveMotion(level, false)).toBe(level)
    }
  })
})

describe('stagger', () => {
  test('scales the base token by the item index', () => {
    expect(stagger(0).animationDelay).toBe('calc(var(--mo-stagger, 45ms) * 0)')
    expect(stagger(3).animationDelay).toBe('calc(var(--mo-stagger, 45ms) * 3)')
  })

  test('caps at 8 items so a long list does not crawl in', () => {
    expect(stagger(8).animationDelay).toBe('calc(var(--mo-stagger, 45ms) * 8)')
    expect(stagger(9).animationDelay).toBe('calc(var(--mo-stagger, 45ms) * 8)')
    expect(stagger(100).animationDelay).toBe('calc(var(--mo-stagger, 45ms) * 8)')
  })
})
