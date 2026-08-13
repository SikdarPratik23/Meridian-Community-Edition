import { useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSyncLink } from '../../data/fileLink';
import { runSync } from '../../data/sync';
import { toast } from './toasts';
import { useT } from '../../i18n';
import Presence from './Presence';
import CompassIcon from './CompassIcon';

interface SearchFabProps {
  onOpenPalette: () => void;
}

/**
 * Mobile-only Unified Search & Sync FAB.
 *
 * Merges Search and Sync into a single balanced pill floating in the bottom-right
 * thumb zone above the tab bar, perfectly mirroring CaptureFab on the left.
 */
export default function SearchFab({ onOpenPalette }: SearchFabProps) {
  const t = useT();
  const fileName = useSyncLink((s) => s.fileName);
  const permitted = useSyncLink((s) => s.permitted);
  const hasSync = !!(fileName && permitted);

  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'ok' | 'err' | null>(null);

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
  const fabTabsAllowed = useAtlasStore(
    (s) => s.activeTab !== 'settings' && s.activeTab !== 'data',
  );

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncStatus(null);
    try {
      const res = await runSync();
      if (res.ok) {
        setSyncStatus('ok');
        toast.success('Journal synced');
      } else {
        setSyncStatus('err');
        toast.error('Sync failed — check Data → Sync folder');
      }
    } catch {
      setSyncStatus('err');
      toast.error('Sync error');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus(null), 2500);
    }
  };

  return (
    <Presence
      when={!mobileDetailOpen && fabTabsAllowed}
      exitMs={160}
      enterClassName="mo-rise-in"
      exitClassName="mo-fade-out"
      className="md:hidden absolute right-4 bottom-[calc(var(--tabbar-clear)+1rem)] z-30 select-none"
    >
      <div className="flex items-center rounded-full border border-water bg-surface shadow-lg backdrop-blur-md transition-transform">
        {/* Search button section */}
        <button
          type="button"
          onClick={onOpenPalette}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium text-ink tracking-wide hover:bg-land active:scale-95 transition-all ${
            hasSync ? 'rounded-l-full' : 'rounded-full'
          }`}
          aria-label={t('nav.search')}
        >
          <CompassIcon size={16} />
          <span>{t('nav.search')}</span>
        </button>

        {/* Merged Sync button section */}
        {hasSync && (
          <>
            <div className="h-4 w-px bg-water/60" aria-hidden="true" />
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              title={syncing ? 'Syncing…' : syncStatus === 'ok' ? 'Synced' : 'Sync now'}
              aria-label="Sync journal"
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-ink/75 hover:text-ink hover:bg-land rounded-r-full active:scale-95 transition-all"
            >
              <span className={`inline-block text-sm ${syncing ? 'animate-spin text-terracotta' : ''}`}>
                {syncStatus === 'ok' ? '✓' : syncStatus === 'err' ? '!' : '🔄'}
              </span>
              <span className="font-medium text-[11px]">
                {syncing ? 'Syncing' : syncStatus === 'ok' ? 'Synced' : 'Sync'}
              </span>
            </button>
          </>
        )}
      </div>
    </Presence>
  );
}
