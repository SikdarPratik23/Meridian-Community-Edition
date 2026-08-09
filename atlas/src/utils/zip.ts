/**
 * A minimal ZIP writer — enough to bundle a folder of text files.
 *
 * Meridian has a standing rule that exports work offline with no dependency, so
 * rather than pull in a compression library this writes the ZIP format directly
 * using the STORE method (no compression). Markdown compresses well, so the
 * trade-off is a larger file in exchange for ~90 lines of well-understood code and
 * zero bytes of dependency. Every unzip tool reads stored entries.
 *
 * Deliberately out of scope: DEFLATE, ZIP64 (so >4 GB archives or >65 535 files
 * aren't supported), encryption, directory entries. A journal export is far from
 * any of those limits.
 *
 * Format reference: PKWARE APPNOTE.TXT sections 4.3.7 (local header), 4.3.12
 * (central directory) and 4.3.16 (end of central directory).
 */

export interface ZipEntry {
  /** Path inside the archive, using forward slashes (e.g. `entries/2026-07-15.md`). */
  path: string;
  /** File contents. Text is encoded as UTF-8.
   *  Typed with an explicit `ArrayBuffer` backing because `Blob` only accepts
   *  views over a plain ArrayBuffer, not the SharedArrayBuffer that a bare
   *  `Uint8Array` (i.e. `Uint8Array<ArrayBufferLike>`) also admits. */
  content: string | Uint8Array<ArrayBuffer>;
  /** Modification time recorded in the archive. Defaults to the DOS epoch so
   *  output is byte-stable when no date is given (keeps tests deterministic). */
  date?: Date;
}

/** CRC-32 (IEEE 802.3), computed with a lazily-built lookup table. */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Pack a Date into the DOS time/date pair ZIP uses. */
function dosDateTime(date: Date): { time: number; date: number } {
  // DOS time has 2-second resolution and a 1980 epoch. Anything earlier is
  // clamped to 1980, which is what every other zip writer does.
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const encoder = new TextEncoder();

function toBytes(content: string | Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

/**
 * Build a ZIP archive from a list of entries.
 *
 * Paths are used verbatim (minus any leading slash) so callers control the folder
 * structure. Duplicate paths are the caller's problem — unzip tools handle them
 * inconsistently, so `markdownExport` de-duplicates before calling this.
 */
export function createZip(entries: ZipEntry[]): Blob {
  const EPOCH = new Date(1980, 0, 1);
  // Typed as BlobPart, not Uint8Array: a `Uint8Array<ArrayBufferLike>` (which is
  // what a caller-supplied array may be, since ArrayBufferLike admits
  // SharedArrayBuffer) is not assignable to BlobPart under current lib types.
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(stripLeadingSlashes(entry.path));
    const data = toBytes(entry.content);
    const crc = crc32(data);
    const { time, date } = dosDateTime(entry.date ?? EPOCH);

    // --- Local file header (30 bytes + name) ---
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed (2.0 = STORE)
    lv.setUint16(6, 0x0800, true); // flags: bit 11 = names are UTF-8
    lv.setUint16(8, 0, true); // method 0 = stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size == uncompressed
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(nameBytes, 30);

    chunks.push(local, data);

    // --- Central directory entry (46 bytes + name) ---
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true); // offset of this entry's local header
    cd.set(nameBytes, 46);

    central.push(cd);
    centralSize += cd.byteLength;
    offset += local.byteLength + data.byteLength;
  }

  // --- End of central directory (22 bytes) ---
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with the central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory starts here
  ev.setUint16(20, 0, true); // no archive comment

  return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
}

function stripLeadingSlashes(path: string): string {
  let i = 0;
  while (i < path.length && path[i] === '/') i += 1;
  return path.slice(i);
}

/** Path separators, mapped to a dash so a title can't create folders. */
const SEPARATORS = new Set(['/', '\\']);
/** Characters Windows rejects in a file name. */
const FORBIDDEN = new Set(['<', '>', ':', '"', '|', '?', '*']);
const MAX_NAME_LENGTH = 80;

/**
 * Make a string safe to use as a file name inside the archive (and on every OS it
 * might be extracted to).
 *
 * Written as an explicit character walk rather than a regex: the cases that matter
 * are path separators (an entry titled `../../secrets` must not escape its
 * folder), the Windows-forbidden set, and control bytes — and spelling those out
 * as named sets is far easier to audit than an escape-heavy character class.
 */
export function safeFileName(name: string, fallback = 'untitled'): string {
  let out = '';
  let lastWasSpace = false;

  for (const char of name) {
    const code = char.codePointAt(0)!;
    // Whitespace control codes (tab, newline, CR, form feed, vertical tab) become
    // spaces rather than being dropped — dropping a tab would silently run two
    // words together. Every other control byte goes.
    const isWhitespaceControl = code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d;
    if (!isWhitespaceControl && (code < 0x20 || code === 0x7f)) continue;
    if (FORBIDDEN.has(char)) continue;

    const mapped = isWhitespaceControl ? ' ' : SEPARATORS.has(char) ? '-' : char;

    // Collapse runs of whitespace into a single space, and never lead with one.
    if (mapped === ' ') {
      if (lastWasSpace || out.length === 0) continue;
      out += ' ';
      lastWasSpace = true;
      continue;
    }
    // A leading dot would hide the file on Unix.
    if (mapped === '.' && out.length === 0) continue;

    out += mapped;
    lastWasSpace = false;
  }

  // Windows silently strips trailing dots and spaces, which would break the
  // extension, so drop them here and keep the name matching what lands on disk.
  let end = Math.min(out.length, MAX_NAME_LENGTH);
  while (end > 0 && (out[end - 1] === '.' || out[end - 1] === ' ')) end -= 1;

  return out.slice(0, end) || fallback;
}
