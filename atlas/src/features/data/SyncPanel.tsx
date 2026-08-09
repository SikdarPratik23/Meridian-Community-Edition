import { useState } from 'react';
import { useSyncLink, disconnectSync } from '../../data/fileLink';
import {
  runSync, startAutoSync, stopAutoSync, getRole, setRole, getAutoSync, setAutoSync,
  type DeviceRole,
} from '../../data/sync';
import {
  connectHttp, disconnectHttp, getServerUrl, getServerUrlFallback, getServerToken,
} from '../../data/httpSync';
import { formatDateTime } from '../../utils';
import InfoTip from '../../components/ui/InfoTip';
import AsyncButton from '../../components/ui/AsyncButton';

/**
 * Sync panel — keep PC and phone in step through the local Node sync server
 * running on the same WiFi network. No third-party services required.
 *
 * Setup is manual by design: enter the primary address (and optional same-WiFi
 * fallback + token) that the sync-server window prints on your PC, then Connect.
 * (An automatic QR/deep-link pairing flow was tried and removed for being more
 * confusing than helpful — see PROJECT_MEMORY "Parked / future experiments".)
 */
export default function SyncPanel() {
  const fileName = useSyncLink((s) => s.fileName);
  const permitted = useSyncLink((s) => s.permitted);
  const lastSync = useSyncLink((s) => s.lastSync);
  const error = useSyncLink((s) => s.error);

  const [role, setRoleState] = useState<DeviceRole>(getRole);
  const [serverUrl, setServerUrlState] = useState(getServerUrl);
  const [fallbackUrl, setFallbackUrlState] = useState(getServerUrlFallback);
  const [serverToken, setServerTokenState] = useState(getServerToken);
  // Auto-sync is a persisted preference (default on). Its start/stop is owned by
  // App at launch and the toggle below — NOT by this panel mounting/unmounting,
  // so sync keeps running when you navigate away from the Data tab.
  const [auto, setAutoState] = useState(getAutoSync);
  const [msg, setMsg] = useState<string | null>(null);

  const connected = Boolean(fileName && permitted);
  const httpConnected = connected && fileName === 'Local server';

  const changeRole = (r: DeviceRole) => { setRole(r); setRoleState(r); };

  const toggleAuto = (on: boolean) => {
    setAutoState(on);
    setAutoSync(on);
    if (on && connected) startAutoSync();
    else stopAutoSync();
  };

  const onSyncNow = async () => {
    setMsg(null);
    const r = await runSync();
    setMsg(r.ok && r.stats
      ? `Synced — ${r.stats.added} new, ${r.stats.updated} updated here.`
      : (r.error || 'Sync failed.'));
  };

  const onConnectHttp = async (): Promise<{ ok: boolean }> => {
    setMsg(null);
    const ok = await connectHttp(serverUrl, serverToken, fallbackUrl);
    if (!ok) {
      setMsg('Couldn’t connect — check the address and try again.');
      return { ok: false };
    }
    // Connecting kicks off a sync straight away: auto-sync (default) keeps it
    // running; otherwise just do a single pass.
    if (auto) startAutoSync(); else await onSyncNow();
    return { ok: true };
  };

  return (
    <div className="p-3 bg-land/60 rounded border border-water space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
        🔄 Sync (PC ↔ phone, same WiFi)
        <InfoTip label="Sync setup">
          The sync server starts automatically with Meridian. Put your <strong>Tailscale</strong> address
          (e.g. <code className="font-mono">https://your-pc.ts.net</code>) as the primary so the phone
          reaches home from anywhere, and the <strong>same-WiFi</strong> address
          (<code className="font-mono">http://192.168.x.x:8787</code>, shown in the sync-server window)
          as the fallback. Meridian tries the primary first and drops to the fallback automatically when
          it can't be reached. On this PC, <code className="font-mono">http://localhost:8787</code> alone is fine.
          <br /><br />
          Note: a phone that opened Meridian over <strong>https</strong> can't use an
          {' '}<code className="font-mono">http://</code> fallback (browsers block that) — open Meridian from the
          same-WiFi <code className="font-mono">http://192.168.x.x:5173</code> address for the LAN fallback to work.
        </InfoTip>
      </div>

      {/* This device's role — affects the courier's trim bookkeeping. */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink/50">This device is my:</span>
        <div className="inline-flex rounded border border-water overflow-hidden">
          {(['pc', 'phone'] as DeviceRole[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => changeRole(r)}
              className={`px-3 py-0.5 text-[11px] capitalize transition-colors ${
                role === r ? 'bg-ink text-parchment' : 'bg-surface text-ink/60 hover:bg-land'
              }`}
            >
              {r === 'pc' ? 'PC' : 'Phone'}
            </button>
          ))}
        </div>
      </div>

      {connected ? (
        <>
          <p className="text-[11px] text-ink/60 leading-relaxed">
            Connected to <strong>{fileName}</strong>{auto ? ' — syncing automatically' : ''}.
            {lastSync && <span className="block text-ink/40">Last synced {formatDateTime(lastSync)}</span>}
          </p>
          <label className="flex items-center gap-2 text-[11px] text-ink/60">
            <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
            Auto-sync — keep this device in step automatically
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={async () => {
                stopAutoSync();
                if (httpConnected) disconnectHttp();
                else await disconnectSync();
              }}
              className="btn btn-danger btn-sm"
            >
              Disconnect
            </button>
          </div>
          <p className="text-[11px] text-ink/40 leading-relaxed">
            Use the <strong>Sync</strong> button in the header for a manual sync any time.
          </p>
        </>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-ink/60">Primary address</div>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrlState(e.target.value)}
            placeholder="https://<pc>.ts.net (Tailscale) or http://localhost:8787"
            className="w-full px-2 py-1 bg-surface border border-water rounded text-[11px] font-mono focus:outline-none focus:border-terracotta"
          />
          <div className="text-[11px] font-medium text-ink/60">Same-WiFi address (fallback, optional)</div>
          <input
            type="text"
            value={fallbackUrl}
            onChange={(e) => setFallbackUrlState(e.target.value)}
            placeholder="http://192.168.x.x:8787"
            className="w-full px-2 py-1 bg-surface border border-water rounded text-[11px] font-mono focus:outline-none focus:border-terracotta"
          />
          <input
            type="text"
            value={serverToken}
            onChange={(e) => setServerTokenState(e.target.value)}
            placeholder="Access token (optional)"
            className="w-full px-2 py-1 bg-surface border border-water rounded text-[11px] font-mono focus:outline-none focus:border-terracotta"
          />
          <AsyncButton
            className="btn btn-primary btn-sm"
            run={onConnectHttp}
            disabled={!serverUrl.trim()}
            idleLabel="Connect"
            workingLabel="Connecting…"
            doneLabel="Connected"
            errorLabel="Connect"
          />
        </div>
      )}

      {msg && <p className="text-[11px] text-terracotta">{msg}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
