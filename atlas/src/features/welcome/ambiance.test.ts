/**
 * Unit tests for the WMO weather-code → ambiance mapping.
 *
 * The WMO code table is the one place in the app where a boundary is easy to get
 * silently wrong: code 3 is overcast (clouds) but 4 is not a WMO code at all, 77
 * is snow grains but 80 is rain showers. These tests pin every boundary so a
 * reordering of the if-chain can't quietly reclassify the weather.
 */
import { describe, expect, test } from 'vitest'
import { modeForWeather, weatherBgClass } from './ambiance'

describe('modeForWeather', () => {
  test('clear and mainly clear are sun', () => {
    expect(modeForWeather(0)).toBe('sun')
    expect(modeForWeather(1)).toBe('sun')
  })

  test('partly cloudy and overcast are clouds', () => {
    expect(modeForWeather(2)).toBe('clouds')
    expect(modeForWeather(3)).toBe('clouds')
  })

  test('fog codes are clouds', () => {
    expect(modeForWeather(45)).toBe('clouds')
    expect(modeForWeather(48)).toBe('clouds')
  })

  test('snowfall and snow grains are snow', () => {
    for (const code of [71, 73, 75, 77]) expect(modeForWeather(code)).toBe('snow')
  })

  test('snow showers are snow', () => {
    expect(modeForWeather(85)).toBe('snow')
    expect(modeForWeather(86)).toBe('snow')
  })

  test('drizzle, rain and showers are rain', () => {
    for (const code of [51, 53, 55, 61, 63, 65, 80, 81, 82]) {
      expect(modeForWeather(code)).toBe('rain')
    }
  })

  test('freezing rain is rain', () => {
    expect(modeForWeather(66)).toBe('rain')
    expect(modeForWeather(67)).toBe('rain')
  })

  test('thunderstorms are rain', () => {
    for (const code of [95, 96, 99]) expect(modeForWeather(code)).toBe('rain')
  })

  test('unknown weather falls back to the seasonal look', () => {
    expect(modeForWeather(null)).toBe('season')
    expect(modeForWeather(undefined)).toBe('season')
  })

  test('a negative code is treated as unknown, not as sun', () => {
    // Guards the ordering bug: `code <= 1` would catch -1 as "clear" if the
    // negative check didn't come first.
    expect(modeForWeather(-1)).toBe('season')
    expect(modeForWeather(-99)).toBe('season')
  })

  describe('boundaries', () => {
    test('1 → sun but 2 → clouds', () => {
      expect(modeForWeather(1)).toBe('sun')
      expect(modeForWeather(2)).toBe('clouds')
    })

    test('3 → clouds but 4 → rain (4 is not a real WMO code)', () => {
      expect(modeForWeather(3)).toBe('clouds')
      expect(modeForWeather(4)).toBe('rain')
    })

    test('70 → rain but 71 → snow', () => {
      expect(modeForWeather(70)).toBe('rain')
      expect(modeForWeather(71)).toBe('snow')
    })

    test('77 → snow but 78 → rain', () => {
      expect(modeForWeather(77)).toBe('snow')
      expect(modeForWeather(78)).toBe('rain')
    })

    test('84 → rain, 85/86 → snow, 87 → rain', () => {
      expect(modeForWeather(84)).toBe('rain')
      expect(modeForWeather(85)).toBe('snow')
      expect(modeForWeather(86)).toBe('snow')
      expect(modeForWeather(87)).toBe('rain')
    })

    test('0 is sun, not unknown', () => {
      expect(modeForWeather(0)).toBe('sun')
    })
  })

  test('every real WMO code maps to a known mode', () => {
    const modes = new Set(['sun', 'clouds', 'rain', 'snow', 'season'])
    for (let code = 0; code <= 99; code++) {
      expect(modes.has(modeForWeather(code))).toBe(true)
    }
  })
})

describe('weatherBgClass', () => {
  test('each mode maps to its tint class', () => {
    expect(weatherBgClass(0)).toBe('wx-sun')
    expect(weatherBgClass(3)).toBe('wx-clouds')
    expect(weatherBgClass(61)).toBe('wx-rain')
    expect(weatherBgClass(71)).toBe('wx-snow')
  })

  test('unknown weather means no tint at all (plain parchment)', () => {
    expect(weatherBgClass(null)).toBe('')
    expect(weatherBgClass(undefined)).toBe('')
    expect(weatherBgClass(-1)).toBe('')
  })

  test('stays in step with modeForWeather for every code', () => {
    const expected: Record<string, string> = {
      sun: 'wx-sun',
      clouds: 'wx-clouds',
      rain: 'wx-rain',
      snow: 'wx-snow',
      season: '',
    }
    for (let code = 0; code <= 99; code++) {
      expect(weatherBgClass(code)).toBe(expected[modeForWeather(code)])
    }
  })
})
