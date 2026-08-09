import { useState } from 'react';
import { useSyncLink } from '../../data/fileLink';
import { runSync } from '../../data/sync';

/**
 * A compact, always-reachable "sync now" control for the sidebar header — the
 * manual fallback when auto-sync hasn't fired (PC) or to push/pull on demand
 * (phone). Only appears once a sync file is linked; otherwise there's nothing
 * to sync and the full setup lives in Data → Sync folder.
 */
export default function SyncButton() {
  const fileName = useSyncLink((s) => s.fileName);
  const permitted = useSyncLink((s) => s.permitted);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null);

  if (!fileName || !permitted) return null;

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setFlash(null);
    const r = await runSync();
    setBusy(false);
    setFlash(r.ok ? 'ok' : 'err');
    setTimeout(() => setFlash(null), 2000);
  };

  const title = busy
    ? 'Syncing…'
    : flash === 'ok'
      ? 'Synced'
      : flash === 'err'
        ? "Sync failed — open Data → Sync folder"
        : 'Sync now';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={title}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold shadow-sm transition-all active:scale-95 ${
        flash === 'ok'
          ? 'border-forest bg-forest/10 text-forest'
          : flash === 'err'
            ? 'border-red-500 bg-red-500/10 text-red-500'
            : 'border-terracotta/40 bg-terracotta/10 text-terracotta hover:bg-terracotta/20 hover:border-terracotta/60'
      }`}
    >
      <span className={busy ? 'animate-spin' : ''}>{flash === 'ok' ? '✓' : flash === 'err' ? '!' : '🔄'}</span>
      <span>{busy ? 'Syncing' : 'Sync'}</span>
    </button>
  );
}
