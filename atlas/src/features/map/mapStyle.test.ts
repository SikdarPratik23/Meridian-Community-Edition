/**
 * Unit tests for the map style.
 *
 * A MapLibre style fails at RUNTIME, in ways that are easy to miss visually: a
 * layer referencing a source that isn't declared renders nothing, a symbol layer
 * without a `glyphs` URL throws, and a typo in a `source-layer` name silently
 * draws an empty layer. These tests check the structural invariants that a human
 * looking at the map would not reliably notice.
 */
import { describe, expect, test } from 'vitest'
import {
  MAP_STYLE_OPTIONS,
  hybridStyle,
  isDarkTheme,
  mapStyleFor,
  parchmentStyle,
  rasterStyle,
  satelliteStyle,
  vectorFallbackFor,
} from './mapStyle'

/** Read the background layer's colour. Goes through `unknown` because MapLibre's
 *  discriminated LayerSpecification union doesn't overlap a plain string record. */
function backgroundColor(style: ReturnType<typeof parchmentStyle>): string {
  const paint = (style.layers[0] as unknown as { paint: Record<string, string> }).paint
  return paint['background-color']
}

/** The OpenMapTiles source layers this style is allowed to reference. */
const OPENMAPTILES_LAYERS = new Set([
  'water',
  'waterway',
  'water_name',
  'landcover',
  'landuse',
  'park',
  'building',
  'transportation',
  'transportation_name',
  'place',
  'boundary',
  'aeroway',
  'boundary_name',
  'housenumber',
  'poi',
  'mountain_peak',
])

describe('rasterStyle', () => {
  test('is a valid v8 style', () => {
    const style = rasterStyle()
    expect(style.version).toBe(8)
    expect(style.layers).toHaveLength(1)
  })

  test('declares the OSM raster source and attributes it', () => {
    const style = rasterStyle()
    const source = style.sources.osm as { type: string; tiles: string[]; attribution: string }
    expect(source.type).toBe('raster')
    expect(source.tiles[0]).toContain('tile.openstreetmap.org')
    expect(source.attribution).toContain('OpenStreetMap')
  })

  test('its single layer references the declared source', () => {
    const style = rasterStyle()
    expect((style.layers[0] as { source: string }).source).toBe('osm')
  })

  test('needs no glyphs, since it has no symbol layers', () => {
    const style = rasterStyle()
    expect(style.layers.some((l) => l.type === 'symbol')).toBe(false)
  })

  test('returns a fresh object each call, so callers can mutate safely', () => {
    expect(rasterStyle()).not.toBe(rasterStyle())
  })
})

describe('parchmentStyle', () => {
  for (const dark of [false, true]) {
    const label = dark ? 'dark' : 'light'

    describe(`${label} theme`, () => {
      const style = parchmentStyle(dark)

      test('is a valid v8 style with a name', () => {
        expect(style.version).toBe(8)
        expect(typeof style.name).toBe('string')
        expect(style.name!.length).toBeGreaterThan(0)
      })

      test('declares the vector source with attribution', () => {
        const source = style.sources.openmaptiles as {
          type: string
          url: string
          attribution: string
        }
        expect(source.type).toBe('vector')
        expect(source.url).toContain('openfreemap.org')
        expect(source.attribution).toContain('OpenStreetMap')
      })

      test('declares a glyphs URL — symbol layers throw without one', () => {
        expect(style.glyphs).toBeDefined()
        expect(style.glyphs).toContain('{fontstack}')
        expect(style.glyphs).toContain('{range}')
      })

      test('every layer references a declared source', () => {
        const declared = new Set(Object.keys(style.sources))
        for (const layer of style.layers) {
          if (layer.type === 'background') continue
          const source = (layer as { source?: string }).source
          expect(source, `layer "${layer.id}" has no source`).toBeDefined()
          expect(declared.has(source!), `layer "${layer.id}" → unknown source "${source}"`).toBe(true)
        }
      })

      test('every layer references a real OpenMapTiles source-layer', () => {
        for (const layer of style.layers) {
          if (layer.type === 'background') continue
          const sourceLayer = (layer as { 'source-layer'?: string })['source-layer']
          expect(sourceLayer, `layer "${layer.id}" has no source-layer`).toBeDefined()
          expect(
            OPENMAPTILES_LAYERS.has(sourceLayer!),
            `layer "${layer.id}" → unknown source-layer "${sourceLayer}"`,
          ).toBe(true)
        }
      })

      test('layer ids are unique', () => {
        const ids = style.layers.map((l) => l.id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      test('starts with a background layer, so no white flash shows through', () => {
        expect(style.layers[0].type).toBe('background')
      })

      test('every symbol layer sets a text field and colour', () => {
        const symbols = style.layers.filter((l) => l.type === 'symbol')
        expect(symbols.length).toBeGreaterThan(0)
        for (const layer of symbols) {
          const l = layer as { layout?: Record<string, unknown>; paint?: Record<string, unknown> }
          expect(l.layout?.['text-field'], `${layer.id} has no text-field`).toBeDefined()
          expect(l.layout?.['text-font'], `${layer.id} has no text-font`).toBeDefined()
          expect(l.paint?.['text-color'], `${layer.id} has no text-color`).toBeDefined()
        }
      })

      test('every label has a halo, so text stays readable over any fill', () => {
        for (const layer of style.layers.filter((l) => l.type === 'symbol')) {
          const paint = (layer as { paint?: Record<string, unknown> }).paint
          expect(paint?.['text-halo-color'], `${layer.id} has no halo`).toBeDefined()
          expect(paint?.['text-halo-width'], `${layer.id} has no halo width`).toBeDefined()
        }
      })

      test('only fonts OpenFreeMap actually serves are requested', () => {
        // A font nobody serves means blank labels at runtime.
        const served = new Set([
          'Noto Sans Regular',
          'Noto Sans Bold',
          'Noto Sans Italic',
        ])
        for (const layer of style.layers.filter((l) => l.type === 'symbol')) {
          const fonts = (layer as { layout?: { 'text-font'?: string[] } }).layout?.['text-font'] ?? []
          for (const font of fonts) {
            expect(served.has(font), `layer "${layer.id}" wants unserved font "${font}"`).toBe(true)
          }
        }
      })

      test('labels are drawn last, so nothing paints over text', () => {
        const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol')
        const lastNonSymbol = style.layers.reduce(
          (last, l, i) => (l.type === 'symbol' ? last : i),
          -1,
        )
        expect(firstSymbol).toBeGreaterThan(lastNonSymbol)
      })

      test('road casings are drawn before their fills', () => {
        const ids = style.layers.map((l) => l.id)
        expect(ids.indexOf('road-major-casing')).toBeLessThan(ids.indexOf('road-major'))
        expect(ids.indexOf('road-minor-casing')).toBeLessThan(ids.indexOf('road-minor'))
      })

      test('water is drawn over land cover but under buildings', () => {
        const ids = style.layers.map((l) => l.id)
        expect(ids.indexOf('landcover-green')).toBeLessThan(ids.indexOf('water'))
        expect(ids.indexOf('water')).toBeLessThan(ids.indexOf('building'))
      })

      test('every colour is a valid hex value', () => {
        const hex = /^#[0-9a-fA-F]{6}$/
        const colourKeys = ['background-color', 'fill-color', 'line-color', 'text-color', 'text-halo-color', 'fill-outline-color']
        for (const layer of style.layers) {
          const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {}
          for (const key of colourKeys) {
            const value = paint[key]
            if (typeof value === 'string') {
              expect(hex.test(value), `layer "${layer.id}" ${key} = "${value}"`).toBe(true)
            }
          }
        }
      })

      test('opacity values stay within 0–1', () => {
        for (const layer of style.layers) {
          const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {}
          for (const [key, value] of Object.entries(paint)) {
            if (key.endsWith('-opacity') && typeof value === 'number') {
              expect(value, `layer "${layer.id}" ${key}`).toBeGreaterThanOrEqual(0)
              expect(value, `layer "${layer.id}" ${key}`).toBeLessThanOrEqual(1)
            }
          }
        }
      })
    })
  }

  test('light and dark differ in colour but not in structure', () => {
    // The whole point of generating both from one function: the dark map must be
    // the same cartography, not a second style that can drift.
    const light = parchmentStyle(false)
    const dark = parchmentStyle(true)
    expect(dark.layers.map((l) => l.id)).toEqual(light.layers.map((l) => l.id))
    expect(dark.layers.map((l) => l.type)).toEqual(light.layers.map((l) => l.type))
    expect(backgroundColor(dark)).not.toBe(backgroundColor(light))
  })

  test('the dark background is darker than the light one', () => {
    const brightness = (style: ReturnType<typeof parchmentStyle>) => {
      const hex = backgroundColor(style)
      return parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    }
    expect(brightness(parchmentStyle(true))).toBeLessThan(brightness(parchmentStyle(false)))
  })

  test('uses no network host other than OpenFreeMap', () => {
    // The app makes no keyed or tracked requests; a stray third-party host here
    // would be a privacy regression as well as a broken-offline one.
    const json = JSON.stringify(parchmentStyle(false))
    const hosts = [...json.matchAll(/https?:\/\/([^/"]+)/g)].map((m) => m[1])
    expect(new Set(hosts)).toEqual(new Set(['tiles.openfreemap.org']))
  })

  test('requests no API key or token', () => {
    const json = JSON.stringify(parchmentStyle(false)).toLowerCase()
    expect(json).not.toContain('api_key')
    expect(json).not.toContain('apikey')
    expect(json).not.toContain('access_token')
    expect(json).not.toContain('{key}')
  })
})

describe('satelliteStyle', () => {
  const style = satelliteStyle()

  test('is a valid v8 style', () => {
    expect(style.version).toBe(8)
  })

  test('declares the imagery source, attributed to Esri', () => {
    const source = style.sources.satellite as {
      type: string
      tiles: string[]
      maxzoom: number
      attribution: string
    }
    expect(source.type).toBe('raster')
    expect(source.tiles[0]).toContain('arcgisonline.com')
    expect(source.attribution).toContain('Esri')
  })

  test('the tile template is z/y/x — Esri orders row before column', () => {
    // Swapping these two silently returns the wrong part of the world, which is
    // exactly the kind of bug a glance at the map would not catch.
    const url = (style.sources.satellite as { tiles: string[] }).tiles[0]
    expect(url).toContain('{z}/{y}/{x}')
  })

  test('caps zoom at the service depth, so it over-zooms instead of 404ing', () => {
    expect((style.sources.satellite as { maxzoom: number }).maxzoom).toBe(19)
  })

  test('starts with a dark background, so a missing tile reads as loading', () => {
    expect(style.layers[0].type).toBe('background')
  })

  test('has no symbol layers, so it needs no glyphs', () => {
    expect(style.layers.some((l) => l.type === 'symbol')).toBe(false)
    expect(style.glyphs).toBeUndefined()
  })

  test('every layer references a declared source', () => {
    const declared = new Set(Object.keys(style.sources))
    for (const layer of style.layers) {
      if (layer.type === 'background') continue
      expect(declared.has((layer as { source: string }).source)).toBe(true)
    }
  })

  test('requests no API key or token', () => {
    const json = JSON.stringify(style).toLowerCase()
    for (const secret of ['api_key', 'apikey', 'access_token', '{key}', 'token=']) {
      expect(json).not.toContain(secret)
    }
  })
})

describe('hybridStyle', () => {
  const style = hybridStyle()

  test('is a valid v8 style with a name', () => {
    expect(style.version).toBe(8)
    expect(style.name).toBeTruthy()
  })

  test('declares both sources — imagery underneath, vector overlay on top', () => {
    expect((style.sources.satellite as { type: string }).type).toBe('raster')
    expect((style.sources.openmaptiles as { type: string }).type).toBe('vector')
  })

  test('declares a glyphs URL — its label layers would throw without one', () => {
    expect(style.glyphs).toContain('{fontstack}')
    expect(style.glyphs).toContain('{range}')
  })

  test('the imagery is drawn before every overlay layer', () => {
    const ids = style.layers.map((l) => l.id)
    const imagery = ids.indexOf('satellite')
    expect(imagery).toBeGreaterThan(-1)
    for (const layer of style.layers.slice(imagery + 1)) {
      expect((layer as { source?: string }).source, `"${layer.id}" is over the imagery`).toBe(
        'openmaptiles',
      )
    }
  })

  test('labels are drawn last, so nothing paints over text', () => {
    const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol')
    const lastNonSymbol = style.layers.reduce((last, l, i) => (l.type === 'symbol' ? last : i), -1)
    expect(firstSymbol).toBeGreaterThan(lastNonSymbol)
  })

  test('labels a place everywhere parchment does — the same label set', () => {
    const labelsOf = (s: { layers: Array<{ id: string; type: string }> }) =>
      s.layers.filter((l) => l.type === 'symbol').map((l) => l.id)
    expect(labelsOf(style)).toEqual(labelsOf(parchmentStyle(false)))
  })

  test('label text is white with a dark halo, to survive arbitrary imagery', () => {
    for (const layer of style.layers.filter((l) => l.type === 'symbol')) {
      const paint = (layer as { paint: Record<string, unknown> }).paint
      expect(paint['text-halo-color']).toBe('#12171D')
      expect(paint['text-halo-width'], `${layer.id} halo`).toBeGreaterThan(1.5)
    }
  })

  test('the overlay stays translucent, so the ground reads through it', () => {
    // The whole point of hybrid over plain OSM: you can still SEE the terrain.
    for (const id of ['hybrid-road-major', 'hybrid-road-minor', 'hybrid-boundary']) {
      const layer = style.layers.find((l) => l.id === id) as unknown as {
        paint: Record<string, number>
      }
      expect(layer, `no layer "${id}"`).toBeDefined()
      expect(layer.paint['line-opacity'], `${id} is opaque`).toBeLessThan(1)
    }
  })

  test('layer ids are unique', () => {
    const ids = style.layers.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every layer references a declared source', () => {
    const declared = new Set(Object.keys(style.sources))
    for (const layer of style.layers) {
      if (layer.type === 'background') continue
      const source = (layer as { source?: string }).source
      expect(declared.has(source!), `layer "${layer.id}" → unknown source "${source}"`).toBe(true)
    }
  })

  test('every vector layer references a real OpenMapTiles source-layer', () => {
    for (const layer of style.layers) {
      if ((layer as { source?: string }).source !== 'openmaptiles') continue
      const sourceLayer = (layer as { 'source-layer'?: string })['source-layer']
      expect(
        OPENMAPTILES_LAYERS.has(sourceLayer!),
        `layer "${layer.id}" → unknown source-layer "${sourceLayer}"`,
      ).toBe(true)
    }
  })

  test('only fonts OpenFreeMap actually serves are requested', () => {
    const served = new Set(['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'])
    for (const layer of style.layers.filter((l) => l.type === 'symbol')) {
      const fonts = (layer as { layout?: { 'text-font'?: string[] } }).layout?.['text-font'] ?? []
      for (const font of fonts) {
        expect(served.has(font), `layer "${layer.id}" wants unserved font "${font}"`).toBe(true)
      }
    }
  })

  test('requests no API key or token', () => {
    const json = JSON.stringify(style).toLowerCase()
    for (const secret of ['api_key', 'apikey', 'access_token', '{key}', 'token=']) {
      expect(json).not.toContain(secret)
    }
  })

  test('uses only the two expected hosts', () => {
    const json = JSON.stringify(style)
    const hosts = [...json.matchAll(/https?:\/\/([^/"]+)/g)].map((m) => m[1])
    expect(new Set(hosts)).toEqual(new Set(['tiles.openfreemap.org', 'server.arcgisonline.com']))
  })
})

describe('mapStyleFor', () => {
  test('parchment resolves to the vector style', () => {
    expect(mapStyleFor('parchment', false).sources.openmaptiles).toBeDefined()
  })

  test('osm resolves to the raster style', () => {
    expect(mapStyleFor('osm', false).sources.osm).toBeDefined()
  })

  test('satellite resolves to imagery with no labels', () => {
    const style = mapStyleFor('satellite', false)
    expect(style.sources.satellite).toBeDefined()
    expect(style.layers.some((l) => l.type === 'symbol')).toBe(false)
  })

  test('hybrid resolves to imagery WITH labels', () => {
    const style = mapStyleFor('hybrid', false)
    expect(style.sources.satellite).toBeDefined()
    expect(style.layers.some((l) => l.type === 'symbol')).toBe(true)
  })

  test('an unknown id falls back to a real style rather than throwing', () => {
    // A blob from a future version, or a corrupted one, still gets a map.
    const style = mapStyleFor('nonsense' as never, false)
    expect(style.version).toBe(8)
    expect(style.layers.length).toBeGreaterThan(0)
  })

  test('the theme flag only affects the parchment style', () => {
    // Imagery is a photograph of the ground — it looks the same at midnight.
    for (const id of ['osm', 'satellite', 'hybrid'] as const) {
      expect(JSON.stringify(mapStyleFor(id, true))).toBe(JSON.stringify(mapStyleFor(id, false)))
    }
    expect(JSON.stringify(mapStyleFor('parchment', true))).not.toBe(
      JSON.stringify(mapStyleFor('parchment', false)),
    )
  })
})

describe('vectorFallbackFor', () => {
  test('hybrid keeps its imagery and loses only the labels', () => {
    expect(vectorFallbackFor('hybrid')).toBe('satellite')
  })

  test('everything else falls back to raster OSM, which is cached offline', () => {
    for (const id of ['parchment', 'osm', 'satellite'] as const) {
      expect(vectorFallbackFor(id)).toBe('osm')
    }
  })

  test('a fallback never itself depends on vector tiles', () => {
    // Otherwise the fallback could fail for the very reason the original did.
    for (const option of MAP_STYLE_OPTIONS) {
      const style = mapStyleFor(vectorFallbackFor(option.id), false)
      expect(style.sources.openmaptiles, `${option.id} → vector fallback`).toBeUndefined()
    }
  })
})

describe('isDarkTheme', () => {
  test('follows the html dark class that theme.ts toggles', () => {
    document.documentElement.classList.remove('dark')
    expect(isDarkTheme()).toBe(false)
    document.documentElement.classList.add('dark')
    expect(isDarkTheme()).toBe(true)
    document.documentElement.classList.remove('dark')
  })
})

describe('MAP_STYLE_OPTIONS', () => {
  test('offers every style id, the default first', () => {
    expect(MAP_STYLE_OPTIONS.map((o) => o.id)).toEqual(['hybrid', 'satellite', 'parchment', 'osm'])
  })

  test('every option has a label and an explanatory hint', () => {
    for (const option of MAP_STYLE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.hint.length).toBeGreaterThan(20)
    }
  })

  test('each option id resolves to a real style', () => {
    for (const option of MAP_STYLE_OPTIONS) {
      expect(mapStyleFor(option.id, false).version).toBe(8)
    }
  })
})
