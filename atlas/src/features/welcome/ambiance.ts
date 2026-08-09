/**
 * Shared mapping from a WMO weather code to the welcome ambiance:
 *   - `modeForWeather` picks which particles SeasonAccent draws.
 *   - `weatherBgClass` picks the app-wide background tint class (see index.css),
 *     applied to the sidebar, main pane and app shell so the weather colour
 *     bleeds seamlessly across every panel (the classes use a fixed-attachment
 *     gradient, so adjacent panels share one continuous wash).
 * Unknown/absent weather → no tint (plain parchment) and seasonal motes.
 */

export type AmbientMode = 'sun' | 'clouds' | 'rain' | 'snow' | 'season';

export function modeForWeather(code: number | null | undefined): AmbientMode {
  if (code == null || code < 0) return 'season';
  if (code <= 1) return 'sun';                                  // clear / mainly clear
  if (code <= 3 || code === 45 || code === 48) return 'clouds'; // cloudy / fog
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain'; // drizzle, rain, showers, thunderstorms
}

export function weatherBgClass(code: number | null | undefined): string {
  switch (modeForWeather(code)) {
    case 'sun': return 'wx-sun';
    case 'clouds': return 'wx-clouds';
    case 'rain': return 'wx-rain';
    case 'snow': return 'wx-snow';
    default: return '';
  }
}
