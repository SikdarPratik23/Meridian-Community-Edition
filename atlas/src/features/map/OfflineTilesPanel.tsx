import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useDialogs } from '../../components/ui/dialogs';
import ProgressBar from '../../components/ui/ProgressBar';
import {
  BYTES_PER_TILE,
  MAX_REGION_TILES,
  MAX_ZOOM,
  cachedBytes,
  cachedTileCount,
  clearTileCache,
  downloadRegion,
  estimateRegion,
  type BBox,
  type DownloadProgress,
} from './offlineTiles';

/**
 * Download map tiles for an area so the map works with no signal.
 *
 * This is the feature that makes Meridian a genuine *field* journal: the journal
 * itself has always been offline-first, but the map went blank the moment you
 * left coverage — which is exactly when you're most likely to be out somewhere
 * worth journaling about.
 *
 * The region is taken from wherever the map is currently centred rather than by
 * drawing a box: a "download what I'm looking at" affordance needs no new map
 * interaction mode, and choosing a radius is easier to reason about than dragging
 * a rectangle on a small screen.
 *
 * Two things are surfaced honestly rather than hidden, because both can bite:
 *  - **The size estimate**, before anything is downloaded. Tiles quadruple with
 *    each zoom level, so a modest-looking radius at street zoom is a lot of data.
 *  - **The tile server's limits.** These come from OpenStreetMap's volunteer-run
 *    servers, so the panel caps the area, caps the zoom, and says plainly that
 *    this is for a region you're about to visit — not for hoarding the map.
 */

const RADII_KM = [2, 5, 10, 25];
/** Detail levels offered. The upper bound is the module's own MAX_ZOOM. */
const DETAIL_LEVELS = [
  { maxZoom: 13, label: 'Town', hint: 'roads and place names' },
  { maxZoom: 15, label: 'Street', hint: 'individual streets' },
  { maxZoom: MAX_ZOOM, label: 'Detailed', hint: 'buildings and paths' },
];
const MIN_ZOOM = 10;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A square bounding box of `radiusKm` around a point. Longitude degrees shrink
 *  with latitude, so the east–west span is divided by cos(lat) to keep the box
 *  roughly square on the ground rather than in degrees. */
function boxAround(lon: number, lat: number, radiusKm: number): BBox {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    west: lon - lonDelta,
    east: lon + lonDelta,
    south: Math.max(-85, lat - latDelta),
    north: Math.min(85, lat + latDelta),
  };
}

export default function OfflineTilesPanel() {
  const mapCenter = useAtlasStore((s) => s.mapCenter);
  const coords = useAtlasStore((s) => s.coords);
  const { confirm } = useDialogs();

  const [radiusKm, setRadiusKm] = useState(5);
  const [maxZoom, setMaxZoom] = useState(15);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [cached, setCached] = useState<{ count: number; bytes: number } | null>(null);
  const [done, setDone] = useState<DownloadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Centre on your GPS fix if there is one, else on wherever the map is looking.
  const center: [number, number] | null =
    coords ? [coords.lon, coords.lat] : mapCenter && !(mapCenter[0] === 0 && mapCenter[1] === 0) ? mapCenter : null;

  const refreshCached = useCallback(async () => {
    const [count, bytes] = await Promise.all([cachedTileCount(), cachedBytes()]);
    setCached({ count, bytes });
  }, []);

  // Reading how much is already cached is exactly the "subscribe to an external
  // system on mount" case effects exist for — the state lands in a promise
  // callback, not synchronously, but the rule can't see through the async call.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshCached(); }, [refreshCached]);
  // Never leave a download running after the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const bbox = center ? boxAround(center[0], center[1], radiusKm) : null;
  const estimate = bbox ? estimateRegion(bbox, MIN_ZOOM, maxZoom) : null;
  const tooBig = !!estimate && estimate.tileCount > MAX_REGION_TILES;

  const start = async () => {
    if (!bbox || tooBig) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setDone(null);
    setProgress({ done: 0, total: estimate?.tileCount ?? 0, failed: 0 });
    try {
      const result = await downloadRegion(bbox, MIN_ZOOM, maxZoom, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setDone(result);
    } finally {
      abortRef.current = null;
      setProgress(null);
      void refreshCached();
    }
  };

  const stop = () => abortRef.current?.abort();

  const clear = async () => {
    const ok = await confirm({
      title: 'Delete downloaded map tiles?',
      message: 'The map will need the network again for these areas. Your journal entries are not affected.',
      confirmLabel: 'Delete tiles',
      variant: 'danger',
    });
    if (!ok) return;
    await clearTileCache();
    setDone(null);
    void refreshCached();
  };

  const downloading = progress !== null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-2 rounded border border-water bg-land/60 p-3">
      <div className="text-xs font-medium text-ink/70">🗺 Offline map area</div>

      {!center ? (
        <p className="text-[11px] leading-relaxed text-ink/50">
          Open the map (or allow location) first — Meridian downloads the area around where the
          map is looking.
        </p>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-ink/50">
            Download the map around {coords ? 'your location' : 'the map centre'} so it still works with
            no signal.
          </p>

          <div className="space-y-1.5">
            <span className="text-[11px] text-ink/45">Area</span>
            <div className="flex flex-wrap gap-1.5">
              {RADII_KM.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={downloading}
                  onClick={() => setRadiusKm(r)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                    radiusKm === r ? 'border-terracotta bg-terracotta text-white' : 'border-water text-ink/65 hover:bg-land'
                  }`}
                >
                  {r} km
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] text-ink/45">Detail</span>
            <div className="flex flex-wrap gap-1.5">
              {DETAIL_LEVELS.map((level) => (
                <button
                  key={level.maxZoom}
                  type="button"
                  disabled={downloading}
                  onClick={() => setMaxZoom(level.maxZoom)}
                  title={level.hint}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                    maxZoom === level.maxZoom ? 'border-terracotta bg-terracotta text-white' : 'border-water text-ink/65 hover:bg-land'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {estimate && (
            <p className={`text-[11px] ${tooBig ? 'text-terracotta' : 'text-ink/50'}`}>
              {tooBig ? (
                <>
                  That's {estimate.tileCount.toLocaleString()} tiles — too many to download in one go
                  (the limit is {MAX_REGION_TILES.toLocaleString()}). Pick a smaller area or less detail.
                </>
              ) : (
                <>
                  About <strong>{estimate.tileCount.toLocaleString()}</strong> tiles,{' '}
                  <strong>{formatBytes(estimate.estimatedBytes)}</strong> (at ~{formatBytes(BYTES_PER_TILE)} each).
                </>
              )}
            </p>
          )}

          {downloading ? (
            <div className="space-y-1.5">
              <ProgressBar value={percent / 100} aria-label="Download progress" />
              <div className="flex items-center justify-between text-[11px] text-ink/50">
                <span className="u-numeric">
                  {progress.done.toLocaleString()} / {progress.total.toLocaleString()} tiles
                  {progress.failed > 0 && ` · ${progress.failed} failed`}
                </span>
                <button type="button" onClick={stop} className="text-ink/60 underline hover:text-ink">
                  Stop
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={tooBig}
              className="btn btn-secondary btn-sm btn-block"
            >
              ⬇ Download this area
            </button>
          )}

          {done && !downloading && (
            <p className="text-[11px] text-forest">
              Saved {(done.done - done.failed).toLocaleString()} tiles.
              {done.failed > 0 && ` ${done.failed} couldn't be fetched — run it again to retry those.`}
            </p>
          )}
        </>
      )}

      {cached && cached.count > 0 && (
        <div className="flex items-center justify-between border-t border-water pt-2 text-[11px] text-ink/50">
          <span className="u-numeric">
            {cached.count.toLocaleString()} tiles stored · {formatBytes(cached.bytes)}
          </span>
          <button type="button" onClick={clear} className="text-ink/50 underline hover:text-terracotta">
            Delete
          </button>
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-ink/35">
        Tiles come from OpenStreetMap's volunteer-run servers. Please download only areas you're
        actually going to — not the whole map.
      </p>
    </div>
  );
}
