/**
 * Synthetic EXIF JPEG builder for tests.
 *
 * Rather than commit binary photo fixtures, these build a minimal but genuinely
 * spec-shaped JPEG in memory: SOI, an APP1 segment carrying a TIFF header with
 * IFD0 → a GPS IFD, then EOI. That lets the tests cover both byte orders, missing
 * hemisphere refs, zero denominators and truncation — cases real photos would
 * only give us by luck.
 *
 * Layout of the TIFF block (offsets relative to the TIFF header start):
 *   0   byte order ("II" / "MM")      2
 *   2   magic 42                      2
 *   4   IFD0 offset (= 8)             4
 *   8   IFD0 entry count (= 1)        2
 *   10  IFD0 entry: GPS IFD pointer  12
 *   22  next-IFD offset (= 0)         4
 *   26  GPS IFD entry count           2
 *   28  GPS entries                  12 each
 *   ..  next-IFD offset (= 0)         4
 *   ..  GPS latitude rationals       24
 *   ..  GPS longitude rationals      24
 */

const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TAG_GPS_IFD = 0x8825;

export interface GpsFixtureOptions {
  /** Byte order to encode with. Real cameras use both. */
  order?: 'little' | 'big';
  /** Hemisphere refs. Pass null to omit the ref entry entirely. */
  latRef?: 'N' | 'S' | null;
  lonRef?: 'E' | 'W' | null;
  /** Force a zero denominator in the latitude rationals ("no fix recorded"). */
  zeroDenominator?: boolean;
  /** Omit the latitude entry, leaving a partial GPS record. */
  omitLatitude?: boolean;
}

/** Split a positive decimal degree value into [deg, min, sec]. */
function toDms(value: number): [number, number, number] {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return [deg, min, sec];
}

/**
 * Build a JPEG whose EXIF records the given position. Coordinates are given as
 * DECIMAL DEGREES with sign (the refs are derived unless overridden), matching how
 * a person would state them; the encoder converts to the DMS rationals EXIF uses.
 */
export function jpegWithGps(
  latitude: number,
  longitude: number,
  opts: GpsFixtureOptions = {},
): ArrayBuffer {
  const little = (opts.order ?? 'little') === 'little';
  const latRef = opts.latRef === undefined ? (latitude >= 0 ? 'N' : 'S') : opts.latRef;
  const lonRef = opts.lonRef === undefined ? (longitude >= 0 ? 'E' : 'W') : opts.lonRef;

  const gpsEntries: Array<{ tag: number; type: number; count: number }> = [];
  if (latRef !== null) gpsEntries.push({ tag: 1, type: TYPE_ASCII, count: 2 });
  if (!opts.omitLatitude) gpsEntries.push({ tag: 2, type: TYPE_RATIONAL, count: 3 });
  if (lonRef !== null) gpsEntries.push({ tag: 3, type: TYPE_ASCII, count: 2 });
  gpsEntries.push({ tag: 4, type: TYPE_RATIONAL, count: 3 });

  const GPS_IFD_OFFSET = 26;
  const gpsDirSize = 2 + gpsEntries.length * 12 + 4;
  const latDataOffset = GPS_IFD_OFFSET + gpsDirSize;
  const lonDataOffset = latDataOffset + 24;
  const tiffSize = lonDataOffset + 24;

  const tiff = new ArrayBuffer(tiffSize);
  const t = new DataView(tiff);

  t.setUint16(0, little ? 0x4949 : 0x4d4d); // byte order is always written big-endian-agnostic
  t.setUint16(2, 42, little);
  t.setUint32(4, 8, little);

  // IFD0 — a single entry pointing at the GPS IFD.
  t.setUint16(8, 1, little);
  t.setUint16(10, TAG_GPS_IFD, little);
  t.setUint16(12, TYPE_LONG, little);
  t.setUint32(14, 1, little);
  t.setUint32(18, GPS_IFD_OFFSET, little);
  t.setUint32(22, 0, little); // no IFD1

  // GPS IFD.
  t.setUint16(GPS_IFD_OFFSET, gpsEntries.length, little);
  let at = GPS_IFD_OFFSET + 2;
  for (const entry of gpsEntries) {
    t.setUint16(at, entry.tag, little);
    t.setUint16(at + 2, entry.type, little);
    t.setUint32(at + 4, entry.count, little);
    if (entry.tag === 1) {
      // Inline ASCII: the ref character then a NUL.
      t.setUint8(at + 8, (latRef ?? 'N').charCodeAt(0));
      t.setUint8(at + 9, 0);
    } else if (entry.tag === 3) {
      t.setUint8(at + 8, (lonRef ?? 'E').charCodeAt(0));
      t.setUint8(at + 9, 0);
    } else if (entry.tag === 2) {
      t.setUint32(at + 8, latDataOffset, little);
    } else {
      t.setUint32(at + 8, lonDataOffset, little);
    }
    at += 12;
  }
  t.setUint32(at, 0, little); // end of GPS IFD

  // Rational payloads. Seconds keep two decimals via a /100 denominator.
  const writeDms = (offset: number, value: number, zeroDen = false) => {
    const [deg, min, sec] = toDms(value);
    const den = zeroDen ? 0 : 1;
    t.setUint32(offset, deg, little);
    t.setUint32(offset + 4, den, little);
    t.setUint32(offset + 8, min, little);
    t.setUint32(offset + 12, den, little);
    t.setUint32(offset + 16, Math.round(sec * 100), little);
    t.setUint32(offset + 20, zeroDen ? 0 : 100, little);
  };
  writeDms(latDataOffset, latitude, opts.zeroDenominator);
  writeDms(lonDataOffset, longitude);

  return wrapInJpeg(new Uint8Array(tiff));
}

/** Wrap a TIFF block in an EXIF APP1 segment inside a minimal JPEG. */
export function wrapInJpeg(tiff: Uint8Array): ArrayBuffer {
  const EXIF_SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const app1Length = 2 + EXIF_SIG.length + tiff.byteLength;
  const out = new Uint8Array(2 + 2 + app1Length + 2);

  let p = 0;
  out[p++] = 0xff; out[p++] = 0xd8; // SOI
  out[p++] = 0xff; out[p++] = 0xe1; // APP1
  out[p++] = (app1Length >> 8) & 0xff;
  out[p++] = app1Length & 0xff;
  for (const b of EXIF_SIG) out[p++] = b;
  out.set(tiff, p);
  p += tiff.byteLength;
  out[p] = 0xff; out[p + 1] = 0xd9; // EOI

  return out.buffer;
}

/** A JPEG with no EXIF at all — just SOI + a comment segment + EOI. */
export function jpegWithoutExif(): ArrayBuffer {
  const out = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xfe, 0x00, 0x04, 0x41, 0x42, // COM segment, 2 bytes of payload
    0xff, 0xd9, // EOI
  ]);
  return out.buffer;
}

/** A JPEG carrying an XMP APP1 (not EXIF) — must not be mistaken for EXIF. */
export function jpegWithXmpApp1(): ArrayBuffer {
  const sig = 'http://ns.adobe.com/xap/1.0/\0';
  const payload = new Uint8Array(sig.length);
  for (let i = 0; i < sig.length; i++) payload[i] = sig.charCodeAt(i);
  const length = 2 + payload.byteLength;
  const out = new Uint8Array(2 + 2 + length + 2);
  let p = 0;
  out[p++] = 0xff; out[p++] = 0xd8;
  out[p++] = 0xff; out[p++] = 0xe1;
  out[p++] = (length >> 8) & 0xff;
  out[p++] = length & 0xff;
  out.set(payload, p);
  p += payload.byteLength;
  out[p] = 0xff; out[p + 1] = 0xd9;
  return out.buffer;
}

/** Wrap bytes as a File, the way the editor's file input hands them over. */
export function fileFrom(
  buffer: ArrayBuffer,
  name = 'photo.jpg',
  type = 'image/jpeg',
): File {
  return new File([buffer], name, { type });
}
