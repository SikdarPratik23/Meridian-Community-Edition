import { useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSettings, type CoordFormat, type TempUnit } from '../../store/settings';
import { useDialogs } from '../../components/ui/dialogs';
import { saveEvent, exportDb, replaceDbFromBytes, getAllEvents, getAllRecords } from '../../data/db';
import {
  useFileLink, connectNewFile, openExistingFile, disconnectFile,
} from '../../data/fileLink';
import { mergeEvents } from '../../data/merge';
import { scheduleSync } from '../../data/sync';
import { getStorageInfo, formatBytes, type StorageInfo } from '../../data/storage';
import SyncPanel from './SyncPanel';
import InfoTip from '../../components/ui/InfoTip';
import AsyncButton from '../../components/ui/AsyncButton';
import { formatLatLng, formatDateTime, formatTemperature } from '../../utils';
import { toGeoJSON, toGPX, locatedCount } from '../../utils/geoExport';
import { printJournal } from '../export/printJournal';
import { buildMarkdownBundle, bundleFileName } from '../export/markdownExport';
import OfflineTilesPanel from '../map/OfflineTilesPanel';
import IconSwap from '../../components/ui/IconSwap';
import ProgressBar from '../../components/ui/ProgressBar';
import type { AnyEvent, EventType, ExportData, JournalEntry, Place } from '../../types';

/** Trigger a browser download of a Blob as a named file. */
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of some text as a named file. */
function downloadText(filename: string, text: string, mime: string) {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

const TYPE_META: Record<EventType, { label: string; color: string }> = {
  journal: { label: 'Journal', color: '#C05A45' },
  place: { label: 'Place', color: '#8B7355' },
};

/**
 * Build the human-readable field list for one record. Only populated fields are
 * shown, so you see exactly what was recorded — nothing more, nothing less.
 */
function fieldsFor(e: AnyEvent, coordFormat: CoordFormat, tempUnit: TempUnit): [string, string][] {
  const rows: [string, string][] = [];
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      rows.push([label, value.join(', ')]);
      return;
    }
    rows.push([label, String(value)]);
  };

  // Shared geographic + temporal fields
  rows.push(['coordinates', formatLatLng(e.longitude, e.latitude, coordFormat)]);
  push('location name', e.location_name);
  rows.push(['recorded', formatDateTime(e.timestamp)]);
  push('tags', e.tags);

  // Type-specific fields
  switch (e.type) {
    case 'journal': {
      const j = e as JournalEntry;
      push('mood', j.mood);
      push('weather', j.weather_condition);
      if (j.weather_temperature != null) rows.push(['temperature', formatTemperature(j.weather_temperature, tempUnit)]);
      if (j.media_attachments?.length) push('attachments', `${j.media_attachments.length} file(s)`);
      if (j.content_markdown) {
        const words = j.content_markdown.trim().split(/\s+/).length;
        rows.push(['content', `${words} word${words === 1 ? '' : 's'}`]);
      }
      break;
    }
    case 'place': {
      const p = e as Place;
      push('visited', p.visited ? 'yes' : 'no');
      push('rating', p.rating ? '★'.repeat(p.rating) : undefined);
      if (p.media_attachments?.length) push('attachments', `${p.media_attachments.length} file(s)`);
      break;
    }
  }

  rows.push(['id', e.id]);
  if (e.updated_at !== e.created_at) rows.push(['updated', formatDateTime(e.updated_at)]);
  return rows;
}

function RecordCard({ event, coordFormat, tempUnit }: { event: AnyEvent; coordFormat: CoordFormat; tempUnit: TempUnit }) {
  const [showRaw, setShowRaw] = useState(false);
  const meta = TYPE_META[event.type];
  const rows = fieldsFor(event, coordFormat, tempUnit);

  return (
    <div className="bg-surface rounded-lg border border-water shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-water/70">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
        <span className="text-[10px] uppercase tracking-wider text-ink/40">{meta.label}</span>
        <span className="font-medium text-sm truncate">{event.title}</span>
      </div>
      <dl className="px-3 py-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 py-0.5">
            <dt className="text-ink/40 w-28 shrink-0">{k}</dt>
            <dd className="text-ink/80 font-mono break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        onClick={() => setShowRaw((s) => !s)}
        className="w-full text-left px-3 py-1.5 text-[11px] text-ink/40 hover:text-ink border-t border-water/70 transition-colors"
      >
        {showRaw ? '▾ hide raw record' : '▸ view raw record (exactly what is stored)'}
      </button>
      {showRaw && (
        <pre className="px-3 pb-3 text-[10px] leading-relaxed text-ink/60 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * Link the journal to a real file on disk (File System Access API, Chromium
 * only). When linked, saves mirror to that file automatically; opening a file
 * loads it as the source of truth.
 */
function FileLinkPanel() {
  const supported = useFileLink((s) => s.supported);
  const fileName = useFileLink((s) => s.fileName);
  const permitted = useFileLink((s) => s.permitted);
  const lastWrite = useFileLink((s) => s.lastWrite);
  const error = useFileLink((s) => s.error);
  const setEvents = useAtlasStore((s) => s.setEvents);
  const { confirm } = useDialogs();
  const [busy, setBusy] = useState(false);

  const refresh = () => setEvents(getAllEvents());

  const onConnectNew = async () => {
    setBusy(true);
    await connectNewFile(exportDb());
    setBusy(false);
  };

  const onOpenExisting = async () => {
    const ok = await confirm({
      title: 'Open a journal file?',
      message: 'Entries from the file you pick replace what’s currently loaded, and that file becomes your live store. Export a backup first if unsure.',
      confirmLabel: 'Choose file',
    });
    if (!ok) return;
    setBusy(true);
    const bytes = await openExistingFile();
    if (bytes && bytes.length) {
      try {
        replaceDbFromBytes(bytes);
        refresh();
      } catch (e) {
        await confirm({
          title: 'Couldn’t open that file',
          message: `${(e as Error).message} Pick a Meridian journal (.db) file created by the app.`,
          confirmLabel: 'OK',
        });
      }
    }
    setBusy(false);
  };

  const onDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect this file?',
      message: 'The app will stop writing to the file (the file itself is kept). Your entries stay in this browser.',
      confirmLabel: 'Disconnect',
      variant: 'danger',
    });
    if (ok) await disconnectFile();
  };

  if (!supported) {
    return (
      <div className="p-3 bg-land/60 rounded border border-water space-y-1">
        <div className="text-xs font-medium text-ink/70">💾 Store in a file on this PC</div>
        <p className="text-[11px] text-ink/50 leading-relaxed">
          This browser doesn't support writing to a local file. Use a Chromium-based browser
          (Chrome, Edge, Brave) to keep your journal as a real file on disk. Export/Import below
          works everywhere in the meantime.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-land/60 rounded border border-water space-y-2">
      <div className="text-xs font-medium text-ink/70">💾 Store in a file on this PC</div>
      {fileName ? (
        <>
          <p className="text-[11px] text-ink/60 leading-relaxed">
            Linked to <code className="font-mono">{fileName}</code>.{' '}
            {permitted
              ? 'Every save writes through to this file.'
              : 'Reconnect (top banner) to resume writing this session.'}
            {lastWrite && permitted && (
              <span className="block text-ink/40">Last written {formatDateTime(lastWrite)}</span>
            )}
          </p>
          <button onClick={onDisconnect} className="btn btn-danger btn-sm">
            Disconnect file
          </button>
        </>
      ) : (
        <>
          <p className="text-[11px] text-ink/50 leading-relaxed">
            Keep your journal as a normal file you can see and back up — not only inside the
            browser. Saves mirror to it automatically.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onConnectNew} disabled={busy} className="btn btn-primary btn-sm">
              Create journal file…
            </button>
            <button onClick={onOpenExisting} disabled={busy} className="btn btn-secondary btn-sm">
              Open existing file…
            </button>
          </div>
        </>
      )}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

export default function DataView() {
  const events = useAtlasStore((s) => s.events);
  const addOrUpdateEvent = useAtlasStore((s) => s.addOrUpdateEvent);
  const coordFormat = useSettings((s) => s.coordFormat);
  const tempUnit = useSettings((s) => s.tempUnit);
  const [showInfo, setShowInfo] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load storage usage when the info panel is first opened (also refreshes when
  // the entry count changes, e.g. after adding photos).
  useEffect(() => {
    if (showInfo) getStorageInfo().then(setStorage);
  }, [showInfo, events.length]);

  const copyAll = async (): Promise<{ ok: boolean }> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
      return { ok: true };
    } catch {
      setImportMsg('Couldn’t access the clipboard — use “Export all” instead.');
      return { ok: false };
    }
  };

  const today = () => new Date().toISOString().slice(0, 10);

  // Export every entry as a JSON file you can move to another device.
  const exportAll = () => {
    const payload: ExportData = { events, exported_at: new Date().toISOString() };
    downloadText(`meridian-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };

  // Export the journal as a folder of Markdown files. Built off the main thread's
  // critical path via a microtask boundary so a large journal (hundreds of photos
  // to base64-decode) doesn't freeze the button mid-click with no feedback.
  const exportMarkdown = async (): Promise<{ ok: boolean }> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const now = new Date();
    downloadBlob(bundleFileName(now), buildMarkdownBundle(events, now));
    return { ok: true };
  };

  // Export located entries for GIS tools (QGIS/ArcGIS) and mapping apps.
  const exportGeoJSON = () => downloadText(`meridian-${today()}.geojson`, toGeoJSON(events), 'application/geo+json');
  const exportGPX = () => downloadText(`meridian-${today()}.gpx`, toGPX(events), 'application/gpx+xml');
  // Open a print-ready, cartographer-styled document of the whole journal for the
  // browser's "Save as PDF". Fully offline (no map tiles / network).
  const printAll = () =>
    printJournal(events, {
      title: 'Meridian Field Journal',
      subtitle: useSettings.getState().homeRegion || undefined,
      author: useSettings.getState().name || undefined,
    });

  const located = locatedCount(events);

  // Merge incoming JSON (from a file, Export, or pasted clipboard text). Entries
  // merge by id with a timestamp check: a new id is added, and a matching id is
  // updated ONLY if the incoming copy is newer (by updated_at). A newer local
  // entry is kept untouched. Ids are UUIDs across devices, so this is safe to
  // re-run and to apply in both directions — both sides converge on the latest.
  const importJson = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      const incoming: unknown = Array.isArray(parsed) ? parsed : parsed?.events;
      if (!Array.isArray(incoming)) throw new Error('no entries found');
      // Shared newest-wins merge (same logic the Sync folder uses), so the two
      // paths can never disagree about which copy of an entry wins. Merge against
      // ALL records (tombstones included) so importing an old backup can't
      // resurrect an entry that was since deleted — its tombstone outranks it.
      const { changed, stats } = mergeEvents(getAllRecords(), incoming);
      for (const ev of changed) {
        saveEvent(ev);
        addOrUpdateEvent(ev);
      }
      scheduleSync(); // push imported entries to the other device
      setImportMsg(
        `Imported ${stats.added} new, updated ${stats.updated}, kept ${stats.kept} newer local${stats.skipped ? `, skipped ${stats.skipped} invalid` : ''}.`,
      );
      return true;
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`);
      return false;
    }
  };

  const importFile = async (file: File) => importJson(await file.text());

  // Paste path: try to pull JSON straight from the clipboard; if the browser
  // blocks clipboard reads (common on mobile), the textarea is the fallback.
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setPasteText(text);
    } catch {
      setImportMsg('Couldn’t read the clipboard here — paste into the box below instead.');
    }
  };

  const importPasted = () => {
    if (!pasteText.trim()) return;
    if (importJson(pasteText)) {
      setPasteText('');
      setShowPaste(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-3 py-3 space-y-3">
      {/* Storage info */}
      <div className="text-xs">
        <button
          onClick={() => setShowInfo((s) => !s)}
          className="text-ink/50 hover:text-ink transition-colors"
        >
          <IconSwap active={showInfo} on="▾" off="▸" /> Where & how is this stored?
        </button>
        {showInfo && (
          <div className="mt-2 p-3 bg-land/60 rounded border border-water text-ink/70 leading-relaxed space-y-1.5">
            <p>
              Everything lives <strong>only in this browser</strong> — there is no server. Records
              are kept in a <strong>SQLite</strong> database (one <code>events</code> table) that runs
              in-page via WebAssembly.
            </p>
            <p>
              That database is serialized and saved to the browser's <strong>IndexedDB</strong> (database{' '}
              <code>atlas.db</code> → store <code>db</code> → key <code>data</code>), autosaving every
              10&nbsp;seconds and on close.
            </p>
            <p className="text-ink/50">
              Inspect it directly in DevTools → Application → IndexedDB → <code>atlas.db</code>. Full
              schema is in <code>README.md</code>. Coordinates use GeoJSON{' '}
              <code>[lon, lat]</code>, EPSG:4326.
            </p>

            {/* Storage usage + durability */}
            {storage && (storage.usage != null || storage.persisted != null) && (
              <div className="mt-1 border-t border-water pt-2 space-y-1">
                {storage.usage != null && (
                  <>
                    <p className="text-ink/60">
                      Using <strong>{formatBytes(storage.usage)}</strong>
                      {storage.quota != null && (
                        <> of about <strong>{formatBytes(storage.quota)}</strong> for this site
                          <InfoTip label="Why this limit?">
                            This isn't your computer's free space — it's the <strong>budget your browser
                            gives this one website</strong>. Browsers cap how much any single site may store
                            (usually a fraction of the free disk, shared across sites) and grow or shrink it
                            as free space changes, so the number moves over time. Journal text is tiny;
                            photos are the only thing that adds up, and they're downscaled. If you ever
                            approached it, move photo originals to the PC (they already sync there) or Export.
                          </InfoTip>
                        </>
                      )}
                      {storage.quota != null && storage.quota > 0 && (
                        <span className="text-ink/40"> ({Math.min(100, Math.round((storage.usage / storage.quota) * 100))}%)</span>
                      )}.
                    </p>
                    {storage.quota != null && storage.quota > 0 && (
                      <ProgressBar value={storage.usage / storage.quota} aria-label="Storage used" />
                    )}
                  </>
                )}
                <p className="text-[11px]">
                  {storage.persisted
                    ? <span className="text-forest">✓ Storage is persistent — the browser won't evict your journal to free space.</span>
                    : <span className="text-ink/50">Storage is best-effort — the browser may clear it under disk pressure. Keep a backup (Export) or link a file on disk below.</span>}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Store in a real file on disk (Chromium) */}
      <FileLinkPanel />

      {/* Auto-sync PC <-> phone through a shared JSON file in a cloud folder */}
      <SyncPanel />

      {/* Backup & transfer — how you move entries between your PC and phone */}
      <div className="p-3 bg-land/60 rounded border border-water space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
          ↔ Move entries between devices
          <InfoTip label="Move entries between devices">
            No server, so devices don't sync on their own. Easiest cross-device move: <strong>Copy JSON</strong> on
            one device, then <strong>Paste &amp; import</strong> on the other — or use <strong>Export</strong>/<strong>Import file</strong>.
            Importing <em>merges by entry</em>: new entries are added and the <em>newer</em> copy wins, so it's safe
            to re-run and to import in both directions.
          </InfoTip>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Out */}
          <button
            onClick={exportAll}
            disabled={events.length === 0}
            className="btn btn-primary btn-sm btn-block"
            title="Download all entries as a JSON file"
          >
            ⬇ Export file
          </button>
          <AsyncButton
            className="btn btn-sm btn-block btn-secondary"
            run={copyAll}
            disabled={events.length === 0}
            title="Copy all entries as JSON to the clipboard"
            idleLabel="⧉ Copy JSON"
            doneLabel="Copied"
            errorLabel="Couldn’t copy"
          />
          {/* In */}
          <button
            onClick={() => fileRef.current?.click()}
            className="btn btn-secondary btn-sm btn-block"
            title="Load entries from a JSON file (merges by id)"
          >
            ⬆ Import file
          </button>
          <button
            onClick={() => setShowPaste((v) => !v)}
            className={`btn btn-sm btn-block ${showPaste ? 'btn-active' : 'btn-secondary'}`}
            title="Paste copied JSON to import"
          >
            📋 Paste &amp; import
          </button>
        </div>

        {/* Print / PDF — a cartographer-styled book of the whole journal, via the
            browser's print dialog (choose "Save as PDF"). Offline. */}
        <button
          onClick={printAll}
          disabled={events.length === 0}
          className="btn btn-secondary btn-sm btn-block"
          title="Open a print-ready field journal (choose Save as PDF in the print dialog)"
        >
          🖨 Print / Save as PDF
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }}
        />

        {showPaste && (
          <div className="space-y-1.5">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste exported JSON here…"
              rows={4}
              className="w-full px-2 py-1.5 bg-surface border border-water rounded text-[11px] font-mono resize-none focus:outline-none focus:border-terracotta"
            />
            <div className="flex items-center gap-2">
              <button onClick={pasteFromClipboard} className="btn btn-secondary btn-sm">
                Paste from clipboard
              </button>
              <button
                onClick={importPasted}
                disabled={!pasteText.trim()}
                className="btn btn-primary btn-sm ml-auto"
              >
                Import pasted
              </button>
            </div>
          </div>
        )}

        {importMsg && <p className="text-[11px] text-terracotta">{importMsg}</p>}
      </div>

      {/* Export for maps & GIS — located entries as GeoJSON / GPX */}
      <div className="p-3 bg-land/60 rounded border border-water space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
          🗺️ Export for maps &amp; GIS
          <InfoTip label="Export for maps and GIS">
            Exports pinned entries as points (coordinates in <code>[lon, lat]</code>, EPSG:4326). Entries
            without a location are skipped. GeoJSON opens in QGIS/ArcGIS; GPX in Google Earth and handheld GPS apps.
          </InfoTip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={exportGeoJSON}
            disabled={located === 0}
            className="btn btn-secondary btn-sm btn-block"
            title="Download located entries as GeoJSON (EPSG:4326) for QGIS / ArcGIS"
          >
            ⬇ GeoJSON
          </button>
          <button
            onClick={exportGPX}
            disabled={located === 0}
            className="btn btn-secondary btn-sm btn-block"
            title="Download located entries as GPX waypoints for Google Earth / GPS tools"
          >
            ⬇ GPX
          </button>
        </div>
        <p className="text-[11px] text-ink/50 leading-relaxed">
          {located > 0
            ? <><strong>{located}</strong> pinned {located === 1 ? 'entry' : 'entries'} ready to export.</>
            : <>No pinned entries yet — set a location on an entry and it becomes an exportable map point here.</>}
        </p>
      </div>

      {/* Markdown bundle — the journal as plain files that outlive the app */}
      <div className="p-3 bg-land/60 rounded border border-water space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink/70">
          📝 Export as Markdown files
          <InfoTip label="Markdown bundle export">
            A zip containing one <code>.md</code> file per entry (foldered by year, named by date), with
            the structured fields as YAML front-matter and your photos and voice notes alongside in an{' '}
            <code>attachments/</code> folder. Photo references are rewritten to point at those files, so the
            folder opens correctly in Obsidian, Logseq, a static site generator — or just a text editor,
            in twenty years, with no Meridian involved.
          </InfoTip>
        </div>
        <AsyncButton
          className="btn btn-secondary btn-sm btn-block"
          run={exportMarkdown}
          disabled={events.length === 0}
          title="Download every entry as Markdown files in a zip"
          idleLabel="⬇ Markdown bundle (.zip)"
          workingLabel="Building the bundle…"
          doneLabel="Bundle downloaded"
        />
        <p className="text-[11px] text-ink/50 leading-relaxed">
          {events.length > 0
            ? <>The most portable copy of your journal — plain text you can read anywhere.</>
            : <>Nothing to export yet.</>}
        </p>
      </div>

      {/* Offline map tiles — pre-download an area so the map works with no signal */}
      <OfflineTilesPanel />

      {/* Records — every stored entry, newest data is the single source of truth */}
      {events.length === 0 ? (
        <div className="text-center text-ink/30 text-sm py-10">No records yet</div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <RecordCard key={e.id} event={e} coordFormat={coordFormat} tempUnit={tempUnit} />
          ))}
        </div>
      )}
    </div>
  );
}
