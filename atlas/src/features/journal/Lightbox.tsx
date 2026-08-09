/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the pure `flipTransform` helper (tested standalone) alongside the
   default component, same pattern as AttachmentImage.tsx. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchOriginal, canUseOriginals } from '../../data/media';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';

/** The tapped thumbnail's on-page rect, captured via `getBoundingClientRect()`
 *  right before the lightbox opens (MOTION_PLAN.md M19). */
export interface LightboxOriginRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Matches `.lightbox-image`'s `--mo-slow` transition (index.css) at full
 *  motion — the same "a JS timer hand-matches a CSS duration" pattern as
 *  `AsyncButton`'s `CHECK_DRAW_MS`. */
const ZOOM_MS = 420;

/** The FLIP math: the transform that would make the image's CURRENT (final,
 *  natural) box exactly overlay `origin`. Applied then immediately cleared —
 *  releasing it is what makes the browser animate FROM there. Exported pure
 *  so the geometry is testable without a real layout. */
export function flipTransform(origin: LightboxOriginRect, final: LightboxOriginRect): string {
  if (final.width === 0 || final.height === 0) return '';
  const scaleX = origin.width / final.width;
  const scaleY = origin.height / final.height;
  const dx = (origin.left + origin.width / 2) - (final.left + final.width / 2);
  const dy = (origin.top + origin.height / 2) - (final.top + final.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
}

/**
 * Full-screen image viewer. Click the backdrop, press Esc, or hit ✕ to close.
 * Used by EventCard for both inline images and the gallery.
 *
 * The image shown is the downscaled copy that lives in the entry. When a
 * full-resolution original exists on the PC (`hasOriginal`), a button fetches it
 * on demand — swapping in the full-res image and offering it for download. If the
 * PC is off, that fails softly with a hint rather than breaking the view.
 *
 * M19: when `originRect` (the tapped thumbnail's on-page rect) is available,
 * the image expands into place from there and shrinks back into it on close,
 * via a measured FLIP rather than a `view-transition-name` pair — a FLIP is
 * more predictable here because this is a portal-free plain overlay, and the
 * same technique already proven for list reflows (`useFlipReflow`) just
 * needed scale added alongside the translate.
 */
export default function Lightbox({
  src,
  alt,
  onClose,
  attachmentId,
  hasOriginal,
  originalName,
  originRect,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
  attachmentId?: string;
  hasOriginal?: boolean;
  originalName?: string;
  originRect?: LightboxOriginRect;
}) {
  const [fullSrc, setFullSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [closing, setClosing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const motion = useEffectiveMotion();

  // Entrance: place the image at the thumbnail's rect, then release the
  // transform — `.lightbox-image`'s transition (index.css) animates the
  // release back to the image's natural, centred layout.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img || !originRect || motion === 'off') return;
    img.style.transition = 'none';
    img.style.transform = flipTransform(originRect, img.getBoundingClientRect());
    img.getBoundingClientRect(); // force layout so the browser commits the inverted position first
    img.style.transition = '';
    img.style.transform = '';
    // Runs once, on mount — the entrance is a one-time reveal, not something
    // that should replay if `motion`/`originRect` were to change mid-life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    const img = imgRef.current;
    if (!originRect || motion === 'off' || !img) {
      onClose();
      return;
    }
    setClosing(true);
    img.style.transform = flipTransform(originRect, img.getBoundingClientRect());
    closeTimer.current = setTimeout(onClose, ZOOM_MS);
  }, [closing, motion, onClose, originRect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [requestClose]);

  // Free the fetched original's object URL when it's replaced or on unmount.
  useEffect(() => () => { if (fullSrc) URL.revokeObjectURL(fullSrc); }, [fullSrc]);

  const canOriginal = Boolean(hasOriginal && attachmentId && canUseOriginals());

  const loadOriginal = async () => {
    if (!attachmentId) return;
    setStatus('loading');
    const url = await fetchOriginal(attachmentId);
    if (url) { setFullSrc(url); setStatus('idle'); }
    else setStatus('error');
  };

  return (
    <div
      onClick={requestClose}
      className={`lightbox-backdrop fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out ${closing ? 'opacity-0' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image'}
    >
      <img
        ref={imgRef}
        src={fullSrc || src}
        alt={alt || ''}
        onClick={(e) => e.stopPropagation()}
        className="lightbox-image max-w-full max-h-[82vh] object-contain rounded shadow-2xl cursor-default"
      />
      {alt && <p className="mt-3 max-w-2xl text-center text-sm text-white/80">{alt}</p>}
      {canOriginal && (
        <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {!fullSrc && status !== 'loading' && (
            <button onClick={loadOriginal} className="btn btn-secondary btn-sm">
              ⬇ View full-resolution original
            </button>
          )}
          {status === 'loading' && <span className="text-sm text-white/70">Loading original…</span>}
          {status === 'error' && (
            <span className="text-sm text-white/70">Original unavailable — is the PC on?</span>
          )}
          {fullSrc && (
            <a href={fullSrc} download={originalName || 'original'} className="btn btn-secondary btn-sm">
              ⬇ Save original
            </a>
          )}
        </div>
      )}
      <button
        onClick={requestClose}
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-surface/15 text-lg text-white hover:bg-surface/25"
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}
