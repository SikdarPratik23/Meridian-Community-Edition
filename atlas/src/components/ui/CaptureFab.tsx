import { useState, useRef, useEffect } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useT } from '../../i18n';
import Presence from './Presence';

/**
 * Mobile-only primary Capture FAB (MOTION_PLAN.md Part II, P2).
 *
 * Sits in the thumb reach zone floating above the bottom tab bar
 * (clearing `--tabbar-clear`). Single tap writes a new entry; expanding
 * the speed dial offers 📷 photo and 🎙 voice note modes directly.
 */
export default function CaptureFab() {
  const t = useT();
  const startComposing = useAtlasStore((s) => s.startComposing);
  const setPendingCaptureMode = useAtlasStore((s) => s.setPendingCaptureMode);
  const setPendingCapturePhoto = useAtlasStore((s) => s.setPendingCapturePhoto);
  const mobileDetailOpen = useAtlasStore(
    (s) =>
      !!(
        s.selectedEvent ||
        s.selectedDay ||
        s.selectedTrip ||
        s.composing ||
        s.editing ||
        s.yearReviewOpen ||
        s.mapExpanded
      ),
  );
  // Not on Settings or Data: writing isn't something you do from either, and
  // this bar floats over exactly the strip where their own trailing controls
  // sit — it was covering the left half of "Save settings". Mirrors the map
  // FAB's `fabTabsAllowed` in App.tsx. (Reported 2026-08-08.)
  const tabAllowsCapture = useAtlasStore(
    (s) => s.activeTab !== 'settings' && s.activeTab !== 'data',
  );

  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Close speed dial when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const onClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, [expanded]);

  // Close speed dial on Escape key
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const handleWrite = () => {
    setExpanded(false);
    startComposing('journal');
  };

  const handlePhoto = () => {
    setExpanded(false);
    photoInputRef.current?.click();
  };

  const onPhotoChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingCapturePhoto(file);
    startComposing('journal');
  };

  const handleVoice = () => {
    setExpanded(false);
    setPendingCaptureMode('audio');
    startComposing('journal');
  };

  return (
    <Presence
      when={!mobileDetailOpen && tabAllowsCapture}
      exitMs={160}
      enterClassName="mo-rise-in"
      exitClassName="mo-fade-out"
      className="md:hidden absolute left-4 bottom-[calc(var(--tabbar-clear)+1rem)] z-30"
    >
      <div ref={containerRef} className="relative flex flex-col items-center select-none">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPhotoChosen}
        />
        {/* Speed-Dial Items (Pop Up Vertically) */}
        <Presence
          when={expanded}
          exitMs={140}
          enterClassName="mo-rise-in"
          exitClassName="mo-fade-out-plain"
          className="absolute bottom-full mb-3 flex flex-col items-center gap-2"
        >
          <button
            onClick={handleVoice}
            className="flex items-center gap-2 rounded-full border border-water bg-surface px-4 py-2 text-xs font-medium text-ink shadow-md hover:bg-land active:scale-95 transition-transform"
          >
            <span>🎙</span>
            <span>{t('capture.voice')}</span>
          </button>
          <button
            onClick={handlePhoto}
            className="flex items-center gap-2 rounded-full border border-water bg-surface px-4 py-2 text-xs font-medium text-ink shadow-md hover:bg-land active:scale-95 transition-transform"
          >
            <span>📷</span>
            <span>{t('capture.photo')}</span>
          </button>
        </Presence>

        {/* Main Capture Bar */}
        <div className="flex items-center rounded-full border border-terracotta/30 bg-terracotta text-white shadow-lg backdrop-blur-sm transition-transform active:scale-98">
          <button
            onClick={handleWrite}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold tracking-wide"
            aria-label={t('capture.write')}
          >
            <span>✍️</span>
            <span>{t('capture.write')}</span>
          </button>
          <div className="h-4 w-px bg-white/30" aria-hidden="true" />
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={t('capture.label')}
            className="px-2.5 py-2.5 text-xs transition-transform active:scale-90"
          >
            <span className={`inline-block transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
              ▲
            </span>
          </button>
        </div>
      </div>
    </Presence>
  );
}
