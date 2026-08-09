/**
 * Unit tests for the GIS export path (GeoJSON + GPX).
 *
 * This is the output other tools consume — QGIS, ArcGIS, Google Earth — so
 * malformed output is invisible in Meridian itself and only shows up as a broken
 * import somewhere else. The two things most worth guarding: coordinate ORDER
 * (GeoJSON is [lon, lat] and getting it backwards silently puts entries in the
 * wrong hemisphere) and XML escaping (an apostrophe in a journal entry must not
 * be able to break the GPX document).
 */
import { describe, expect, test } from 'vitest'
import { isLocated, locatedCount, toGPX, toGeoJSON } from './geoExport'
import { journal, place } from '../test/factories'

describe('isLocated', () => {
  test('an entry with a real pin is located', () => {
    expect(isLocated(journal({ longitude: 11.0767, latitude: 49.4521 }))).toBe(true)
  })

  test('the 0,0 sentinel is NOT located', () => {
    expect(isLocated(journal())).toBe(false)
  })

  test('a pin on the equator but not the prime meridian is located', () => {
    expect(isLocated(journal({ longitude: 11.0767, latitude: 0 }))).toBe(true)
  })

  test('a pin on the prime meridian but not the equator is located', () => {
    expect(isLocated(journal({ longitude: 0, latitude: 49.4521 }))).toBe(true)
  })

  test('negative coordinates are located', () => {
    expect(isLocated(journal({ longitude: -58.38, latitude: -34.6 }))).toBe(true)
  })
})

describe('locatedCount', () => {
  test('counts only located entries', () => {
    const events = [
      journal({ longitude: 11, latitude: 49 }),
      journal(),
      journal({ longitude: 13, latitude: 52 }),
      journal(),
    ]
    expect(locatedCount(events)).toBe(2)
  })

  test('is zero for an empty journal', () => {
    expect(locatedCount([])).toBe(0)
  })
})

describe('toGeoJSON', () => {
  test('produces a valid FeatureCollection', () => {
    const out = JSON.parse(toGeoJSON([journal({ longitude: 11.0767, latitude: 49.4521 })]))
    expect(out.type).toBe('FeatureCollection')
    expect(Array.isArray(out.features)).toBe(true)
    expect(out.features).toHaveLength(1)
    expect(out.features[0].type).toBe('Feature')
    expect(out.features[0].geometry.type).toBe('Point')
  })

  test('coordinates are [longitude, latitude] per EPSG:4326', () => {
    const out = JSON.parse(toGeoJSON([journal({ longitude: 11.0767, latitude: 49.4521 })]))
    expect(out.features[0].geometry.coordinates).toEqual([11.0767, 49.4521])
  })

  test('skips unlocated entries so nothing lands on Null Island', () => {
    const out = JSON.parse(
      toGeoJSON([journal(), journal({ longitude: 11, latitude: 49 }), journal()]),
    )
    expect(out.features).toHaveLength(1)
    expect(out.features[0].geometry.coordinates).toEqual([11, 49])
  })

  test('an empty journal still produces a valid (empty) FeatureCollection', () => {
    const out = JSON.parse(toGeoJSON([]))
    expect(out).toEqual({ type: 'FeatureCollection', features: [] })
  })

  test('carries the journal metadata into properties', () => {
    const e = journal({
      id: 'abc',
      title: 'Summit',
      longitude: 11,
      latitude: 49,
      location_name: 'Zugspitze',
      tags: ['hiking', 'alps'],
      content_markdown: '# Notes\n\nCold up here.',
      mood: 'elated',
      weather_condition: 'clear',
      weather_temperature: -4.5,
    })
    const props = JSON.parse(toGeoJSON([e])).features[0].properties
    expect(props).toMatchObject({
      id: 'abc',
      type: 'journal',
      title: 'Summit',
      location_name: 'Zugspitze',
      tags: ['hiking', 'alps'],
      content: '# Notes\n\nCold up here.',
      mood: 'elated',
      weather: 'clear',
      temperature_c: -4.5,
    })
  })

  test('absent optional fields become null rather than being dropped', () => {
    // A stable property set matters for GIS attribute tables — a missing key and
    // a null value are different things to QGIS.
    const props = JSON.parse(toGeoJSON([journal({ longitude: 11, latitude: 49 })]))
      .features[0].properties
    expect(props.location_name).toBeNull()
    expect(props.mood).toBeNull()
    expect(props.weather).toBeNull()
    expect(props.temperature_c).toBeNull()
  })

  test('place entries omit the journal-only properties', () => {
    const props = JSON.parse(toGeoJSON([place({ longitude: 11, latitude: 49 })]))
      .features[0].properties
    expect(props.type).toBe('place')
    expect('content' in props).toBe(false)
  })

  test('unicode content survives the round-trip', () => {
    const e = journal({ longitude: 11, latitude: 49, content_markdown: 'আজ আমি হাঁটলাম 🌍' })
    const props = JSON.parse(toGeoJSON([e])).features[0].properties
    expect(props.content).toBe('আজ আমি হাঁটলাম 🌍')
  })
})

describe('toGPX', () => {
  const located = (over = {}) => journal({ longitude: 11.0767, latitude: 49.4521, ...over })

  test('produces a GPX 1.1 document with the right namespace', () => {
    const gpx = toGPX([located()])
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(gpx).toContain('<gpx version="1.1" creator="Meridian" xmlns="http://www.topografix.com/GPX/1/1">')
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true)
  })

  test('waypoint attributes are lat/lon (GPX order, the reverse of GeoJSON)', () => {
    const gpx = toGPX([located()])
    expect(gpx).toContain('<wpt lat="49.4521" lon="11.0767">')
  })

  test('every located entry becomes exactly one waypoint', () => {
    const gpx = toGPX([
      located({ timestamp: '2026-07-15T10:00:00.000Z' }),
      located({ timestamp: '2026-07-15T11:00:00.000Z' }),
      journal(), // unlocated — skipped
    ])
    expect(gpx.match(/<wpt /g)).toHaveLength(2)
  })

  test('waypoints are sorted oldest → newest regardless of input order', () => {
    const gpx = toGPX([
      located({ title: 'Third', timestamp: '2026-07-15T12:00:00.000Z' }),
      located({ title: 'First', timestamp: '2026-07-15T10:00:00.000Z' }),
      located({ title: 'Second', timestamp: '2026-07-15T11:00:00.000Z' }),
    ])
    const order = [...gpx.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1])
    expect(order).toEqual(['First', 'Second', 'Third'])
  })

  test('does not mutate the caller’s array while sorting', () => {
    const events = [
      located({ title: 'B', timestamp: '2026-07-15T12:00:00.000Z' }),
      located({ title: 'A', timestamp: '2026-07-15T10:00:00.000Z' }),
    ]
    toGPX(events)
    expect(events.map((e) => e.title)).toEqual(['B', 'A'])
  })

  test('escapes the five XML-significant characters in titles', () => {
    const gpx = toGPX([located({ title: `Fish & <chips> "quoted" 'single'` })])
    expect(gpx).toContain('<name>Fish &amp; &lt;chips&gt; &quot;quoted&quot; &apos;single&apos;</name>')
    // The raw characters must not survive anywhere in the name node.
    expect(gpx).not.toContain('<chips>')
  })

  test('escaping cannot be used to inject GPX elements from entry text', () => {
    // The adversarial case: a journal body that tries to close the waypoint and
    // open its own. If escaping works, no second <wpt appears.
    const gpx = toGPX([
      located({ content_markdown: '</desc></wpt><wpt lat="0" lon="0"><name>evil</name></wpt>' }),
    ])
    expect(gpx.match(/<wpt /g)).toHaveLength(1)
    expect(gpx).toContain('&lt;/desc&gt;')
  })

  test('desc carries the place name and the note body', () => {
    const gpx = toGPX([located({ location_name: 'Nuremberg', content_markdown: 'Warm evening.' })])
    expect(gpx).toContain('<desc>Nuremberg\n\nWarm evening.</desc>')
  })

  test('desc is omitted entirely when there is nothing to describe', () => {
    const gpx = toGPX([located({ location_name: undefined, content_markdown: '' })])
    expect(gpx).not.toContain('<desc>')
  })

  test('a whitespace-only body does not produce an empty desc', () => {
    const gpx = toGPX([located({ location_name: undefined, content_markdown: '   \n  ' })])
    expect(gpx).not.toContain('<desc>')
  })

  test('an empty journal still produces a well-formed empty document', () => {
    const gpx = toGPX([])
    expect(gpx).toContain('<gpx')
    expect(gpx).toContain('</gpx>')
    expect(gpx).not.toContain('<wpt')
  })

  test('timestamps are emitted as-is in the time element', () => {
    const gpx = toGPX([located({ timestamp: '2026-07-15T10:30:00.000Z' })])
    expect(gpx).toContain('<time>2026-07-15T10:30:00.000Z</time>')
  })
})
