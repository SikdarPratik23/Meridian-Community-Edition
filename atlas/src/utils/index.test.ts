/**
 * Unit tests for the shared formatting + geodesy helpers.
 *
 * These are used on nearly every screen (timeline grouping, distance badges,
 * coordinate read-outs), so a regression here is visible everywhere at once.
 * `haversineKm` additionally feeds trip distances and the "Near me" search
 * radius, where being wrong means showing the user the wrong entries.
 */
import { describe, expect, test } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatDistance,
  formatFullDay,
  formatLatLng,
  formatTemperature,
  formatTime,
  generateId,
  getDayGroup,
  getDayKey,
  getMonthGroup,
  getYearGroup,
  haversineKm,
  isDateTitle,
} from './index'
import { COORDS } from '../test/factories'

describe('haversineKm', () => {
  test('a point to itself is zero', () => {
    expect(haversineKm(COORDS.nuremberg, COORDS.nuremberg)).toBe(0)
  })

  test('Nuremberg → Munich is ~150 km', () => {
    // Real-world great-circle distance is ~150.6 km.
    expect(haversineKm(COORDS.nuremberg, COORDS.munich)).toBeCloseTo(150.6, 0)
  })

  test('Nuremberg → Berlin is ~378 km', () => {
    expect(haversineKm(COORDS.nuremberg, COORDS.berlin)).toBeCloseTo(378, 0)
  })

  test('is symmetric', () => {
    const there = haversineKm(COORDS.nuremberg, COORDS.kolkata)
    const back = haversineKm(COORDS.kolkata, COORDS.nuremberg)
    expect(there).toBeCloseTo(back, 9)
  })

  test('crosses the equator correctly (northern → southern hemisphere)', () => {
    // Nuremberg → Sydney, ~16 335 km.
    expect(haversineKm(COORDS.nuremberg, COORDS.sydney)).toBeCloseTo(16335, -2)
  })

  test('crosses the antimeridian without blowing up', () => {
    // 179°E → 179°W is 2° apart, not 358°. Haversine handles this because it
    // works on the sine of the half-difference.
    const km = haversineKm([179, 0], [-179, 0])
    expect(km).toBeCloseTo(222.4, 0)
  })

  test('one degree of latitude at the equator is ~111 km', () => {
    expect(haversineKm([0, 0], [0, 1])).toBeCloseTo(111.19, 1)
  })

  test('antipodal points are ~half the Earth’s circumference', () => {
    expect(haversineKm([0, 0], [180, 0])).toBeCloseTo(Math.PI * 6371, 3)
  })

  test('never returns NaN for antipodes (the asin clamp holds)', () => {
    // Floating point can push the sqrt slightly over 1; the implementation
    // clamps with Math.min(1, …). Without that this would be NaN.
    expect(Number.isNaN(haversineKm([0, 90], [0, -90]))).toBe(false)
  })
})

describe('formatDistance', () => {
  test('renders metres below 1 km', () => {
    expect(formatDistance(0.4)).toBe('400 m')
    expect(formatDistance(0.999)).toBe('999 m')
  })

  test('renders one decimal between 1 and 10 km', () => {
    expect(formatDistance(1)).toBe('1.0 km')
    expect(formatDistance(4.26)).toBe('4.3 km')
  })

  test('rounds to whole km at 10 km and above', () => {
    expect(formatDistance(10)).toBe('10 km')
    expect(formatDistance(150.6)).toBe('151 km')
  })

  test('zero reads as 0 m, not an empty string', () => {
    expect(formatDistance(0)).toBe('0 m')
  })
})

describe('formatLatLng', () => {
  test('decimal format uses cardinal hints and 4 decimal places', () => {
    expect(formatLatLng(11.0767, 49.4521, 'decimal')).toBe('49.4521° N, 11.0767° E')
  })

  test('southern/western coordinates get S and W', () => {
    expect(formatLatLng(-58.3816, -34.6037, 'decimal')).toBe('34.6037° S, 58.3816° W')
  })

  test('latitude is printed first even though storage is [lon, lat]', () => {
    // Guards the most likely mistake in this codebase: coordinates are stored in
    // GeoJSON order but READ latitude-first.
    const out = formatLatLng(11.0767, 49.4521, 'decimal')
    expect(out.indexOf('49.4521')).toBeLessThan(out.indexOf('11.0767'))
  })

  test('DMS format converts to degrees/minutes/seconds', () => {
    expect(formatLatLng(11.0767, 49.4521, 'dms')).toBe('49°27′08″ N, 11°04′36″ E')
  })

  test('DMS pads minutes and seconds to two digits', () => {
    expect(formatLatLng(11.05, 49.05, 'dms')).toBe('49°03′00″ N, 11°03′00″ E')
  })

  test('DMS carries 60 seconds up into the next minute', () => {
    // 49.499999° → 29′59.996″ which rounds to 60″; must become 30′00″, never 29′60″.
    const out = formatLatLng(0, 49.499999, 'dms')
    expect(out).not.toContain('60″')
    expect(out).toContain('49°30′00″ N')
  })

  test('the exact equator/prime meridian reads N and E, not S and W', () => {
    expect(formatLatLng(0, 0, 'decimal')).toBe('0.0000° N, 0.0000° E')
  })

  test('falls back to the settings store when no format is passed', () => {
    // Default setting is 'decimal'.
    expect(formatLatLng(11.0767, 49.4521)).toBe('49.4521° N, 11.0767° E')
  })
})

describe('formatTemperature', () => {
  test('Celsius passes through, rounded', () => {
    expect(formatTemperature(18.4, 'C')).toBe('18°C')
    expect(formatTemperature(18.6, 'C')).toBe('19°C')
  })

  test('converts to Fahrenheit', () => {
    expect(formatTemperature(0, 'F')).toBe('32°F')
    expect(formatTemperature(100, 'F')).toBe('212°F')
    expect(formatTemperature(18, 'F')).toBe('64°F')
  })

  test('handles sub-zero temperatures in both units', () => {
    expect(formatTemperature(-5, 'C')).toBe('-5°C')
    expect(formatTemperature(-40, 'F')).toBe('-40°F')
  })

  test('falls back to the settings store when no unit is passed', () => {
    expect(formatTemperature(18)).toBe('18°C')
  })
})

describe('date formatting and grouping', () => {
  // A local-time date string keeps these assertions independent of the runner's
  // timezone — `new Date('2026-07-15T10:30:00')` is 10:30 wherever it runs.
  const local = '2026-07-15T10:30:00'

  test('formatDate renders a long US-style date', () => {
    expect(formatDate(local)).toBe('July 15, 2026')
  })

  test('formatTime renders a 2-digit 12-hour time', () => {
    expect(formatTime(local)).toBe('10:30 AM')
  })

  test('formatDateTime joins date and time', () => {
    expect(formatDateTime(local)).toBe('July 15, 2026 10:30 AM')
  })

  test('formatFullDay includes the weekday', () => {
    expect(formatFullDay(local)).toBe('Wednesday, July 15, 2026')
  })

  test('getMonthGroup buckets by month and year', () => {
    expect(getMonthGroup(local)).toBe('July 2026')
    expect(getMonthGroup('2026-01-02T00:00:00')).toBe('January 2026')
  })

  test('getYearGroup returns the year as a string', () => {
    expect(getYearGroup(local)).toBe('2026')
  })

  test('getDayGroup gives a short weekday + day label', () => {
    // NOTE: Intl orders `{ weekday, day }` as "15 Wednesday" for en-US, so the
    // JSDoc on getDayGroup ("e.g. `Thursday 26`") describes the intent rather
    // than the output. Asserting the real string so a deliberate change to the
    // format has to update this test.
    expect(getDayGroup(local)).toBe('15 Wednesday')
  })

  test('getDayKey is a zero-padded YYYY-MM-DD', () => {
    expect(getDayKey(local)).toBe('2026-07-15')
    expect(getDayKey('2026-01-05T12:00:00')).toBe('2026-01-05')
  })

  test('getDayKey uses LOCAL date parts, not the UTC ISO prefix', () => {
    // The bug this guards: an entry written at 11pm local would land in the next
    // day's bucket if the key were sliced off the UTC ISO string. Building a date
    // from local parts must round-trip to the same calendar day.
    const late = new Date(2026, 6, 15, 23, 30)
    expect(getDayKey(late.toISOString())).toBe('2026-07-15')
  })

  test('getDayKey and getMonthGroup agree on the same instant', () => {
    const d = new Date(2026, 11, 31, 22, 15) // 31 Dec 2026, local
    expect(getDayKey(d.toISOString())).toBe('2026-12-31')
    expect(getMonthGroup(d.toISOString())).toBe('December 2026')
  })
})

describe('isDateTitle', () => {
  test('true when the title is exactly the auto-generated date', () => {
    const iso = '2026-07-15T10:30:00'
    expect(isDateTitle(formatDate(iso), iso)).toBe(true)
  })

  test('false for a user-chosen title', () => {
    expect(isDateTitle('Hiking the Alps', '2026-07-15T10:30:00')).toBe(false)
  })

  test('false when the title is a DIFFERENT date', () => {
    expect(isDateTitle('July 14, 2026', '2026-07-15T10:30:00')).toBe(false)
  })

  test('false for an empty title', () => {
    expect(isDateTitle('', '2026-07-15T10:30:00')).toBe(false)
  })
})

describe('generateId', () => {
  test('returns a v4 UUID in a crypto-capable environment', () => {
    expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  test('ids are unique across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateId()))
    expect(ids.size).toBe(500)
  })

  test('falls back to getRandomValues when randomUUID is unavailable', () => {
    // This is the real LAN case: over plain http:// the page is not a secure
    // context and `crypto.randomUUID` is undefined, so saving an entry must
    // still produce a valid id rather than throwing.
    const real = globalThis.crypto.randomUUID
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        configurable: true,
      })
      const id = generateId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: real,
        configurable: true,
      })
    }
  })
})
