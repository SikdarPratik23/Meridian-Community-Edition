/**
 * Unit tests for the graphics-quality tiers.
 *
 * The contract that matters: tiers are strictly CUMULATIVE (nothing switched on
 * at Low turns off at Ultra), Low is the install default and stays genuinely
 * light for an entry-level phone, and an unrecognised persisted value can never
 * crash the backdrop — it falls back to Low.
 */
import { describe, expect, test } from 'vitest'
import { QUALITY_ORDER, profileFor } from './quality'
import type { GraphicsQuality } from '../../store/settings'

/** Every boolean gate on a profile, in one place. */
const GATES = [
  'ambientLife',
  'fog',
  'aurora',
  'birds',
  'shootingStar',
  'sunbeams',
  'richClouds',
  'butterfly',
  'reflections',
  'bees',
  'webgl',
] as const

describe('QUALITY_ORDER', () => {
  test('runs lightest → heaviest', () => {
    expect(QUALITY_ORDER).toEqual(['low', 'medium', 'high', 'ultra'])
  })
})

describe('profileFor', () => {
  test('resolves each tier to its own profile', () => {
    for (const tier of QUALITY_ORDER) {
      expect(profileFor(tier).tier).toBe(tier)
    }
  })

  test('every tier has a label and a blurb for the settings control', () => {
    for (const tier of QUALITY_ORDER) {
      const p = profileFor(tier)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.blurb.length).toBeGreaterThan(0)
    }
  })

  describe('fallbacks (a corrupt or pre-existing persisted value)', () => {
    test('undefined falls back to low', () => {
      expect(profileFor(undefined).tier).toBe('low')
    })

    test('null falls back to low', () => {
      expect(profileFor(null).tier).toBe('low')
    })

    test('an unknown string falls back to low instead of returning undefined', () => {
      // A settings value written by a future version must not crash the backdrop.
      expect(profileFor('cinematic' as GraphicsQuality).tier).toBe('low')
    })
  })

  describe('low — the install default', () => {
    const low = profileFor('low')

    test('drops every decorative extra', () => {
      for (const gate of GATES) expect(low[gate]).toBe(false)
    })

    test('thins particles and caps DPR for weak GPUs', () => {
      expect(low.particleScale).toBeLessThan(1)
      expect(low.maxDpr).toBeLessThanOrEqual(1.5)
    })

    test('still spawns SOME particles — precipitation must remain visible', () => {
      expect(low.particleScale).toBeGreaterThan(0)
    })
  })

  describe('cumulative tiers', () => {
    test('particleScale never decreases as the tier rises', () => {
      const scales = QUALITY_ORDER.map((t) => profileFor(t).particleScale)
      for (let i = 1; i < scales.length; i++) {
        expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1])
      }
    })

    test('maxDpr never decreases as the tier rises', () => {
      const dprs = QUALITY_ORDER.map((t) => profileFor(t).maxDpr)
      for (let i = 1; i < dprs.length; i++) {
        expect(dprs[i]).toBeGreaterThanOrEqual(dprs[i - 1])
      }
    })

    test('no gate ever turns OFF at a higher tier', () => {
      for (let i = 1; i < QUALITY_ORDER.length; i++) {
        const lower = profileFor(QUALITY_ORDER[i - 1])
        const higher = profileFor(QUALITY_ORDER[i])
        for (const gate of GATES) {
          if (lower[gate]) {
            expect(higher[gate], `${gate} regressed from ${lower.tier} to ${higher.tier}`).toBe(true)
          }
        }
      }
    })
  })

  describe('tier contents', () => {
    test('medium adds the ambient life, birds, sunbeams and butterfly', () => {
      const m = profileFor('medium')
      expect(m.ambientLife).toBe(true)
      expect(m.birds).toBe(true)
      expect(m.sunbeams).toBe(true)
      expect(m.butterfly).toBe(true)
      // …but not the heavy atmosphere.
      expect(m.fog).toBe(false)
      expect(m.webgl).toBe(false)
    })

    test('high adds fog, aurora, reflections, bees and the shooting star', () => {
      const h = profileFor('high')
      expect(h.fog).toBe(true)
      expect(h.aurora).toBe(true)
      expect(h.reflections).toBe(true)
      expect(h.bees).toBe(true)
      expect(h.shootingStar).toBe(true)
    })

    test('WebGL is gated to high and ultra only', () => {
      expect(profileFor('low').webgl).toBe(false)
      expect(profileFor('medium').webgl).toBe(false)
      expect(profileFor('high').webgl).toBe(true)
      expect(profileFor('ultra').webgl).toBe(true)
    })

    test('ultra is the densest and sharpest tier', () => {
      const ultra = profileFor('ultra')
      for (const tier of QUALITY_ORDER) {
        expect(ultra.particleScale).toBeGreaterThanOrEqual(profileFor(tier).particleScale)
        expect(ultra.maxDpr).toBeGreaterThanOrEqual(profileFor(tier).maxDpr)
      }
    })

    test('ultra enables every gate', () => {
      const ultra = profileFor('ultra')
      for (const gate of GATES) expect(ultra[gate]).toBe(true)
    })
  })

  test('profiles are plain data — repeated lookups agree', () => {
    expect(profileFor('high')).toEqual(profileFor('high'))
  })
})
