/**
 * Client-side image downscaling.
 *
 * Photos attached to an entry are stored inline (as a data URL) at a modest size
 * so the entry stays small enough to sync to the phone; the full-resolution
 * original is kept only on the PC (see `data/media.ts`). This keeps both devices'
 * databases light — a phone photo that would be ~4 MB inline becomes ~0.4 MB.
 */

export interface Downscaled {
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
}

/** Longest-edge cap for the synced (inline) copy. Sharp on any phone screen. */
export const MAX_EDGE = 1600;
const QUALITY = 0.82;
/**
 * Below this, an image is already small enough that downscaling wouldn't help
 * (and re-encoding a small PNG to JPEG could even enlarge it). Keep such images
 * inline as-is, with no separate original to split off.
 */
const KEEP_AS_IS_BYTES = 500 * 1024;

/**
 * Downscale an image File to at most `maxEdge` on its longest side, re-encoded as
 * JPEG. Returns `null` when the image is already small (dimensions within
 * `maxEdge` AND file under KEEP_AS_IS_BYTES) — the caller then keeps the original
 * inline, since there's nothing worth splitting off.
 *
 * Fails soft: if the browser can't decode the image (e.g. some HEICs), returns
 * `null` so the caller falls back to storing the original inline.
 */
export async function downscaleImage(
  file: File,
  maxEdge = MAX_EDGE,
  quality = QUALITY,
): Promise<Downscaled | null> {
  if (!file.type.startsWith('image/')) return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

  let bitmap: ImageBitmap;
  try {
    // `from-image` honours the photo's EXIF orientation so it isn't drawn sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null; // undecodable — caller keeps the original inline
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest <= maxEdge && file.size <= KEEP_AS_IS_BYTES) {
    bitmap.close();
    return null; // already small enough — keep the original inline
  }

  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return null; }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return { dataUrl: canvas.toDataURL('image/jpeg', quality), mime: 'image/jpeg', width: w, height: h };
}
