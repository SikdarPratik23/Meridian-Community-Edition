/**
 * Unit tests for EXIF GPS extraction.
 *
 * Two things matter here. First, correctness: coordinates come out as
 * `[longitude, latitude]` with the right sign, from either byte order. Second and
 * more important, ROBUSTNESS — this parser reads arbitrary bytes the user picked
 * from their phone, so every malformed, truncated or hostile input must return
 * null rather than throw. A crash here would break attaching a photo at all.
 */
import { describe, expect, test } from 'vitest'
import { readExifGps, readPhotoGps } from './exif'
import {
  fileFrom,
  jpegWithGps,
  jpegWithXmpApp1,
  jpegWithoutExif,
  wrapInJpeg,
} from '../test/exifFixtures'

describe('readExifGps — reading a position', () => {
  test('reads a northern/eastern position', () => {
    const coords = readExifGps(jpegWithGps(49.4521, 11.0767))
    expect(coords).not.toBeNull()
    const [lon, lat] = coords!
    expect(lat).toBeCloseTo(49.4521, 4)
    expect(lon).toBeCloseTo(11.0767, 4)
  })

  test('returns [longitude, latitude] — Meridian’s storage order', () => {
    // The most likely integration bug: handing the pin a reversed pair. At these
    // coordinates a swap would move the entry from Germany to Somalia.
    const [lon, lat] = readExifGps(jpegWithGps(49.4521, 11.0767))!
    expect(lon).toBeLessThan(lat)
    expect(lon).toBeCloseTo(11.0767, 4)
  })

  test('reads a southern/western position with the right signs', () => {
    const [lon, lat] = readExifGps(jpegWithGps(-34.6037, -58.3816))!
    expect(lat).toBeCloseTo(-34.6037, 4)
    expect(lon).toBeCloseTo(-58.3816, 4)
  })

  test('reads a southern/eastern position (Sydney)', () => {
    const [lon, lat] = readExifGps(jpegWithGps(-33.8688, 151.2093))!
    expect(lat).toBeCloseTo(-33.8688, 4)
    expect(lon).toBeCloseTo(151.2093, 4)
  })

  test('handles big-endian ("MM") EXIF as well as little-endian', () => {
    const [lon, lat] = readExifGps(jpegWithGps(49.4521, 11.0767, { order: 'big' }))!
    expect(lat).toBeCloseTo(49.4521, 4)
    expect(lon).toBeCloseTo(11.0767, 4)
  })

  test('both byte orders agree on the same position', () => {
    const le = readExifGps(jpegWithGps(22.5726, 88.3639, { order: 'little' }))!
    const be = readExifGps(jpegWithGps(22.5726, 88.3639, { order: 'big' }))!
    expect(le[0]).toBeCloseTo(be[0], 6)
    expect(le[1]).toBeCloseTo(be[1], 6)
  })

  test('a missing hemisphere ref defaults to the positive hemisphere', () => {
    const [lon, lat] = readExifGps(jpegWithGps(49.4521, 11.0767, { latRef: null, lonRef: null }))!
    expect(lat).toBeGreaterThan(0)
    expect(lon).toBeGreaterThan(0)
  })

  test('an explicit S ref negates the latitude even for a positive DMS value', () => {
    const [, lat] = readExifGps(jpegWithGps(33.8688, 151.2093, { latRef: 'S' }))!
    expect(lat).toBeCloseTo(-33.8688, 4)
  })

  test('an explicit W ref negates the longitude', () => {
    const [lon] = readExifGps(jpegWithGps(40.7128, 74.006, { lonRef: 'W' }))!
    expect(lon).toBeCloseTo(-74.006, 4)
  })

  test('reads a position near the poles', () => {
    const [, lat] = readExifGps(jpegWithGps(78.2232, 15.6469))!
    expect(lat).toBeCloseTo(78.2232, 3)
  })

  test('reads a position near the antimeridian', () => {
    const [lon] = readExifGps(jpegWithGps(-16.5, 179.9))!
    expect(lon).toBeCloseTo(179.9, 3)
  })
})

describe('readExifGps — no usable position (all must return null, never throw)', () => {
  test('a JPEG with no EXIF segment', () => {
    expect(readExifGps(jpegWithoutExif())).toBeNull()
  })

  test('an XMP APP1 segment is not mistaken for EXIF', () => {
    expect(readExifGps(jpegWithXmpApp1())).toBeNull()
  })

  test('an empty buffer', () => {
    expect(readExifGps(new ArrayBuffer(0))).toBeNull()
  })

  test('a buffer that is not a JPEG at all', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(readExifGps(png.buffer)).toBeNull()
  })

  test('random noise', () => {
    const noise = new Uint8Array(4096)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + 11) % 256
    expect(readExifGps(noise.buffer)).toBeNull()
  })

  test('a JPEG truncated mid-EXIF', () => {
    const full = new Uint8Array(jpegWithGps(49.4521, 11.0767))
    expect(readExifGps(full.slice(0, 20).buffer)).toBeNull()
  })

  test('every truncation length is handled without throwing', () => {
    // The strongest robustness check: cut the file at every possible byte.
    const full = new Uint8Array(jpegWithGps(49.4521, 11.0767))
    for (let len = 0; len < full.byteLength; len++) {
      expect(() => readExifGps(full.slice(0, len).buffer)).not.toThrow()
    }
  })

  test('a GPS record with a zero denominator ("GPS chip, no fix")', () => {
    expect(readExifGps(jpegWithGps(49.4521, 11.0767, { zeroDenominator: true }))).toBeNull()
  })

  test('a partial GPS record missing the latitude', () => {
    expect(readExifGps(jpegWithGps(49.4521, 11.0767, { omitLatitude: true }))).toBeNull()
  })

  test('exactly 0,0 is rejected as Meridian’s "no pin" sentinel', () => {
    // Cameras write 0,0 when they have GPS hardware but never got a fix. Storing
    // it would drop the entry on Null Island and be indistinguishable from
    // "unlocated", which is what the rest of the app uses 0,0 to mean.
    expect(readExifGps(jpegWithGps(0, 0))).toBeNull()
  })

  test('a bad TIFF byte-order mark', () => {
    const tiff = new Uint8Array(128)
    tiff[0] = 0x58 // 'X' — neither II nor MM
    tiff[1] = 0x58
    expect(readExifGps(wrapInJpeg(tiff))).toBeNull()
  })

  test('a missing TIFF magic 42', () => {
    const tiff = new Uint8Array(128)
    const view = new DataView(tiff.buffer)
    view.setUint16(0, 0x4949)
    view.setUint16(2, 1234, true) // should be 42
    expect(readExifGps(wrapInJpeg(tiff))).toBeNull()
  })

  test('an IFD offset pointing past the end of the buffer', () => {
    const tiff = new Uint8Array(128)
    const view = new DataView(tiff.buffer)
    view.setUint16(0, 0x4949)
    view.setUint16(2, 42, true)
    view.setUint32(4, 0xfffffff0, true) // absurd IFD0 offset
    expect(readExifGps(wrapInJpeg(tiff))).toBeNull()
  })

  test('EXIF present but with no GPS IFD (a scanner or edited photo)', () => {
    const tiff = new Uint8Array(64)
    const view = new DataView(tiff.buffer)
    view.setUint16(0, 0x4949)
    view.setUint16(2, 42, true)
    view.setUint32(4, 8, true)
    view.setUint16(8, 1, true) // one entry…
    view.setUint16(10, 0x010f, true) // …Make, not a GPS pointer
    view.setUint16(12, 2, true)
    view.setUint32(14, 1, true)
    view.setUint32(18, 0, true)
    expect(readExifGps(wrapInJpeg(tiff))).toBeNull()
  })

  test('an IFD claiming an enormous entry count is bounded by the buffer', () => {
    const tiff = new Uint8Array(64)
    const view = new DataView(tiff.buffer)
    view.setUint16(0, 0x4949)
    view.setUint16(2, 42, true)
    view.setUint32(4, 8, true)
    view.setUint16(8, 60000, true) // way more entries than there are bytes
    expect(() => readExifGps(wrapInJpeg(tiff))).not.toThrow()
    expect(readExifGps(wrapInJpeg(tiff))).toBeNull()
  })
})

describe('readPhotoGps — reading from a File', () => {
  test('reads GPS from a JPEG File', async () => {
    const file = fileFrom(jpegWithGps(49.4521, 11.0767))
    const coords = await readPhotoGps(file)
    expect(coords).not.toBeNull()
    expect(coords![1]).toBeCloseTo(49.4521, 4)
  })

  test('accepts image/jpg as well as image/jpeg', async () => {
    const file = fileFrom(jpegWithGps(49.4521, 11.0767), 'photo.jpg', 'image/jpg')
    expect(await readPhotoGps(file)).not.toBeNull()
  })

  test('falls back to the file extension when the MIME type is empty', async () => {
    // Some Android document providers hand over a File with no type.
    const file = fileFrom(jpegWithGps(49.4521, 11.0767), 'IMG_0042.JPG', '')
    expect(await readPhotoGps(file)).not.toBeNull()
  })

  test('skips a PNG without reading it', async () => {
    const file = fileFrom(jpegWithGps(49.4521, 11.0767), 'photo.png', 'image/png')
    expect(await readPhotoGps(file)).toBeNull()
  })

  test('skips a HEIC (different container, not parsed)', async () => {
    const file = fileFrom(jpegWithGps(49.4521, 11.0767), 'photo.heic', 'image/heic')
    expect(await readPhotoGps(file)).toBeNull()
  })

  test('a JPEG with no GPS resolves to null rather than rejecting', async () => {
    await expect(readPhotoGps(fileFrom(jpegWithoutExif()))).resolves.toBeNull()
  })

  test('an empty file resolves to null', async () => {
    await expect(readPhotoGps(fileFrom(new ArrayBuffer(0)))).resolves.toBeNull()
  })

  test('never rejects, even for hostile bytes', async () => {
    const noise = new Uint8Array(1024)
    noise[0] = 0xff
    noise[1] = 0xd8 // looks like a JPEG, then garbage
    for (let i = 2; i < noise.length; i++) noise[i] = 0xff
    await expect(readPhotoGps(fileFrom(noise.buffer))).resolves.toBeNull()
  })
})
