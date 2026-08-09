/**
 * Current weather for a position, via Open-Meteo — free, keyless, CORS-enabled,
 * and privacy-aligned: only the approximate coordinates are sent, like the
 * reverse-geocode the welcome screen already uses. Fails soft (returns null) so
 * everything degrades cleanly offline or when online lookups are turned off.
 */

export interface CurrentWeather {
  /** Temperature in °C; convert for display with `formatTemperature`. */
  temperatureC: number;
  /** WMO weather-interpretation code (-1 for a value reconstructed from storage). */
  code: number;
  label: string;
  emoji: string;
  /** Wind speed in km/h (absent for weather reconstructed from a stored entry;
   *  null if the provider omitted it). Drives how hard the backdrop's trees/grass
   *  sway and how far rain/particles slant. */
  windKph?: number | null;
}

/** WMO weather-interpretation codes → a short label and an emoji. */
const WMO: Record<number, { label: string; emoji: string }> = {
  0: { label: 'Clear sky', emoji: '☀️' },
  1: { label: 'Mainly clear', emoji: '🌤️' },
  2: { label: 'Partly cloudy', emoji: '⛅' },
  3: { label: 'Overcast', emoji: '☁️' },
  45: { label: 'Fog', emoji: '🌫️' },
  48: { label: 'Rime fog', emoji: '🌫️' },
  51: { label: 'Light drizzle', emoji: '🌦️' },
  53: { label: 'Drizzle', emoji: '🌦️' },
  55: { label: 'Heavy drizzle', emoji: '🌦️' },
  56: { label: 'Freezing drizzle', emoji: '🌧️' },
  57: { label: 'Freezing drizzle', emoji: '🌧️' },
  61: { label: 'Light rain', emoji: '🌦️' },
  63: { label: 'Rain', emoji: '🌧️' },
  65: { label: 'Heavy rain', emoji: '🌧️' },
  66: { label: 'Freezing rain', emoji: '🌧️' },
  67: { label: 'Freezing rain', emoji: '🌧️' },
  71: { label: 'Light snow', emoji: '🌨️' },
  73: { label: 'Snow', emoji: '🌨️' },
  75: { label: 'Heavy snow', emoji: '❄️' },
  77: { label: 'Snow grains', emoji: '🌨️' },
  80: { label: 'Rain showers', emoji: '🌦️' },
  81: { label: 'Rain showers', emoji: '🌧️' },
  82: { label: 'Violent rain showers', emoji: '⛈️' },
  85: { label: 'Snow showers', emoji: '🌨️' },
  86: { label: 'Heavy snow showers', emoji: '🌨️' },
  95: { label: 'Thunderstorm', emoji: '⛈️' },
  96: { label: 'Thunderstorm with hail', emoji: '⛈️' },
  99: { label: 'Thunderstorm with hail', emoji: '⛈️' },
};

export function describeWeatherCode(code: number): { label: string; emoji: string } {
  return WMO[code] ?? { label: 'Weather', emoji: '🌡️' };
}

export async function fetchCurrentWeather(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<CurrentWeather | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`,
      { signal },
    );
    if (!res.ok) return null;
    const d = await res.json();
    const t = d?.current?.temperature_2m;
    const code = d?.current?.weather_code;
    if (typeof t !== 'number' || typeof code !== 'number') return null;
    const w = d?.current?.wind_speed_10m;
    const { label, emoji } = describeWeatherCode(code);
    return { temperatureC: t, code, label, emoji, windKph: typeof w === 'number' ? w : null };
  } catch {
    return null;
  }
}

