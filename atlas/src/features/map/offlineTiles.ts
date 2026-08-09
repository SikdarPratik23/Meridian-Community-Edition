/**
 * Offline map tiles — pre-download a region so the map still draws with no
 * internet at all.
 *
 * The service worker already caches tiles you happen to have *looked at*
 * (`vite.config.ts` → `runtimeCaching`), which is useless for the actual field
 * case: you want the valley you're walking into tomorrow, and tomorrow there is
 * no signal. So this module lets the user pick a bbox + zoom range up front and
 * pull those tiles into their own IndexedDB database (`meridian-tiles`), keyed
 * `z/x/y`, exactly like `data/media.ts` parks pending uploads in its own.
 *
 * Two hard limits are baked in, both deliberate:
 *
 *  - **OSM tile policy.** tile.openstreetmap.org is donated capacity and its
 *    usage policy forbids bulk downloading. A region download is therefore
 *    capped at `MAX_ZOOM` (16 — streets are legible, individual house numbers
 *    are not) and `MAX_REGION_TILES` tiles, with concurrency held to a handful
 *    of connections. That's "one hiking area", not "one country", which is the
 *    honest scope for a personal journal. Anyone wanting a country should run
 *    their own tile server and change `tileUrl`.
 *  - **Storage quota.** Raster tiles average ~14 KB, so 20 000 tiles is roughly
 *    280 MB — a real fraction of a phone's origin quota, which the entries and
 *    photos also live in. `estimateRegion` exists so the UI can show that number
 *    *before* downloading, and `cachedBytes` so the Data tab can show it after.
 *    Ask for persistent storage (`data/storage.ts`) or the browser may evict the
 *    lot on the day you need it.
 *
 * Every IndexedDB call fails soft: no database, private-mode block, quota
 * exceeded — the caller gets null/0 and the map falls back to the network.
 */

export interface TileCoord { z: number; x: number; y: number }

export interface BBox {
  /** Decimal degrees, WGS84. */
  west: number; south: number; east: number; north: number
}

export interface RegionEstimate {
  tileCount: number
  /** Rough bytes, assuming ~14 KB per raster tile. */
  estimatedBytes: number
}

export interface DownloadProgress {
  done: number
  total: number
  failed: number
}

/** Deepest zoom a region download will go to — see the OSM policy note above. */
export const MAX_ZOOM = 16;

/** Hard ceiling on tiles enumerated for one region (~280 MB at 14 KB each). */
export const MAX_REGION_TILES = 20_000;

/** Mean size of an OSM raster tile, used only for the pre-download estimate. */
export const BYTES_PER_TILE = 14 * 1024;

const DEFAULT_CONCURRENCY = 6;
const MAX_CONCURRENCY = 8;

/** The Web Mercator projection breaks down past this latitude. */
const MAX_LAT = 85.05112878;

function clampTileIndex(v: number, n: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(n - 1, Math.max(0, v));
}

/**
 * Longitude/latitude → tile x/y at a zoom (standard Web Mercator / slippy map).
 * Out-of-range longitude wraps (200°E is treated as 160°W; ±180 itself is left
 * alone so an eastern bbox edge of 180 lands on the last column, not the first)
 * and latitude is clamped to the projection's ±85.0511° limit, so no input —
 * including the poles — can produce a tile index outside [0, 2^z - 1].
 */
export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** Math.max(0, Math.floor(z));
  const wrapped = lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
  return clampTileIndex(Math.floor(((wrapped + 180) / 360) * n), n);
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** Math.max(0, Math.floor(z));
  const clamped = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  return clampTileIndex(Math.floor(((1 - merc / Math.PI) / 2) * n), n);
}

/** Zoom bounds, normalised: ordered, integral, and clamped to [0, MAX_ZOOM]. */
function zoomRange(minZoom: number, maxZoom: number): [number, number] {
  const a = Math.floor(Number.isFinite(minZoom) ? minZoom : 0);
  const b = Math.floor(Number.isFinite(maxZoom) ? maxZoom : 0);
  const hi = Math.min(MAX_ZOOM, Math.max(0, Math.max(a, b)));
  const lo = Math.min(hi, Math.max(0, Math.min(a, b)));
  return [lo, hi];
}

/**
 * The x column ranges (inclusive) a bbox covers. A bbox whose west is east of
 * its east crosses the antimeridian, and is read the way a map reader means it —
 * the short way round, through 180° — so it yields two ranges rather than the
 * whole globe minus the region.
 */
function xRanges(bbox: BBox, z: number): Array<[number, number]> {
  const n = 2 ** z;
  const west = lonToTileX(bbox.west, z);
  const east = lonToTileX(bbox.east, z);
  if (bbox.west > bbox.east) return [[west, n - 1], [0, east]];
  return [[Math.min(west, east), Math.max(west, east)]];
}

/** The y row range (inclusive, top row first) a bbox covers. */
function yRange(bbox: BBox, z: number): [number, number] {
  const a = latToTileY(bbox.north, z);
  const b = latToTileY(bbox.south, z);
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Every tile covering a bbox across an inclusive zoom range, shallowest zoom
 * first. Truncated at `MAX_REGION_TILES` — a coarse-to-fine order means a
 * truncated result is still a usable pyramid rather than a random slice, and
 * nothing here ever tries to allocate the millions of entries a whole-country
 * z16 request would imply. Check `estimateRegion` first if you need to warn.
 */
export function tilesForRegion(bbox: BBox, minZoom: number, maxZoom: number): TileCoord[] {
  const [lo, hi] = zoomRange(minZoom, maxZoom);
  const out: TileCoord[] = [];
  for (let z = lo; z <= hi; z++) {
    const [yTop, yBottom] = yRange(bbox, z);
    for (const [x0, x1] of xRanges(bbox, z)) {
      for (let x = x0; x <= x1; x++) {
        for (let y = yTop; y <= yBottom; y++) {
          if (out.length >= MAX_REGION_TILES) return out;
          out.push({ z, x, y });
        }
      }
    }
  }
  return out;
}

/**
 * Count + size estimate, computed arithmetically from the row/column spans — it
 * never enumerates, so it stays instant for a request of millions of tiles.
 * Reports the TRUE count, which may exceed `MAX_REGION_TILES`; that difference is
 * the point, it's what the UI needs to say "too big, zoom out".
 */
export function estimateRegion(bbox: BBox, minZoom: number, maxZoom: number): RegionEstimate {
  const [lo, hi] = zoomRange(minZoom, maxZoom);
  let tileCount = 0;
  for (let z = lo; z <= hi; z++) {
    const [yTop, yBottom] = yRange(bbox, z);
    const rows = yBottom - yTop + 1;
    let cols = 0;
    for (const [x0, x1] of xRanges(bbox, z)) cols += x1 - x0 + 1;
    tileCount += cols * rows;
  }
  return { tileCount, estimatedBytes: tileCount * BYTES_PER_TILE };
}

/** Cache key for a tile. */
export function tileKey(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** Build the OSM raster URL for a tile. Matches the style used by `Map.tsx`. */
export function tileUrl(tile: TileCoord): string {
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}

// --- Tile store -------------------------------------------------------------
// Its own database, so clearing cached tiles can never touch journal data.

const TILE_DB = 'meridian-tiles';
const TILE_STORE = 'tiles';

interface TileRecord {
  key: string;
  /** Kept alongside the key so a future eviction pass can drop deep zooms first. */
  z: number;
  x: number;
  y: number;
  bytes: number;
  blob: Blob;
  savedAt: number;
}

function openTiles(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('no indexedDB')); return; }
    const r = indexedDB.open(TILE_DB, 1);
    r.onupgradeneeded = () => {
      const store = r.result.createObjectStore(TILE_STORE, { keyPath: 'key' });
      // Indexing the size lets `cachedBytes` sum index keys without ever
      // deserialising a blob.
      store.createIndex('bytes', 'bytes');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function getCachedTile(tile: TileCoord): Promise<Blob | null> {
  try {
    const db = await openTiles();
    const tx = db.transaction(TILE_STORE, 'readonly');
    const rec = await new Promise<TileRecord | undefined>((res) => {
      const req = tx.objectStore(TILE_STORE).get(tileKey(tile));
      req.onsuccess = () => res(req.result as TileRecord | undefined);
      req.onerror = () => res(undefined);
    });
    db.close();
    return rec?.blob ?? null;
  } catch {
    return null;
  }
}

export async function putCachedTile(tile: TileCoord, blob: Blob): Promise<void> {
  try {
    const db = await openTiles();
    const tx = db.transaction(TILE_STORE, 'readwrite');
    const rec: TileRecord = {
      key: tileKey(tile), z: tile.z, x: tile.x, y: tile.y,
      bytes: blob.size, blob, savedAt: Date.now(),
    };
    tx.objectStore(TILE_STORE).put(rec);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  } catch {
    // Out of quota or no database: the map just fetches this tile again later.
  }
}

/** True when a tile is already stored, without reading its bytes back out. */
async function hasCachedTile(tile: TileCoord): Promise<boolean> {
  try {
    const db = await openTiles();
    const tx = db.transaction(TILE_STORE, 'readonly');
    const found = await new Promise<boolean>((res) => {
      const req = tx.objectStore(TILE_STORE).getKey(tileKey(tile));
      req.onsuccess = () => res(req.result !== undefined);
      req.onerror = () => res(false);
    });
    db.close();
    return found;
  } catch {
    return false;
  }
}

export async function cachedTileCount(): Promise<number> {
  try {
    const db = await openTiles();
    const tx = db.transaction(TILE_STORE, 'readonly');
    const n = await new Promise<number>((res) => {
      const req = tx.objectStore(TILE_STORE).count();
      req.onsuccess = () => res(req.result || 0);
      req.onerror = () => res(0);
    });
    db.close();
    return n;
  } catch {
    return 0;
  }
}

export async function cachedBytes(): Promise<number> {
  try {
    const db = await openTiles();
    const tx = db.transaction(TILE_STORE, 'readonly');
    const total = await new Promise<number>((res) => {
      let sum = 0;
      const req = tx.objectStore(TILE_STORE).index('bytes').openKeyCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { res(sum); return; }
        sum += typeof cur.key === 'number' ? cur.key : 0;
        cur.continue();
      };
      req.onerror = () => res(sum);
    });
    db.close();
    return total;
  } catch {
    return 0;
  }
}

export async function clearTileCache(): Promise<void> {
  try {
    const db = await openTiles();
    const tx = db.transaction(TILE_STORE, 'readwrite');
    tx.objectStore(TILE_STORE).clear();
    await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  } catch {
    /* nothing cached, nothing to clear */
  }
}

// --- Region download --------------------------------------------------------

/**
 * The three side-effecting operations a download performs. Split out so the
 * orchestration below (concurrency, skipping, failure counting, aborting) is
 * testable without IndexedDB or a network, and so a self-hosted tile source can
 * be dropped in without touching the loop.
 */
export interface TileIo {
  /** Already cached? Then the network is skipped entirely. */
  has(tile: TileCoord): Promise<boolean>;
  put(tile: TileCoord, blob: Blob): Promise<void>;
  /** Resolves null for any failure — a bad status, a dead network, an abort. */
  fetch(tile: TileCoord, signal?: AbortSignal): Promise<Blob | null>;
}

export interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Parallel requests, default 6, capped at 8 (OSM policy). */
  concurrency?: number;
  /** Override any part of the default IndexedDB + `fetch` I/O. */
  io?: Partial<TileIo>;
}

const defaultIo: TileIo = {
  has: hasCachedTile,
  put: putCachedTile,
  async fetch(tile, signal) {
    try {
      const res = await fetch(tileUrl(tile), { signal });
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  },
};

/**
 * Download every tile for a region, skipping ones already cached. Reports
 * progress after each tile and resolves with the final tally. Never rejects: a
 * tile that 404s, times out or won't store is counted in `failed`, because one
 * missing tile is a grey square, not a failed download. Aborting stops issuing
 * work and resolves with however far it got.
 */
export async function downloadRegion(
  bbox: BBox, minZoom: number, maxZoom: number,
  opts: DownloadOptions = {},
): Promise<DownloadProgress> {
  const io: TileIo = { ...defaultIo, ...opts.io };
  const tiles = tilesForRegion(bbox, minZoom, maxZoom);
  const progress: DownloadProgress = { done: 0, total: tiles.length, failed: 0 };
  const report = () => opts.onProgress?.({ ...progress });

  let next = 0;
  const worker = async () => {
    while (next < tiles.length && !opts.signal?.aborted) {
      const tile = tiles[next++];
      try {
        if (await io.has(tile)) {
          progress.done++;
        } else {
          const blob = await io.fetch(tile, opts.signal);
          if (blob) {
            await io.put(tile, blob);
            progress.done++;
          } else {
            progress.failed++;
          }
        }
      } catch {
        progress.failed++;
      }
      report();
    }
  };

  const lanes = Math.min(
    tiles.length,
    Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(opts.concurrency ?? DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY)),
  );
  await Promise.all(Array.from({ length: lanes }, worker));
  return progress;
}
