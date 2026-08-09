/**
 * Unit tests for the offline astronomy: solar position, sky phase, moon phase.
 *
 * All of this runs with no network — it's what lets the welcome backdrop know
 * whether to draw a sun or a moon, and which crescent. The assertions here use
 * physical facts that don't depend on an ephemeris: the sun is up at local noon,
 * down at local midnight, higher in summer than winter, and the polar regions
 * have midnight sun / polar night at the solstices.
 */
import { describe, expect, test } from 'vitest'
import { moonLitPath, moonPhase, skyPhase, solarAltitudeDeg, solarPositionDeg, sunArcOffset } from './sky'

const NUREMBERG = { lat: 49.4521, lon: 11.0767 }
const SYDNEY = { lat: -33.8688, lon: 151.2093 }

/** Local noon at a longitude, as a UTC Date — solar noon is ~12:00 - lon/15 UTC. */
function solarNoonUtc(year: number, month: number, day: number, lon: number): Date {
  return new Date(Date.UTC(year, month, day, 12, 0) - (lon / 15) * 3600_000)
}

describe('solarAltitudeDeg', () => {
  test('the sun is high at local solar noon in midsummer', () => {
    const alt = solarAltitudeDeg(solarNoonUtc(2026, 5, 21, NUREMBERG.lon), NUREMBERG.lat, NUREMBERG.lon)
    // Max possible at 49.45°N is 90 - 49.45 + 23.44 ≈ 64°.
    expect(alt).toBeGreaterThan(60)
    expect(alt).toBeLessThan(65)
  })

  test('the sun is low at local solar noon in midwinter', () => {
    const alt = solarAltitudeDeg(solarNoonUtc(2026, 11, 21, NUREMBERG.lon), NUREMBERG.lat, NUREMBERG.lon)
    // Min at 49.45°N is 90 - 49.45 - 23.44 ≈ 17°.
    expect(alt).toBeGreaterThan(14)
    expect(alt).toBeLessThan(20)
  })

  test('summer noon is much higher than winter noon at the same place', () => {
    const summer = solarAltitudeDeg(solarNoonUtc(2026, 5, 21, NUREMBERG.lon), NUREMBERG.lat, NUREMBERG.lon)
    const winter = solarAltitudeDeg(solarNoonUtc(2026, 11, 21, NUREMBERG.lon), NUREMBERG.lat, NUREMBERG.lon)
    expect(summer - winter).toBeGreaterThan(40)
  })

  test('the sun is below the horizon at local midnight', () => {
    const midnight = new Date(Date.UTC(2026, 5, 21, 0, 0) - (NUREMBERG.lon / 15) * 3600_000)
    expect(solarAltitudeDeg(midnight, NUREMBERG.lat, NUREMBERG.lon)).toBeLessThan(0)
  })

  test('the hemispheres are opposite on the same date', () => {
    // June: northern summer, southern winter. Compare each at ITS local noon.
    const north = solarAltitudeDeg(solarNoonUtc(2026, 5, 21, NUREMBERG.lon), NUREMBERG.lat, NUREMBERG.lon)
    const south = solarAltitudeDeg(solarNoonUtc(2026, 5, 21, SYDNEY.lon), SYDNEY.lat, SYDNEY.lon)
    expect(north).toBeGreaterThan(60)
    expect(south).toBeLessThan(35) // Sydney's lowest noon sun, ~32°
  })

  test('midnight sun: above the horizon all day at the north pole in June', () => {
    for (const hour of [0, 6, 12, 18]) {
      expect(solarAltitudeDeg(new Date(Date.UTC(2026, 5, 21, hour)), 90, 0)).toBeGreaterThan(0)
    }
  })

  test('polar night: below the horizon all day at the north pole in December', () => {
    for (const hour of [0, 6, 12, 18]) {
      expect(solarAltitudeDeg(new Date(Date.UTC(2026, 11, 21, hour)), 90, 0)).toBeLessThan(0)
    }
  })

  test('at the equinox the sun is overhead at the equator at solar noon', () => {
    const alt = solarAltitudeDeg(solarNoonUtc(2026, 2, 20, 0), 0, 0)
    expect(alt).toBeGreaterThan(88)
  })

  test('always returns a finite number, never NaN', () => {
    for (const lat of [-90, -45, 0, 45, 90]) {
      for (const lon of [-180, -90, 0, 90, 180]) {
        expect(Number.isFinite(solarAltitudeDeg(new Date(Date.UTC(2026, 5, 21, 12)), lat, lon))).toBe(true)
      }
    }
  })

  test('stays within the physically possible ±90°', () => {
    for (let h = 0; h < 24; h++) {
      const alt = solarAltitudeDeg(new Date(Date.UTC(2026, 5, 21, h)), NUREMBERG.lat, NUREMBERG.lon)
      expect(alt).toBeGreaterThanOrEqual(-90)
      expect(alt).toBeLessThanOrEqual(90)
    }
  })
})

describe('solarPositionDeg', () => {
  test('altitude always agrees with solarAltitudeDeg for the same inputs', () => {
    for (let h = 0; h < 24; h += 3) {
      const t = new Date(Date.UTC(2026, 5, 21, h))
      const alt = solarAltitudeDeg(t, NUREMBERG.lat, NUREMBERG.lon)
      const pos = solarPositionDeg(t, NUREMBERG.lat, NUREMBERG.lon)
      expect(pos.altitude).toBeCloseTo(alt, 6)
    }
  })

  test('the sun sits due south (azimuth ~180°) at local solar noon, N. hemisphere', () => {
    const pos = solarPositionDeg(solarNoonUtc(2026, 5, 21, NUREMBERG.lon), NUREMBERG.lat, NUREMBERG.lon)
    expect(pos.azimuth).toBeGreaterThan(170)
    expect(pos.azimuth).toBeLessThan(190)
  })

  test('azimuth sweeps from well under 180° before noon to well over 180° after noon', () => {
    const lon = NUREMBERG.lon
    const before = solarPositionDeg(new Date(solarNoonUtc(2026, 5, 21, lon).getTime() - 4 * 3600_000), NUREMBERG.lat, lon)
    const after = solarPositionDeg(new Date(solarNoonUtc(2026, 5, 21, lon).getTime() + 4 * 3600_000), NUREMBERG.lat, lon)
    expect(before.azimuth).toBeLessThan(180)
    expect(after.azimuth).toBeGreaterThan(180)
  })

  test('never returns NaN, including at the poles', () => {
    for (const lat of [-90, -45, 0, 45, 90]) {
      for (const lon of [-180, -90, 0, 90, 180]) {
        const pos = solarPositionDeg(new Date(Date.UTC(2026, 5, 21, 12)), lat, lon)
        expect(Number.isFinite(pos.altitude)).toBe(true)
        expect(Number.isFinite(pos.azimuth)).toBe(true)
      }
    }
  })

  test('azimuth always stays within the physical 0..360° range', () => {
    for (let h = 0; h < 24; h++) {
      const pos = solarPositionDeg(new Date(Date.UTC(2026, 5, 21, h)), NUREMBERG.lat, NUREMBERG.lon)
      expect(pos.azimuth).toBeGreaterThanOrEqual(0)
      expect(pos.azimuth).toBeLessThanOrEqual(360)
    }
  })
})

describe('sunArcOffset', () => {
  test('due south at local noon lands at the horizontal centre', () => {
    expect(sunArcOffset(45, 180).xFrac).toBe(0)
  })

  test('swings negative before noon (sunrise side) and positive after (sunset side)', () => {
    expect(sunArcOffset(20, 100).xFrac).toBeLessThan(0)
    expect(sunArcOffset(20, 260).xFrac).toBeGreaterThan(0)
  })

  test('clamps xFrac to [-1, 1] outside the mapped azimuth range', () => {
    expect(sunArcOffset(10, -1000).xFrac).toBe(-1)
    expect(sunArcOffset(10, 1000).xFrac).toBe(1)
  })

  test('yFrac rises monotonically with altitude', () => {
    const low = sunArcOffset(5, 180).yFrac
    const mid = sunArcOffset(35, 180).yFrac
    const high = sunArcOffset(65, 180).yFrac
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
  })

  test('clamps yFrac to [0, 1]', () => {
    expect(sunArcOffset(-20, 180).yFrac).toBe(0)
    expect(sunArcOffset(200, 180).yFrac).toBe(1)
  })

  test('is finite for every altitude/azimuth on the compass', () => {
    for (let az = 0; az <= 360; az += 30) {
      for (let alt = -90; alt <= 90; alt += 30) {
        const { xFrac, yFrac } = sunArcOffset(alt, az)
        expect(Number.isFinite(xFrac)).toBe(true)
        expect(Number.isFinite(yFrac)).toBe(true)
      }
    }
  })
})

describe('skyPhase', () => {
  test('day at local solar noon', () => {
    const noon = solarNoonUtc(2026, 5, 21, NUREMBERG.lon)
    expect(skyPhase(noon, NUREMBERG.lat, NUREMBERG.lon)).toBe('day')
  })

  test('night at local midnight in winter', () => {
    const midnight = new Date(Date.UTC(2026, 11, 21, 0, 0) - (NUREMBERG.lon / 15) * 3600_000)
    expect(skyPhase(midnight, NUREMBERG.lat, NUREMBERG.lon)).toBe('night')
  })

  test('golden when the sun sits just around the horizon', () => {
    // Scan a winter day at 1-minute steps and confirm the transition band exists
    // and that every sample in it has an altitude between -6° and +4°.
    const golden: number[] = []
    for (let m = 0; m < 24 * 60; m += 5) {
      const t = new Date(Date.UTC(2026, 11, 21, 0, m))
      if (skyPhase(t, NUREMBERG.lat, NUREMBERG.lon) === 'golden') {
        golden.push(solarAltitudeDeg(t, NUREMBERG.lat, NUREMBERG.lon))
      }
    }
    expect(golden.length).toBeGreaterThan(0)
    for (const alt of golden) {
      expect(alt).toBeGreaterThanOrEqual(-6)
      expect(alt).toBeLessThanOrEqual(4)
    }
  })

  test('every sample of a full day is one of the three phases', () => {
    for (let h = 0; h < 24; h++) {
      const phase = skyPhase(new Date(Date.UTC(2026, 5, 21, h)), NUREMBERG.lat, NUREMBERG.lon)
      expect(['day', 'golden', 'night']).toContain(phase)
    }
  })

  describe('without coordinates (before a location fix)', () => {
    // Falls back to the local clock so the cycle still animates.
    const at = (hour: number) => skyPhase(new Date(2026, 5, 21, hour, 0), null, null)

    test('midday is day', () => {
      expect(at(12)).toBe('day')
    })

    test('the small hours are night', () => {
      expect(at(2)).toBe('night')
      expect(at(23)).toBe('night')
    })

    test('dawn and dusk are golden', () => {
      expect(at(6)).toBe('golden')
      expect(at(20)).toBe('golden')
    })

    test('a missing longitude alone also takes the fallback', () => {
      expect(skyPhase(new Date(2026, 5, 21, 12), NUREMBERG.lat, null)).toBe('day')
    })

    test('boundary hours match the documented thresholds', () => {
      expect(at(7)).toBe('day') // >= 7 is day
      expect(at(18)).toBe('day') // < 19 is day
      expect(at(19)).toBe('golden')
      expect(at(21)).toBe('night') // >= 21 is night
    })
  })
})

describe('moonPhase', () => {
  const SYNODIC = 29.530588853
  const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)
  const afterRef = (days: number) => new Date(REF_NEW_MOON + days * 86_400_000)

  test('the reference epoch is a new moon', () => {
    const m = moonPhase(afterRef(0))
    expect(m.fraction).toBeCloseTo(0, 3)
    expect(m.illum).toBeCloseTo(0, 3)
    expect(m.name).toBe('New moon')
  })

  test('half a synodic month later is a full moon', () => {
    const m = moonPhase(afterRef(SYNODIC / 2))
    expect(m.fraction).toBeCloseTo(0.5, 3)
    expect(m.illum).toBeCloseTo(1, 3)
    expect(m.name).toBe('Full moon')
  })

  test('a quarter month is first quarter and half lit', () => {
    const m = moonPhase(afterRef(SYNODIC / 4))
    expect(m.illum).toBeCloseTo(0.5, 2)
    expect(m.name).toBe('First quarter')
    expect(m.waxing).toBe(true)
  })

  test('three quarters is last quarter and waning', () => {
    const m = moonPhase(afterRef((SYNODIC * 3) / 4))
    expect(m.illum).toBeCloseTo(0.5, 2)
    expect(m.name).toBe('Last quarter')
    expect(m.waxing).toBe(false)
  })

  test('waxing in the first half, waning in the second', () => {
    expect(moonPhase(afterRef(SYNODIC * 0.1)).waxing).toBe(true)
    expect(moonPhase(afterRef(SYNODIC * 0.4)).waxing).toBe(true)
    expect(moonPhase(afterRef(SYNODIC * 0.6)).waxing).toBe(false)
    expect(moonPhase(afterRef(SYNODIC * 0.9)).waxing).toBe(false)
  })

  test('the cycle repeats after a full synodic month', () => {
    const a = moonPhase(afterRef(3))
    const b = moonPhase(afterRef(3 + SYNODIC))
    expect(b.fraction).toBeCloseTo(a.fraction, 6)
    expect(b.name).toBe(a.name)
  })

  test('dates BEFORE the reference epoch still give a valid phase', () => {
    // The implementation adds 1 to a negative modulo; without that, fraction
    // would go negative and the phase name would fall off the end.
    const m = moonPhase(new Date(Date.UTC(1990, 0, 1)))
    expect(m.fraction).toBeGreaterThanOrEqual(0)
    expect(m.fraction).toBeLessThan(1)
    expect(m.name.length).toBeGreaterThan(0)
  })

  test('fraction stays in [0,1) and illum in [0,1] across a whole cycle', () => {
    for (let d = 0; d < 30; d += 0.25) {
      const m = moonPhase(afterRef(d))
      expect(m.fraction).toBeGreaterThanOrEqual(0)
      expect(m.fraction).toBeLessThan(1)
      expect(m.illum).toBeGreaterThanOrEqual(0)
      expect(m.illum).toBeLessThanOrEqual(1)
    }
  })

  test('names all eight principal phases over one cycle', () => {
    const names = new Set<string>()
    for (let d = 0; d < SYNODIC; d += 0.1) names.add(moonPhase(afterRef(d)).name)
    expect(names).toEqual(
      new Set([
        'New moon',
        'Waxing crescent',
        'First quarter',
        'Waxing gibbous',
        'Full moon',
        'Waning gibbous',
        'Last quarter',
        'Waning crescent',
      ]),
    )
  })
})

describe('moonLitPath', () => {
  test('a new moon lights nothing', () => {
    expect(moonLitPath(50, 50, 20, 0)).toBe('')
  })

  test('a full moon lights the whole disc', () => {
    const path = moonLitPath(50, 50, 20, 0.5)
    expect(path).not.toBe('')
    expect(path).toContain('a 20 20') // two half-circle arcs = a complete disc
  })

  test('a quarter moon draws a straight terminator (zero-width ellipse)', () => {
    // At the quarters cos(2πf) = 0, so the terminator ellipse collapses to a line.
    expect(moonLitPath(50, 50, 20, 0.25)).toContain('A 0.00 20')
  })

  test('crescent and gibbous use different terminator sweeps', () => {
    const crescent = moonLitPath(50, 50, 20, 0.1) // waxing crescent
    const gibbous = moonLitPath(50, 50, 20, 0.4) // waxing gibbous
    expect(crescent).not.toBe(gibbous)
  })

  test('waxing and waning are mirror images (different outer sweep)', () => {
    const waxing = moonLitPath(50, 50, 20, 0.25)
    const waning = moonLitPath(50, 50, 20, 0.75)
    expect(waxing).not.toBe(waning)
  })

  test('every visibly-lit phase yields a closed path anchored on the disc', () => {
    // Starts at 0.05 because the implementation treats anything under 1%
    // illumination as new (nothing lit) — f=0.02 is only ~0.4% lit.
    for (let f = 0.05; f <= 0.95; f += 0.02) {
      const path = moonLitPath(50, 50, 20, f)
      expect(path, `fraction ${f.toFixed(2)}`).not.toBe('')
      expect(path.startsWith('M ')).toBe(true)
      expect(path.trimEnd().endsWith('Z')).toBe(true)
      expect(path).not.toContain('NaN')
    }
  })

  test('a sliver under 1% illumination counts as new and lights nothing', () => {
    // Just either side of the reference new moon.
    expect(moonLitPath(50, 50, 20, 0.01)).toBe('')
    expect(moonLitPath(50, 50, 20, 0.99)).toBe('')
  })

  test('honours the centre and radius it is given', () => {
    const path = moonLitPath(100, 200, 30, 0.25)
    expect(path).toContain('M 100 170') // cy - r
    expect(path).toContain('100 230') // cy + r
  })
})
