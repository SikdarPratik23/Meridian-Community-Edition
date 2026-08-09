/**
 * A read-back ZIP parser, for tests only.
 *
 * Written independently of `utils/zip.ts` (it walks the END-OF-CENTRAL-DIRECTORY
 * record and the central directory, which the writer only ever writes) so the
 * tests verify the archive against a separate implementation rather than against
 * the writer's own assumptions. A test that only checked "the writer wrote what
 * the writer intended" would pass on a malformed archive.
 */

export interface UnzippedEntry {
  path: string;
  bytes: Uint8Array;
  text: string;
  crc: number;
  /** Compression method recorded in the central directory (0 = stored). */
  method: number;
}

const decoder = new TextDecoder();

/** Find the End Of Central Directory record by scanning back for its signature. */
function findEocd(view: DataView): number {
  // The EOCD is 22 bytes plus an optional comment, so scan backwards from the end.
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Parse a ZIP archive into its entries. Throws with a clear message when the
 * archive is malformed, so a test failure says what's wrong rather than crashing
 * on an out-of-bounds read.
 */
export function unzip(buffer: ArrayBuffer): UnzippedEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record');

  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  const entries: UnzippedEntry[] = [];
  let pos = centralOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error(`corrupt central directory entry ${i} at offset ${pos}`);
    }
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));

    // Cross-check the local header and read the data that follows it.
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`corrupt local header for "${path}" at offset ${localOffset}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    entries.push({ path, bytes: data, text: decoder.decode(data), crc, method });
    pos += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Convenience: parse a Blob (what `createZip` returns). */
export async function unzipBlob(blob: Blob): Promise<UnzippedEntry[]> {
  return unzip(await blob.arrayBuffer());
}

/** Independent CRC-32, so the archive's checksums are checked against a second
 *  implementation rather than the writer's own table. */
export function crc32Of(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
