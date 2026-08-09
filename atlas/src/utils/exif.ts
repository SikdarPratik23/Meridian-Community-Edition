/**
 * EXIF GPS extraction — "where was this photo taken?".
 *
 * When you attach a photo shot on a phone or a GPS-enabled camera, its EXIF
 * metadata usually carries the coordinates. Reading them lets Meridian drop the
 * entry's pin exactly where the photo was taken, which is the single most useful
 * thing a field journal can do automatically.
 *
 * Written by hand rather than pulled from a library for the same reasons as the
 * rest of this app: no dependency, no network, works offline, and it only needs
 * one narrow slice of a large spec (the GPS IFD of a JPEG's APP1 segment).
 *
 * IMPORTANT — read the ORIGINAL File, never the downscaled copy. Re-encoding
 * through a canvas (see `utils/image.ts`) discards all EXIF, so GPS extraction
 * has to happen before/independently of downscaling.
 *
 * Scope and limits, deliberately:
 *   - JPEG only. PNG has no EXIF GPS in practice, and HEIC/HEIF uses a different
 *     container this doesn't parse. Both simply return null (fails soft).
 *   - Many phones and most messaging apps STRIP GPS when sharing or exporting a
 *     photo. A null result is completely normal and must never be treated as an
 *     error — the user just places the pin themselves as before.
 */
import type { Coordinates } from '../types';

/** How much of a file to read when looking for EXIF. APP1 sits within the first
 *  few KB in practice; 256 KB is generous and avoids loading a 12 MP photo just
 *  to read its header. */
const HEADER_BYTES = 256 * 1024;

// TIFF field types we care about.
const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

const TAG_GPS_IFD = 0x8825;
const GPS_LAT_REF = 1;
const GPS_LAT = 2;
const GPS_LON_REF = 3;
const GPS_LON = 4;

const TYPE_SIZE: Record<number, number> = {
  [TYPE_BYTE]: 1,
  [TYPE_ASCII]: 1,
  [TYPE_SHORT]: 2,
  [TYPE_LONG]: 4,
  [TYPE_RATIONAL]: 8,
};

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset of the entry's value, relative to the TIFF header start. */
  valueOffset: number;
}

/** Locate the TIFF header inside a JPEG's EXIF APP1 segment. Returns its offset
 *  from the start of the buffer, or -1 when there is no EXIF. */
function findTiffStart(view: DataView): number {
  // SOI
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return -1;

  let pos = 2;
  while (pos + 4 <= view.byteLength) {
    // Markers are 0xFF-prefixed; skip any fill bytes.
    if (view.getUint8(pos) !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = view.getUint8(pos + 1);

    // Standalone markers carry no length payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      pos += 2;
      continue;
    }
    // Start of scan — image data begins; EXIF would have appeared before this.
    if (marker === 0xda) return -1;

    const length = view.getUint16(pos + 2);
    if (length < 2) return -1; // malformed

    if (marker === 0xe1) {
      // APP1 — is it the EXIF flavour? ("Exif\0\0"), as opposed to XMP.
      const sig = pos + 4;
      if (
        sig + 6 <= view.byteLength &&
        view.getUint8(sig) === 0x45 && // E
        view.getUint8(sig + 1) === 0x78 && // x
        view.getUint8(sig + 2) === 0x69 && // i
        view.getUint8(sig + 3) === 0x66 && // f
        view.getUint8(sig + 4) === 0x00 &&
        view.getUint8(sig + 5) === 0x00
      ) {
        return sig + 6;
      }
    }
    pos += 2 + length;
  }
  return -1;
}

/** Read an IFD's entries. Returns an empty array if the offset is out of range. */
function readIfd(view: DataView, tiff: number, ifdOffset: number, little: boolean): Entry[] {
  const base = tiff + ifdOffset;
  if (base + 2 > view.byteLength || base < tiff) return [];

  const count = view.getUint16(base, little);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const at = base + 2 + i * 12;
    if (at + 12 > view.byteLength) break;

    const tag = view.getUint16(at, little);
    const type = view.getUint16(at + 2, little);
    const n = view.getUint32(at + 4, little);
    const size = (TYPE_SIZE[type] ?? 0) * n;
    // Values of 4 bytes or fewer are stored inline in the value field; anything
    // larger is an offset from the TIFF header.
    const valueOffset = size <= 4 ? at + 8 : tiff + view.getUint32(at + 8, little);
    entries.push({ tag, type, count: n, valueOffset });
  }
  return entries;
}

/** Read `count` RATIONALs (num/den pairs) as numbers. */
function readRationals(view: DataView, offset: number, count: number, little: boolean): number[] | null {
  if (offset < 0 || offset + count * 8 > view.byteLength) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const num = view.getUint32(offset + i * 8, little);
    const den = view.getUint32(offset + i * 8 + 4, little);
    if (den === 0) return null; // a zero denominator means "no value recorded"
    out.push(num / den);
  }
  return out;
}

/** Read a single ASCII character (the N/S/E/W hemisphere refs are 2-byte ASCII). */
function readAsciiRef(view: DataView, offset: number): string | null {
  if (offset < 0 || offset >= view.byteLength) return null;
  return String.fromCharCode(view.getUint8(offset)).toUpperCase();
}

/** Degrees/minutes/seconds → signed decimal degrees. */
function dmsToDecimal(dms: number[], ref: string): number {
  const [deg = 0, min = 0, sec = 0] = dms;
  const value = deg + min / 60 + sec / 3600;
  return ref === 'S' || ref === 'W' ? -value : value;
}

/**
 * Pull the GPS position out of a JPEG's EXIF, as `[longitude, latitude]` —
 * Meridian's storage order throughout.
 *
 * Returns null, without throwing, for every "no usable position" case: a
 * non-JPEG, a JPEG with no EXIF, EXIF with no GPS IFD, a partial/corrupt GPS
 * record, an out-of-range value, or the useless exact `0,0`.
 */
export function readExifGps(buffer: ArrayBuffer): Coordinates | null {
  try {
    const view = new DataView(buffer);
    const tiff = findTiffStart(view);
    if (tiff < 0 || tiff + 8 > view.byteLength) return null;

    // Byte order: "II" little-endian, "MM" big-endian.
    const order = view.getUint16(tiff);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;

    // Magic 42 confirms we read the byte order correctly.
    if (view.getUint16(tiff + 2, little) !== 42) return null;

    const ifd0Offset = view.getUint32(tiff + 4, little);
    const gpsPointer = readIfd(view, tiff, ifd0Offset, little).find((e) => e.tag === TAG_GPS_IFD);
    if (!gpsPointer) return null;

    const gpsIfdOffset = view.getUint32(gpsPointer.valueOffset, little);
    const gps = readIfd(view, tiff, gpsIfdOffset, little);

    const latEntry = gps.find((e) => e.tag === GPS_LAT);
    const lonEntry = gps.find((e) => e.tag === GPS_LON);
    const latRefEntry = gps.find((e) => e.tag === GPS_LAT_REF);
    const lonRefEntry = gps.find((e) => e.tag === GPS_LON_REF);
    if (!latEntry || !lonEntry) return null;

    const lat = readRationals(view, latEntry.valueOffset, Math.min(3, latEntry.count), little);
    const lon = readRationals(view, lonEntry.valueOffset, Math.min(3, lonEntry.count), little);
    if (!lat || !lon || lat.length < 1 || lon.length < 1) return null;

    // A missing ref defaults to the positive hemisphere rather than failing.
    const latRef = (latRefEntry && readAsciiRef(view, latRefEntry.valueOffset)) || 'N';
    const lonRef = (lonRefEntry && readAsciiRef(view, lonRefEntry.valueOffset)) || 'E';

    const latitude = dmsToDecimal(lat, latRef);
    const longitude = dmsToDecimal(lon, lonRef);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    // Exactly 0,0 is Meridian's "no pin" sentinel and is what cameras write when
    // they have a GPS chip but no fix — treat it as no position.
    if (latitude === 0 && longitude === 0) return null;

    return [longitude, latitude];
  } catch {
    // A truncated or adversarial file must never break attaching a photo.
    return null;
  }
}

/**
 * Read a photo File's GPS position. Reads only the file's leading bytes, so this
 * is cheap even for a large photo. Never throws — returns null when there's
 * nothing usable.
 */
export async function readPhotoGps(file: File): Promise<Coordinates | null> {
  // Only JPEG carries EXIF GPS in a form this parses. `type` can be empty for a
  // file picked from some Android providers, so fall back to the extension.
  const isJpeg =
    /^image\/jpe?g$/i.test(file.type) || (!file.type && /\.jpe?g$/i.test(file.name));
  if (!isJpeg) return null;

  try {
    const slice = file.slice(0, Math.min(HEADER_BYTES, file.size));
    return readExifGps(await slice.arrayBuffer());
  } catch {
    return null;
  }
}
