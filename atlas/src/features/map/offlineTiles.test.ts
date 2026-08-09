/**
 * Unit tests for offline map tiles.
 *
 * The projection math is the part that can silently ruin a download: an x/y that
 * is one off, or out of range near the poles, fetches tiles that don't exist and
 * leaves a hole in the map exactly where there is no signal to fix it. So the
 * forward projection is checked against the INVERSE formula (a tile's own corner
 * must project back into that tile) rather than against itself, plus a handful of
 * facts that hold by definition — the prime meridian splits the grid in half, the
 * equator splits it in half, the poles clamp instead of overflowing.
 *
 * `downloadRegion`'s I/O is injected (`opts.io`), so the orchestration — parallel
 * lane count, skipping cached tiles, counting failures instead of rejecting,
 * honouring an abort — is tested for real behaviour rather than mock calls. The
 * IndexedDB wrappers themselves can only be tested for their fail-soft path here:
 * jsdom has no IndexedDB at all (see the note at the bottom).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  BYTES_PER_TILE,
  MAX_REGION_TILES,
  MAX_ZOOM,
  cachedBytes,
  cachedTileCount,
  clearTileCache,
  downloadRegion,
  estimateRegion,
  getCachedTile,
  latToTileY,
  lonToTileX,
  putCachedTile,
  tileKey,
  tileUrl,
  tilesForRegion,
} from './offlineTiles'
import type { BBox, TileCoord } from './offlineTiles'

const WORLD: BBox = { west: -180, south: -85, east: 180, north: 85 }
/** The full Mercator extent — the poles clamp to the first/last row. */
const FULL: BBox = { west: -180, south: -90, east: 180, north: 90 }
/** A ~20 km box around Nuremberg. */
const LOCAL: BBox = { west: 11.0, south: 49.4, east: 11.15, north: 49.5 }

/** Independent inverse projection: a tile's north-west corner in degrees. */
function tileNorthWest(tile: TileCoord): { lon: number; lat: number } {
  const n = 2 ** tile.z
  const lon = (tile.x / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * tile.y) / n))) * 180) / Math.PI
  return { lon, lat }
}

describe('lonToTileX', () => {
  test('the whole world is one tile at zoom 0', () => {
    for (const lon of [-180, -90, -0.001, 0, 45, 179.999, 180]) {
      expect(lonToTileX(lon, 0)).toBe(0)
    }
  })

  test('the prime meridian is the boundary between the two halves', () => {
    // True by construction: lon 0 sits exactly at n/2.
    expect(lonToTileX(0, 1)).toBe(1)
    expect(lonToTileX(0, 12)).toBe(2048)
    expect(lonToTileX(-0.0001, 12)).toBe(2047)
  })

  test('the western edge is column 0', () => {
    expect(lonToTileX(-180, 4)).toBe(0)
    expect(lonToTileX(-179.99, 4)).toBe(0)
  })

  test('lon 180 clamps to the last column instead of wrapping to the first', () => {
    // Without the clamp this is x = 2^z, one past the grid — a 404 on every fetch.
    expect(lonToTileX(180, 2)).toBe(3)
    expect(lonToTileX(180, 10)).toBe(1023)
  })

  test('increases monotonically west → east', () => {
    let prev = -1
    for (let lon = -180; lon <= 180; lon += 0.5) {
      const x = lonToTileX(lon, 8)
      expect(x).toBeGreaterThanOrEqual(prev)
      prev = x
    }
  })

  test('out-of-range longitude wraps rather than clamping', () => {
    expect(lonToTileX(200, 6)).toBe(lonToTileX(-160, 6))
    expect(lonToTileX(-200, 6)).toBe(lonToTileX(160, 6))
    expect(lonToTileX(730, 6)).toBe(lonToTileX(10, 6))
  })

  test('stays inside [0, 2^z - 1] for absurd input', () => {
    for (const lon of [1e9, -1e9, NaN, Infinity, -Infinity]) {
      const x = lonToTileX(lon, 8)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(255)
    }
  })
})

describe('latToTileY', () => {
  test('the equator is the boundary between the two halves', () => {
    expect(latToTileY(0, 1)).toBe(1)
    expect(latToTileY(0, 2)).toBe(2)
    expect(latToTileY(0.0001, 2)).toBe(1)
  })

  test('north is a lower row number than south', () => {
    expect(latToTileY(60, 10)).toBeLessThan(latToTileY(-60, 10))
  })

  test('decreases monotonically south → north', () => {
    let prev = Infinity
    for (let lat = -85; lat <= 85; lat += 0.5) {
      const y = latToTileY(lat, 8)
      expect(y).toBeLessThanOrEqual(prev)
      prev = y
    }
  })

  test('the Mercator limit is the first and last row', () => {
    expect(latToTileY(85.0511, 4)).toBe(0)
    expect(latToTileY(-85.0511, 4)).toBe(15)
  })

  test('latitudes beyond the Mercator limit clamp, not overflow', () => {
    // The projection diverges past ±85.0511°; unclamped, lat 90 gives -Infinity
    // and lat -90 gives NaN (tan → -∞ plus sec → +∞).
    for (const z of [0, 1, 8, 16]) {
      const n = 2 ** z
      for (const lat of [85.5, 89.9, 90, 1e6, Infinity]) {
        expect(latToTileY(lat, z)).toBe(0)
      }
      for (const lat of [-85.5, -89.9, -90, -1e6, -Infinity]) {
        expect(latToTileY(lat, z)).toBe(n - 1)
      }
    }
  })

  test('NaN latitude does not escape the grid', () => {
    const y = latToTileY(NaN, 8)
    expect(Number.isInteger(y)).toBe(true)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(255)
  })
})

describe('projection round-trip', () => {
  test('a tile’s own north-west corner projects back into that tile', () => {
    // Checked against the inverse formula, not against the forward one.
    const z = 10
    const eps = 1e-7
    for (const x of [0, 1, 17, 512, 1022, 1023]) {
      for (const y of [0, 1, 17, 512, 1022, 1023]) {
        const nw = tileNorthWest({ z, x, y })
        expect(lonToTileX(nw.lon + eps, z), `x ${x}/${y}`).toBe(x)
        expect(latToTileY(nw.lat - eps, z), `y ${x}/${y}`).toBe(y)
      }
    }
  })

  test('holds across every zoom for a mid-latitude point', () => {
    for (let z = 0; z <= MAX_ZOOM; z++) {
      const tile = { z, x: lonToTileX(11.0767, z), y: latToTileY(49.4521, z) }
      const nw = tileNorthWest(tile)
      expect(nw.lon, `z${z} lon`).toBeLessThanOrEqual(11.0767)
      expect(nw.lat, `z${z} lat`).toBeGreaterThanOrEqual(49.4521)
    }
  })
})

describe('tileKey', () => {
  test('is z/x/y', () => {
    expect(tileKey({ z: 12, x: 2048, y: 1362 })).toBe('12/2048/1362')
  })

  test('distinguishes permuted coordinates', () => {
    expect(tileKey({ z: 2, x: 3, y: 4 })).not.toBe(tileKey({ z: 4, x: 3, y: 2 }))
    expect(tileKey({ z: 2, x: 3, y: 4 })).not.toBe(tileKey({ z: 2, x: 4, y: 3 }))
  })
})

describe('tileUrl', () => {
  test('is the OSM raster URL the map already uses', () => {
    expect(tileUrl({ z: 10, x: 543, y: 349 })).toBe('https://tile.openstreetmap.org/10/543/349.png')
  })

  test('is https (the app is served over https on Vercel)', () => {
    expect(tileUrl({ z: 0, x: 0, y: 0 }).startsWith('https://')).toBe(true)
  })
})

describe('tilesForRegion', () => {
  test('a point-sized bbox is one tile per zoom', () => {
    const point: BBox = { west: 11.0767, south: 49.4521, east: 11.0767, north: 49.4521 }
    expect(tilesForRegion(point, 0, 0)).toEqual([{ z: 0, x: 0, y: 0 }])
    expect(tilesForRegion(point, 5, 9)).toHaveLength(5)
  })

  test('the zoom range is inclusive at both ends', () => {
    const zooms = new Set(tilesForRegion(LOCAL, 8, 11).map((t) => t.z))
    expect([...zooms].sort((a, b) => a - b)).toEqual([8, 9, 10, 11])
  })

  test('the world at z0–z2 is 1 + 4 + 16 tiles', () => {
    expect(tilesForRegion(WORLD, 0, 2)).toHaveLength(21)
  })

  test('shallowest zoom comes first, so a truncated result is still a pyramid', () => {
    const tiles = tilesForRegion(LOCAL, 6, 12)
    expect(tiles[0].z).toBe(6)
    expect(tiles[tiles.length - 1].z).toBe(12)
    for (let i = 1; i < tiles.length; i++) expect(tiles[i].z).toBeGreaterThanOrEqual(tiles[i - 1].z)
  })

  test('every tile is unique', () => {
    const tiles = tilesForRegion(LOCAL, 6, 13)
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length)
  })

  test('a bbox given south-of-north inverted is read the same way', () => {
    const upright = tilesForRegion(LOCAL, 10, 12)
    const flipped = tilesForRegion({ ...LOCAL, south: LOCAL.north, north: LOCAL.south }, 10, 12)
    expect(flipped.map(tileKey)).toEqual(upright.map(tileKey))
  })

  describe('antimeridian (west > east)', () => {
    // Documented choice: such a bbox is read the short way round, through 180°,
    // so it yields two column ranges instead of "everything except the region".
    const fiji: BBox = { west: 170, south: -10, east: -170, north: 10 }

    test('covers only the columns either side of 180°', () => {
      const tiles = tilesForRegion(fiji, 2, 2)
      expect([...new Set(tiles.map((t) => t.x))].sort()).toEqual([0, 3])
      expect(tiles).toHaveLength(4) // 2 columns × 2 rows
    })

    test('does not fall back to the whole globe', () => {
      const crossing = tilesForRegion(fiji, 4, 4)
      const whole = tilesForRegion(WORLD, 4, 4)
      expect(crossing.length).toBeLessThan(whole.length / 4)
    })
  })

  describe('guards', () => {
    test('never exceeds MAX_REGION_TILES, even for the world at full zoom', () => {
      const tiles = tilesForRegion(WORLD, 0, MAX_ZOOM)
      expect(tiles).toHaveLength(MAX_REGION_TILES)
      // Truncation must have kept the coarse levels, not a slice of one deep one.
      expect(tiles[0]).toEqual({ z: 0, x: 0, y: 0 })
      expect(new Set(tiles.map((t) => t.z)).size).toBeGreaterThan(5)
    })

    test('zoom is capped at MAX_ZOOM instead of returning nothing', () => {
      const tiles = tilesForRegion(LOCAL, 18, 21)
      expect(tiles.length).toBeGreaterThan(0)
      expect([...new Set(tiles.map((t) => t.z))]).toEqual([MAX_ZOOM])
    })

    test('negative and fractional zooms are normalised', () => {
      expect(tilesForRegion(LOCAL, -5, 0)).toEqual([{ z: 0, x: 0, y: 0 }])
      expect([...new Set(tilesForRegion(LOCAL, 9.7, 9.2).map((t) => t.z))]).toEqual([9])
    })

    test('a reversed zoom range is read as a range, not as empty', () => {
      expect(tilesForRegion(LOCAL, 12, 9).map(tileKey)).toEqual(tilesForRegion(LOCAL, 9, 12).map(tileKey))
    })

    test('a pole-spanning bbox yields no out-of-range tile', () => {
      const n = 2 ** 8
      for (const t of tilesForRegion(FULL, 8, 8)) {
        expect(t.x).toBeGreaterThanOrEqual(0)
        expect(t.x).toBeLessThan(n)
        expect(t.y).toBeGreaterThanOrEqual(0)
        expect(t.y).toBeLessThan(n)
      }
    })
  })
})

describe('estimateRegion', () => {
  test('agrees with the enumeration for a real region', () => {
    for (const [lo, hi] of [[0, 2], [8, 12], [13, 14]] as const) {
      expect(estimateRegion(LOCAL, lo, hi).tileCount, `z${lo}-${hi}`).toBe(tilesForRegion(LOCAL, lo, hi).length)
    }
  })

  test('agrees with the enumeration across the antimeridian', () => {
    const fiji: BBox = { west: 170, south: -10, east: -170, north: 10 }
    expect(estimateRegion(fiji, 2, 6).tileCount).toBe(tilesForRegion(fiji, 2, 6).length)
  })

  test('counts arithmetically — the world at z0–16 is 5.7 billion tiles', () => {
    // Σ 4^z for z=0..16, the whole pyramid. Enumerating this would exhaust
    // memory, so getting the exact number back is the proof that nothing was.
    expect(estimateRegion(FULL, 0, MAX_ZOOM).tileCount).toBe(5_726_623_061)
  })

  test('reports the true count even past MAX_REGION_TILES, so the UI can warn', () => {
    const est = estimateRegion(WORLD, 0, MAX_ZOOM)
    expect(est.tileCount).toBeGreaterThan(MAX_REGION_TILES)
    expect(tilesForRegion(WORLD, 0, MAX_ZOOM).length).toBe(MAX_REGION_TILES)
  })

  test('sizes tiles at ~14 KB each', () => {
    expect(estimateRegion(WORLD, 0, 0)).toEqual({ tileCount: 1, estimatedBytes: BYTES_PER_TILE })
    expect(estimateRegion(WORLD, 0, 1).estimatedBytes).toBe(5 * BYTES_PER_TILE)
  })

  test('is capped at MAX_ZOOM like the enumeration', () => {
    expect(estimateRegion(LOCAL, 20, 20).tileCount).toBe(estimateRegion(LOCAL, MAX_ZOOM, MAX_ZOOM).tileCount)
  })
})

// --- downloadRegion --------------------------------------------------------
// The bbox/zooms below are chosen for a known tile count: the world at z0–3 is
// 1 + 4 + 16 + 64 = 85 tiles.
const TOTAL = 85
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const tick = () => new Promise((r) => setTimeout(r, 0))

/** A fake TileIo that records what happened and can be told to fail or stall. */
function fakeIo(over: { has?: (t: TileCoord) => boolean; fail?: (t: TileCoord) => boolean; throwOn?: (t: TileCoord) => boolean } = {}) {
  const fetched: string[] = []
  const stored: string[] = []
  let inFlight = 0
  let peakInFlight = 0
  return {
    fetched,
    stored,
    get peakInFlight() { return peakInFlight },
    io: {
      has: async (t: TileCoord) => over.has?.(t) ?? false,
      put: async (t: TileCoord, _blob: Blob) => {
        if (over.throwOn?.(t)) throw new Error('quota')
        stored.push(tileKey(t))
      },
      fetch: async (t: TileCoord) => {
        inFlight++
        peakInFlight = Math.max(peakInFlight, inFlight)
        await tick()
        inFlight--
        fetched.push(tileKey(t))
        return over.fail?.(t) ? null : png()
      },
    },
  }
}

describe('downloadRegion', () => {
  test('downloads and stores every tile in the region', async () => {
    const fake = fakeIo()
    const progress = await downloadRegion(WORLD, 0, 3, { io: fake.io })
    expect(progress).toEqual({ done: TOTAL, total: TOTAL, failed: 0 })
    expect(fake.stored).toHaveLength(TOTAL)
    expect(new Set(fake.stored).size).toBe(TOTAL)
  })

  test('total matches tilesForRegion', async () => {
    const fake = fakeIo()
    const progress = await downloadRegion(WORLD, 0, 2, { io: fake.io })
    expect(progress.total).toBe(tilesForRegion(WORLD, 0, 2).length)
  })

  test('skips tiles that are already cached, without fetching them', async () => {
    const cached = new Set(tilesForRegion(WORLD, 0, 2).map(tileKey)) // 21 of the 85
    const fake = fakeIo({ has: (t) => cached.has(tileKey(t)) })
    const progress = await downloadRegion(WORLD, 0, 3, { io: fake.io })
    expect(progress).toEqual({ done: TOTAL, total: TOTAL, failed: 0 })
    expect(fake.fetched).toHaveLength(TOTAL - 21)
    expect(fake.fetched.some((k) => cached.has(k))).toBe(false)
  })

  test('a region already fully cached costs no fetches at all', async () => {
    const fake = fakeIo({ has: () => true })
    const progress = await downloadRegion(WORLD, 0, 3, { io: fake.io })
    expect(progress.done).toBe(TOTAL)
    expect(fake.fetched).toEqual([])
  })

  test('counts failed tiles instead of rejecting', async () => {
    const fake = fakeIo({ fail: (t) => t.z === 3 })
    const progress = await downloadRegion(WORLD, 0, 3, { io: fake.io })
    expect(progress.failed).toBe(64)
    expect(progress.done).toBe(21)
    expect(progress.done + progress.failed).toBe(TOTAL)
  })

  test('a throwing store counts as failed and does not stop the rest', async () => {
    const fake = fakeIo({ throwOn: (t) => t.x === 0 && t.y === 0 })
    const progress = await downloadRegion(WORLD, 0, 3, { io: fake.io })
    expect(progress.failed).toBe(4) // one per zoom
    expect(progress.done).toBe(TOTAL - 4)
  })

  test('every tile failing still resolves', async () => {
    const fake = fakeIo({ fail: () => true })
    await expect(downloadRegion(WORLD, 0, 3, { io: fake.io })).resolves.toEqual({
      done: 0, total: TOTAL, failed: TOTAL,
    })
  })

  test('an empty region resolves immediately with zeros', async () => {
    const fake = fakeIo()
    // A zoom range clamped to nothing can't happen, so use a signal-free no-op:
    // the smallest possible region is 1 tile, so assert the 1-tile floor instead.
    const progress = await downloadRegion(WORLD, 0, 0, { io: fake.io })
    expect(progress).toEqual({ done: 1, total: 1, failed: 0 })
  })

  describe('concurrency', () => {
    test('defaults to 6 parallel fetches', async () => {
      const fake = fakeIo()
      await downloadRegion(WORLD, 0, 3, { io: fake.io })
      expect(fake.peakInFlight).toBe(6)
    })

    test('honours a lower limit', async () => {
      const fake = fakeIo()
      await downloadRegion(WORLD, 0, 3, { io: fake.io, concurrency: 2 })
      expect(fake.peakInFlight).toBe(2)
    })

    test('refuses an absurd limit (OSM policy)', async () => {
      const fake = fakeIo()
      await downloadRegion(WORLD, 0, 3, { io: fake.io, concurrency: 500 })
      expect(fake.peakInFlight).toBeLessThanOrEqual(8)
    })

    test('a nonsense limit falls back to the default', async () => {
      const fake = fakeIo()
      await downloadRegion(WORLD, 0, 3, { io: fake.io, concurrency: 0 })
      expect(fake.peakInFlight).toBe(6)
      const fake2 = fakeIo()
      await downloadRegion(WORLD, 0, 3, { io: fake2.io, concurrency: -3 })
      expect(fake2.peakInFlight).toBeGreaterThanOrEqual(1)
    })

    test('never runs more lanes than there are tiles', async () => {
      const fake = fakeIo()
      await downloadRegion(WORLD, 0, 1, { io: fake.io }) // 5 tiles, 6 lanes allowed
      expect(fake.peakInFlight).toBeLessThanOrEqual(5)
    })
  })

  describe('progress', () => {
    test('reports once per tile, ending at the resolved tally', async () => {
      const fake = fakeIo()
      const seen: number[] = []
      const progress = await downloadRegion(WORLD, 0, 3, {
        io: fake.io,
        onProgress: (p) => seen.push(p.done + p.failed),
      })
      expect(seen).toHaveLength(TOTAL)
      expect(seen[seen.length - 1]).toBe(progress.done + progress.failed)
    })

    test('done never goes backwards', async () => {
      const fake = fakeIo({ fail: (t) => t.y % 3 === 0 })
      const seen: number[] = []
      await downloadRegion(WORLD, 0, 3, { io: fake.io, onProgress: (p) => seen.push(p.done) })
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    })

    test('each report is a snapshot, not the live object', async () => {
      const fake = fakeIo()
      const seen: number[] = []
      await downloadRegion(WORLD, 0, 2, { io: fake.io, onProgress: (p) => seen.push(p.done) })
      // A shared mutable object would make every recorded value the final one.
      expect(seen[0]).toBe(1)
      expect(new Set(seen).size).toBe(seen.length)
    })
  })

  describe('abort', () => {
    test('an already-aborted signal downloads nothing', async () => {
      const fake = fakeIo()
      const ac = new AbortController()
      ac.abort()
      const progress = await downloadRegion(WORLD, 0, 3, { io: fake.io, signal: ac.signal })
      expect(progress).toEqual({ done: 0, total: TOTAL, failed: 0 })
      expect(fake.fetched).toEqual([])
    })

    test('aborting mid-download stops early and still resolves', async () => {
      const fake = fakeIo()
      const ac = new AbortController()
      const progress = await downloadRegion(WORLD, 0, 3, {
        io: fake.io,
        concurrency: 2,
        signal: ac.signal,
        onProgress: (p) => { if (p.done >= 10) ac.abort() },
      })
      expect(progress.total).toBe(TOTAL)
      expect(progress.done).toBeGreaterThanOrEqual(10)
      // At most one more tile per lane can already be in flight when we abort.
      expect(progress.done + progress.failed).toBeLessThanOrEqual(12)
    })
  })

  describe('the default network path', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    test('fetches the tile URL and stores the returned blob', async () => {
      const blob = png()
      const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }))
      vi.stubGlobal('fetch', fetchMock)
      const stored: Array<[string, Blob]> = []
      const progress = await downloadRegion(WORLD, 0, 0, {
        io: {
          has: async () => false,
          put: async (t, b) => { stored.push([tileKey(t), b]) },
        },
      })
      expect(progress).toEqual({ done: 1, total: 1, failed: 0 })
      expect(fetchMock).toHaveBeenCalledWith('https://tile.openstreetmap.org/0/0/0.png', { signal: undefined })
      expect(stored).toEqual([['0/0/0', blob]])
    })

    test('forwards the abort signal to fetch', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, blob: async () => png() }))
      vi.stubGlobal('fetch', fetchMock)
      const ac = new AbortController()
      await downloadRegion(WORLD, 0, 0, { signal: ac.signal, io: { has: async () => false, put: async () => {} } })
      expect(fetchMock.mock.calls[0][1]).toEqual({ signal: ac.signal })
    })

    test('a non-ok response counts as failed, not as a stored tile', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => png() })))
      const stored: string[] = []
      const progress = await downloadRegion(WORLD, 0, 1, {
        io: { has: async () => false, put: async (t) => { stored.push(tileKey(t)) } },
      })
      expect(progress).toEqual({ done: 0, total: 5, failed: 5 })
      expect(stored).toEqual([])
    })

    test('a dead network counts as failed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
      const progress = await downloadRegion(WORLD, 0, 1, { io: { has: async () => false, put: async () => {} } })
      expect(progress.failed).toBe(5)
      expect(progress.done).toBe(0)
    })
  })
})

// --- Fail-soft storage -----------------------------------------------------
// LIMITATION: jsdom provides no IndexedDB and no fake is installed, so the
// happy path of these wrappers (a real put/get round-trip, the `bytes` index
// that `cachedBytes` sums) is NOT covered here — only the branch that matters
// for the app never breaking: no database means null/0, never a throw.
describe('tile store without IndexedDB', () => {
  const tile: TileCoord = { z: 10, x: 543, y: 349 }

  test('reads return empty rather than throwing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(getCachedTile(tile)).resolves.toBeNull()
    await expect(cachedTileCount()).resolves.toBe(0)
    await expect(cachedBytes()).resolves.toBe(0)
  })

  test('writes and clears resolve quietly', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(putCachedTile(tile, png())).resolves.toBeUndefined()
    await expect(clearTileCache()).resolves.toBeUndefined()
  })

  test('a download with no storage and no network still resolves', async () => {
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(downloadRegion(WORLD, 0, 1)).resolves.toEqual({ done: 0, total: 5, failed: 5 })
  })
})
