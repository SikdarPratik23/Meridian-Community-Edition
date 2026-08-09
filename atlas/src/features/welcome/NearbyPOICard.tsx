import { useMemo } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { formatDistance } from '../../utils';
import { SkeletonLine } from '../../components/ui/Skeleton';

/** Initial bearing from point 1 → point 2, in degrees clockwise from true north. */
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Nearest of the 8 compass points for a bearing, e.g. 30° → "NE". */
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compassOf(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/**
 * "Places of interest nearby" — a compact, scrollable panel of notable places
 * around the current location (Wikipedia geosearch, up to ~50, nearest first).
 * Each row shows the direction to the place (a little arrow pointing to its true
 * bearing + the compass point), its name, and its distance; clicking opens the
 * article.
 *
 * The list itself is fetched + published to the store by `useNearbyPois` (at the
 * app root) so the map's pins don't depend on this card being on screen; this
 * card is purely a reader/renderer of that shared list.
 *
 * Online (respects the online-lookups setting); renders nothing without
 * coordinates, lookups off, or when nothing is found, so the welcome column
 * self-prunes.
 */
export default function NearbyPOICard() {
  const coords = useAtlasStore((s) => s.coords);
  const places = useAtlasStore((s) => s.nearbyPois);
  const onlineLookups = useSettings((s) => s.onlineLookups);
  const showPoiPins = useSettings((s) => s.showPoiPins);

  // Direction (bearing + compass point) to each place, for the row's arrow.
  const bearings = useMemo(() => {
    if (!places || !coords) return [];
    return places.map((p) => bearingDeg(coords.lat, coords.lon, p.lat, p.lon));
  }, [places, coords]);

  if (!coords || !onlineLookups) return null;

  if (!places) {
    return (
      <div className="welcome-card rounded-lg border border-water p-3 animate-card-in [animation-delay:200ms]">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/55">Places of interest nearby</div>
        <div className="space-y-2" aria-busy="true">
          <SkeletonLine width="66%" />
          <SkeletonLine width="80%" />
          <SkeletonLine width="50%" />
        </div>
      </div>
    );
  }
  if (!places || places.length === 0) return null;

  return (
    <div className="welcome-card rounded-lg border border-water p-3 animate-card-in [animation-delay:200ms]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">Places of interest nearby</span>
        <span className="shrink-0 text-[10px] text-ink/35">{places.length}</span>
      </div>
      <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
        {places.map((p, i) => (
          <li key={p.url}>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-2 rounded px-1 py-1 text-sm transition-colors hover:bg-land/60"
              title={`${p.title} — ${compassOf(bearings[i] ?? 0)}, ${formatDistance(p.km)}`}
            >
              {/* Direction arrow — points to the place's true bearing. */}
              <span
                className="shrink-0 text-terracotta/70 group-hover:text-terracotta"
                style={{ transform: `rotate(${bearings[i] ?? 0}deg)`, transition: 'color 150ms' }}
                aria-hidden
              >
                ↑
              </span>
              <span className="min-w-0 flex-1 truncate text-ink/75 group-hover:text-terracotta">{p.title}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink/35">{compassOf(bearings[i] ?? 0)}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink/45">{formatDistance(p.km)}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-[10px] text-ink/35">tap a place to open it{showPoiPins ? ' · pinned on the map' : ''}</div>
    </div>
  );
}
