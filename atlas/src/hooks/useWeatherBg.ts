import { useAtlasStore } from '../store/atlas';
import { useSettings } from '../store/settings';
import { weatherBgClass } from '../features/welcome/ambiance';

/**
 * The app-wide background tint class for the current weather, or '' when the
 * "Weather-tinted background" setting is off (or weather is unknown). Used by
 * the app shell, sidebar and main pane so they share one continuous wash.
 */
export function useWeatherBg(): string {
  const code = useAtlasStore((s) => s.weatherCode);
  const enabled = useSettings((s) => s.weatherTint);
  return enabled ? weatherBgClass(code) : '';
}
