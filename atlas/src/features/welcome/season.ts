/**
 * Which season it is — computed locally from the date and hemisphere (no
 * network, no weather service). Southern-hemisphere coordinates flip the
 * seasons. Used for a small decorative touch on the welcome screen.
 */
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export interface SeasonMeta {
  key: Season;
  label: string;
  emoji: string;
  particle: string;
}

const META: Record<Season, SeasonMeta> = {
  winter: { key: 'winter', label: 'Winter', emoji: '❄️', particle: '❄' },
  spring: { key: 'spring', label: 'Spring', emoji: '🌸', particle: '🌸' },
  summer: { key: 'summer', label: 'Summer', emoji: '☀️', particle: '✦' },
  autumn: { key: 'autumn', label: 'Autumn', emoji: '🍂', particle: '🍂' },
};

const OPPOSITE: Record<Season, Season> = {
  winter: 'summer',
  summer: 'winter',
  spring: 'autumn',
  autumn: 'spring',
};

export function seasonFor(date: Date, latitude: number | null): SeasonMeta {
  const m = date.getMonth(); // 0–11; meteorological seasons
  const northern: Season =
    m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
  const isNorthern = latitude == null ? true : latitude >= 0;
  return META[isNorthern ? northern : OPPOSITE[northern]];
}
