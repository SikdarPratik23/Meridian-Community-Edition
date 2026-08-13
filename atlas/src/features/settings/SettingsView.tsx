import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings, FONT_SIZES, type FontSize } from '../../store/settings';
import { profileFor, QUALITY_ORDER } from '../../features/welcome/quality';
import { useAtlasStore } from '../../store/atlas';
import { useDialogs } from '../../components/ui/dialogs';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { backfillPlaceNames, needsPlaceName } from '../../data/backfillPlaces';
import { listCountries, listStates } from '../../features/insights/holidays';
import { detectedRegion } from '../../features/insights/useHolidays';
import { reverseGeocodeRegion, getCurrentPosition } from '../../features/welcome/locationInfo';
import { formatLatLng } from '../../utils';
import InfoTip from '../../components/ui/InfoTip';
import AsyncButton from '../../components/ui/AsyncButton';
import ProgressBar from '../../components/ui/ProgressBar';
import WelcomeCardsSettings from './WelcomeCardsSettings';
import { MAP_STYLE_OPTIONS } from '../map/mapStyle';
import { LOCALES } from '../../i18n';
import { useSlidingIndicator, isWrappedRow } from '../../hooks/useSlidingIndicator';

function Section({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink/40">
        {title}
        {info && <InfoTip label={title}>{info}</InfoTip>}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-ink/50">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'mt-1 w-full px-2.5 py-1.5 bg-surface border border-water rounded text-sm focus:outline-none focus:border-terracotta';

const selectClass =
  'mt-1 w-full px-2.5 py-2 bg-surface border border-water rounded text-sm text-ink focus:outline-none focus:border-terracotta';

/**
 * Which country (and, where it matters, which region) to mark public holidays
 * for on the calendar. Defaults to auto-detect from where you journal; pick a
 * country here to override it — e.g. if you travel, or GPS/lookups are off.
 * Country + state lists come from the offline holiday library, loaded on demand.
 */
function HolidaySettings() {
  const country = useSettings((s) => s.holidayCountry);
  const stateCode = useSettings((s) => s.holidayState);
  const update = useSettings((s) => s.update);
  const events = useAtlasStore((s) => s.events);

  const [countries, setCountries] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, string> | null>(null);
  const auto = detectedRegion();

  // Explicit, observable counterpart to the silent background auto-detect. The
  // background effect only runs with online-lookups on and gives no feedback
  // when it can't resolve (no located entry, lookups off, geocode blocked) —
  // which is exactly why it "just doesn't work" on some phones. This button
  // runs the same geocode on demand, writes the result into the country/state
  // selection (reactive everywhere, persisted), and says why if it fails.
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const handleDetect = async () => {
    setDetecting(true);
    setDetectMsg(null);
    try {
      // Prefer the device's own GPS — this is what makes detection work on a
      // phone, which has real location hardware but often no pinned entries.
      // Fall back to the most recent located entry (e.g. on a desktop with no
      // geolocation), and finally bail with a clear reason.
      let coords = await getCurrentPosition();
      if (!coords) {
        const located = events.find((e) => !(e.longitude === 0 && e.latitude === 0));
        if (located) coords = { lat: located.latitude, lon: located.longitude };
      }
      if (!coords) {
        setDetectMsg('Couldn’t get your location — allow location access when prompted, or pick a country below.');
        return;
      }
      const r = await reverseGeocodeRegion(coords.lat, coords.lon);
      if (!r) {
        setDetectMsg('Couldn’t reach the location service. Check your connection, then try again — or just pick a country below.');
        return;
      }
      update('holidayCountry', r.country);
      update('holidayState', r.state ?? '');
      const cName = countries[r.country] ?? r.country;
      setDetectMsg(`Detected ${cName}${r.state ? ` · ${r.state}` : ''}.`);
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void listCountries().then((c) => { if (alive) setCountries(c); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // The state <select> is only shown when a country is chosen, so when there's
    // none we simply skip loading rather than clearing state synchronously here.
    if (!country) return;
    let alive = true;
    void listStates(country).then((s) => { if (alive) setStates(s); });
    return () => { alive = false; };
  }, [country]);

  const countryEntries = useMemo(
    () => Object.entries(countries).sort((a, b) => a[1].localeCompare(b[1])),
    [countries],
  );

  return (
    <div className="space-y-2">
      <Field label="Country for holidays">
        <select
          className={selectClass}
          value={country}
          onChange={(e) => { update('holidayCountry', e.target.value); update('holidayState', ''); }}
        >
          <option value="">
            Auto-detect{auto ? ` (currently ${auto.country}${auto.state ? `-${auto.state}` : ''})` : ' from my location'}
          </option>
          {countryEntries.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      </Field>

      {country && states && Object.keys(states).length > 0 && (
        <Field label="Region / state (for regional holidays)">
          <select
            className={selectClass}
            value={stateCode}
            onChange={(e) => update('holidayState', e.target.value)}
          >
            <option value="">Whole country</option>
            {Object.entries(states)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
          </select>
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button type="button" onClick={handleDetect} disabled={detecting} className="btn btn-secondary btn-sm">
          {detecting ? 'Detecting…' : 'Detect from my location'}
        </button>
        {detectMsg && <span className="text-[11px] leading-snug text-ink/55">{detectMsg}</span>}
      </div>
    </div>
  );
}

/** The holiday help text — shown behind the Calendar section's ⓘ. */
const HOLIDAY_INFO =
  'Public holidays appear as a green dot on the calendar. Auto-detect uses the location of your most recent pinned entry; or pick a country (and region, for holidays like Fronleichnam that are state-only) to set it yourself.';

/** A friendly word for a raw map zoom level, shown next to the zoom slider. */
function zoomLabel(z: number): string {
  if (z <= 12) return `City · z${z}`;
  if (z <= 14) return `District · z${z}`;
  if (z <= 16) return `Neighborhood · z${z}`;
  if (z <= 18) return `Street · z${z}`;
  return `Building · z${z}`;
}

function Segmented<T extends string>({
  value, options, onChange, disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const activeIndex = options.findIndex((o) => o.value === value);
  const { containerRef, activeRef, rect } = useSlidingIndicator<HTMLDivElement, HTMLButtonElement>([
    activeIndex,
    options.length,
  ]);
  // Wave 2 (M8): the pill slides between options via `rect`. `Segmented` wraps
  // to two rows on a phone (four basemap labels don't fit one row) — rather
  // than track the indicator on both axes, it's simply hidden when wrapped and
  // every button falls back to the plain colour swap it had before Wave 2. A
  // pill jumping between rows read as more broken than a colour flip, not less.
  const [wrapped, setWrapped] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const firstRow = container.firstElementChild as HTMLElement | null;
    const check = () => {
      if (!firstRow) return;
      setWrapped(isWrappedRow(container.getBoundingClientRect().height, firstRow.getBoundingClientRect().height));
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, options.length]);

  return (
    // flex-wrap so a set with more options than fits (the four basemaps, on a
    // phone) breaks onto a second row instead of overflowing the dialog.
    <div
      ref={containerRef}
      className={`segmented mt-1 inline-flex flex-wrap rounded border border-water overflow-hidden ${disabled ? 'opacity-50' : ''}`}
    >
      {!wrapped && rect && (
        <span
          className="segmented-indicator"
          style={{ '--seg-x': `${rect.x}px`, '--seg-w': `${rect.width}px` } as React.CSSProperties}
          aria-hidden="true"
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          ref={o.value === value ? activeRef : undefined}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`relative z-[1] px-3 py-1 text-xs transition-colors ${
            wrapped
              ? value === o.value ? 'bg-ink text-parchment' : 'bg-surface text-ink/60 hover:bg-land'
              : value === o.value ? 'text-parchment' : 'bg-surface text-ink/60 hover:bg-land'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label, hint, checked, onChange, disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex w-full items-center gap-2 ${disabled ? 'opacity-50' : ''}`}>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <span
          className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
            checked ? 'bg-terracotta' : 'bg-water'
          }`}
        >
          <span className={`h-4 w-4 rounded-full bg-surface transition-transform ${checked ? 'translate-x-4' : ''}`} />
        </span>
        <span className="text-sm text-ink/80">{label}</span>
      </button>
      {hint && <InfoTip label={label}>{hint}</InfoTip>}
    </div>
  );
}

/**
 * "Install Meridian as an app" — turns the web page into a real home-screen app
 * with its own icon and no browser chrome. Offers a one-tap button where the
 * browser supports it (Chrome, older Samsung Internet), and step-by-step
 * instructions where it doesn't (newer Samsung Internet, iOS Safari). Hidden
 * once the app is already running standalone.
 */
function InstallPanel() {
  const { installed, canPrompt, platform, install } = usePwaInstall();
  const [note, setNote] = useState<string | null>(null);

  if (installed) {
    return (
      <p className="text-[11px] text-forest">
        ✓ Running as an installed app — you're all set.
      </p>
    );
  }

  const onInstall = async () => {
    const outcome = await install();
    if (outcome === 'accepted') setNote('Installing… look for the Meridian icon on your home screen.');
    else if (outcome === 'dismissed') setNote('No worries — you can install any time from here.');
  };

  return (
    <div className="p-3 bg-land/60 rounded border border-water space-y-2">
      <div className="text-xs font-medium text-ink/70">📲 Install Meridian as an app</div>
      <p className="text-[11px] text-ink/50 leading-relaxed">
        Get a home-screen icon and a full-screen app (no browser address bar). Works offline once installed.
      </p>

      {canPrompt ? (
        <button onClick={onInstall} className="btn btn-primary btn-sm">
          Install app
        </button>
      ) : platform === 'samsung' ? (
        <ol className="text-[11px] text-ink/60 leading-relaxed list-decimal pl-4 space-y-0.5">
          <li>Tap the menu (☰) at the bottom of Samsung Internet.</li>
          <li>Choose <strong>Add page to</strong>.</li>
          <li>Pick <strong>Apps screen</strong> (not “Home screen”) — that installs it as a real app with its own icon.</li>
        </ol>
      ) : platform === 'ios' ? (
        <ol className="text-[11px] text-ink/60 leading-relaxed list-decimal pl-4 space-y-0.5">
          <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
          <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong> — Meridian appears as an app icon.</li>
        </ol>
      ) : (
        <p className="text-[11px] text-ink/60 leading-relaxed">
          Open your browser's menu and choose <strong>Install app</strong> / <strong>Add to Home screen</strong>.
          On a phone, prefer “Add to Apps” over a plain shortcut so you get the full-screen app.
        </p>
      )}

      {note && <p className="text-[11px] text-terracotta">{note}</p>}
    </div>
  );
}

/**
 * Backfill place names for older located entries that never got one (e.g. saved
 * before auto-fill, or with online lookups off). One-tap, abortable, fails soft.
 */
function PlaceBackfillPanel({ disabled }: { disabled?: boolean }) {
  const events = useAtlasStore((s) => s.events);
  const addOrUpdateEvent = useAtlasStore((s) => s.addOrUpdateEvent);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const candidates = useMemo(() => events.filter(needsPlaceName).length, [events]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { updated, attempted } = await backfillPlaceNames(events, {
      signal: ctrl.signal,
      onUpdated: (e) => addOrUpdateEvent(e),
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setRunning(false);
    setProgress(null);
    setResult(
      ctrl.signal.aborted
        ? `Stopped — named ${updated} so far.`
        : `Named ${updated} of ${attempted} ${attempted === 1 ? 'entry' : 'entries'}.`,
    );
  };

  if (candidates === 0 && !result) {
    return <p className="text-[11px] text-ink/40">All located entries already have a place name. ✓</p>;
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={running ? () => abortRef.current?.abort() : run}
        disabled={disabled || (candidates === 0 && !running)}
        className="btn btn-secondary btn-sm"
      >
        {running
          ? `Stop (${progress ? `${progress.done}/${progress.total}` : '…'})`
          : `Fill in ${candidates} missing place ${candidates === 1 ? 'name' : 'names'}`}
      </button>
      {/* M28: a real bar, replacing the text-only "done/total" readout above as
          the only progress indication. */}
      {running && progress && progress.total > 0 && (
        <ProgressBar value={progress.done / progress.total} aria-label="Backfilling place names" />
      )}
      <p className="text-[11px] text-ink/40 leading-snug">
        Looks up a place name for older pinned entries that don't have one. Sends only their approximate
        coordinates; runs one at a time.
      </p>
      {result && <p className="text-[11px] text-forest">{result}</p>}
    </div>
  );
}

/**
 * A self-contained modal for the "Advanced settings" — the power-user and
 * set-once controls that would otherwise clutter the everyday settings screen.
 * Matches the app's Dialog look (bottom sheet on mobile, centered card on
 * desktop): Escape / backdrop-click closes, and background scroll is locked.
 */
function AdvancedDialog({ onClose, footer, children }: { onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-[100] flex items-end justify-center p-0 md:items-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Advanced settings"
        tabIndex={-1}
        className="dialog-panel relative flex max-h-[92dvh] w-full max-w-none flex-col overflow-hidden rounded-t-2xl border border-water bg-parchment shadow-xl outline-none md:max-w-lg md:rounded-xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-water md:hidden" />
        <div className="flex shrink-0 items-center justify-between border-b border-water px-4 py-3">
          <h2 className="font-serif text-lg font-bold text-ink">Advanced settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-base leading-none text-ink/45 transition-colors hover:bg-land hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-water bg-parchment px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The Today's-focus rotation interval, as a free-typing number box. It keeps its
 * own text state so you can clear it and type a new value (e.g. "30") without the
 * min=5 clamp swallowing your first keystroke; the value is clamped to 5–120 and
 * committed only on blur / Enter.
 */
function FocusRotationField() {
  const value = useSettings((s) => s.focusRotateSec);
  const update = useSettings((s) => s.update);
  const [text, setText] = useState(String(value));

  const commit = () => {
    const n = Math.round(Number(text));
    const clamped = text.trim() !== '' && Number.isFinite(n) ? Math.max(5, Math.min(120, n)) : value;
    update('focusRotateSec', clamped);
    setText(String(clamped));
  };

  return (
    <Field label="Rotate to a new place every (seconds)">
      <input
        type="number"
        inputMode="numeric"
        min={5}
        max={120}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        className={inputClass}
      />
    </Field>
  );
}

export default function SettingsView() {
  const s = useSettings();
  const { confirm } = useDialogs();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Settings already persist as you change them; this is an explicit, confirmed
  // write for peace of mind (and a clear "it's saved" signal).
  const handleSave = (): { ok: true } => {
    s.flush();
    return { ok: true };
  };

  // Save from inside the Advanced dialog: flush, then close once the
  // confirmation has had a moment to be seen — so one save here is all that's
  // needed (no need to also use the main Save button).
  const handleAdvancedSave = (): { ok: true } => {
    s.flush();
    return { ok: true };
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Reset all settings?',
      message: 'Your name, units and preferences return to their defaults. Journal entries are not affected.',
      confirmLabel: 'Reset',
      variant: 'danger',
    });
    if (ok) s.reset();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
      <Section title="App">
        <InstallPanel />
      </Section>

      <Section title="About you">
        <Field label="Name">
          <input
            className={inputClass}
            value={s.name}
            onChange={(e) => s.update('name', e.target.value)}
            placeholder="e.g. Pratik"
          />
        </Field>
        <Field label="Title / role">
          <input
            className={inputClass}
            value={s.title}
            onChange={(e) => s.update('title', e.target.value)}
            placeholder="e.g. Geoinformatiker"
          />
        </Field>
        <Field label="Home region">
          <input
            className={inputClass}
            value={s.homeRegion}
            onChange={(e) => s.update('homeRegion', e.target.value)}
            placeholder="e.g. Nuremberg, Germany"
          />
        </Field>
      </Section>

      <Section
        title="Language"
        info="Changes Meridian's own labels and buttons. It does not affect your entries — you can write in any language and script whatever this is set to. Bengali coverage is being filled in gradually; anything not yet translated falls back to English rather than going blank."
      >
        <div>
          <Segmented
            value={s.language}
            onChange={(v) => s.update('language', v)}
            options={LOCALES.map((l) => ({ value: l.id, label: l.label }))}
          />
        </div>
      </Section>

      <Section title="Display">
        <div>
          <span className="text-xs text-ink/50">Coordinate format</span>
          <Segmented
            value={s.coordFormat}
            onChange={(v) => s.update('coordFormat', v)}
            options={[
              { value: 'decimal', label: 'Decimal' },
              { value: 'dms', label: 'D°M′S″' },
            ]}
          />
          <p className="mt-1 text-[11px] text-ink/40 font-mono">{formatLatLng(11.0767, 49.4521, s.coordFormat)}</p>
        </div>
        <div>
          <span className="text-xs text-ink/50">Temperature unit</span>
          <Segmented
            value={s.tempUnit}
            onChange={(v) => s.update('tempUnit', v)}
            options={[
              { value: 'C', label: '°C' },
              { value: 'F', label: '°F' },
            ]}
          />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink/50">Text size</span>
            <InfoTip label="Text size">
              Scales text (and the interface) across the whole app — the timeline, entries, journal
              reading text, and settings. Applies everywhere on this device and is remembered.
            </InfoTip>
          </div>
          <Segmented
            value={s.fontSize}
            onChange={(v) => s.update('fontSize', v)}
            options={(Object.keys(FONT_SIZES) as FontSize[]).map((k) => ({
              value: k,
              label: FONT_SIZES[k].label,
            }))}
          />
        </div>
      </Section>

      <Section title="Appearance" info="“System” follows your device’s light/dark setting.">
        <div>
          <span className="text-xs text-ink/50">Theme</span>
          <Segmented
            value={s.theme}
            onChange={(v) => s.update('theme', v)}
            options={[
              { value: 'light', label: '☀︎ Light' },
              { value: 'dark', label: '☾ Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </div>
        <Toggle
          label="Animate between screens"
          hint="Cross-fades when you move between the home screen, an entry, the editor and a day. Uses the browser's own View Transitions, so it costs nothing where supported and is simply absent where it isn't. Always off if your device is set to reduce motion."
          checked={s.paneTransitions}
          onChange={(v) => s.update('paneTransitions', v)}
        />
        <Toggle
          label="Weather-tinted background"
          hint="Colours the whole app to the current weather — warm gold for sun, grey for cloud, blue for rain, icy for snow. Needs online lookups for live weather; off keeps the plain parchment."
          checked={s.weatherTint}
          onChange={(v) => s.update('weatherTint', v)}
        />
      </Section>

      <Section title="Welcome screen">
        <Toggle
          label="Living landscape backdrop"
          hint="A layered landscape — distant mountains, a forest and a lake — with a sky matched to the current weather (sun, drifting clouds, rain, snow) and the season, plus gliding birds by day and fireflies on warm nights. A few seasonal touches show when the weather is unknown."
          checked={s.seasonalAnim}
          onChange={(v) => s.update('seasonalAnim', v)}
        />
        <div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-ink/50">
              Card &amp; panel opacity
              <InfoTip label="Card and panel opacity">
                How opaque every frosted surface is over the animated scene — the welcome cards, the
                sidebar, the reading panes, and the calendar/insight cards. Turn it down to let more of
                the background bleed through; turn it up if the scene shows through and makes text hard to read.
              </InfoTip>
            </span>
            <span key={Math.round(s.cardOpacity * 100)} className="mo-readout-tick text-[11px] font-mono text-ink/60">
              {Math.round(s.cardOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={s.cardOpacity}
            onChange={(e) => s.update('cardOpacity', Number(e.target.value))}
            className="mt-2 w-full accent-terracotta"
          />
          <div className="flex justify-between text-[10px] text-ink/30">
            <span>See-through</span>
            <span>Solid</span>
          </div>
        </div>
        <Toggle
          label="Today's focus card"
          hint="The large card at the top of the welcome screen. It opens on today's writing prompt; a nearby place (from Wikipedia) is one tap away on the card's own toggle. Turn it off to hide it entirely."
          checked={s.showFocus}
          onChange={(v) => s.update('showFocus', v)}
        />
        <Toggle
          label="Daily writing prompt"
          hint="Show the writing prompt in the Today's focus card — it is what the card opens on. With this off, the card shows a nearby place instead."
          checked={s.showPrompt}
          disabled={!s.showFocus}
          onChange={(v) => s.update('showPrompt', v)}
        />
      </Section>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen(true)}
          className="btn btn-secondary btn-block"
        >
          ⚙ Advanced settings
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-ink/40">
          Dictation, map, calendar &amp; holidays, privacy, graphics quality, welcome-card order, and the
          Today's-focus rotation speed live here — tidied away so this screen stays simple.
        </p>
      </div>

      <div className="pt-2 border-t border-water">
        <button
          onClick={handleReset}
          className="text-xs text-red-500/70 hover:text-red-500"
        >
          Reset all settings
        </button>
        <p className="mt-2 text-[11px] text-ink/40 leading-relaxed">
          Settings are stored only in this browser (no server, no sync). They aren't included in journal
          exports — set them per device.
        </p>
      </div>
      </div>

      {/* Explicit save — settings also persist automatically as you change them. */}
      <div className="safe-pb border-t border-water bg-parchment px-3 pt-3">
        <AsyncButton
          className="btn btn-block btn-lg btn-primary"
          run={handleSave}
          idleLabel="Save settings"
          doneLabel="Saved locally"
        />
      </div>

      {advancedOpen && (
        <AdvancedDialog
          onClose={() => setAdvancedOpen(false)}
          footer={
            <AsyncButton
              className="btn btn-block btn-lg btn-primary"
              run={handleAdvancedSave}
              onSettled={() => setAdvancedOpen(false)}
              idleLabel="Save & close"
              doneLabel="Saved locally"
            />
          }
        >
          <Section title="Map" info="How tight the map zooms in when you select an entry, drop a pin, or locate yourself.">
            <Field label="Basemap style">
              <Segmented
                value={s.mapStyle}
                onChange={(v) => s.update('mapStyle', v)}
                options={MAP_STYLE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
              />
              <p className="mt-1.5 text-[11px] leading-snug text-ink/45">
                {MAP_STYLE_OPTIONS.find((o) => o.id === s.mapStyle)?.hint}
              </p>
            </Field>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink/50">Default zoom when focusing a place</span>
                <span key={s.mapZoom} className="mo-readout-tick text-[11px] font-mono text-ink/60">
                  {zoomLabel(s.mapZoom)}
                </span>
              </div>
              <input
                type="range"
                min={11}
                max={19}
                step={1}
                value={s.mapZoom}
                onChange={(e) => s.update('mapZoom', Number(e.target.value))}
                className="mt-2 w-full accent-terracotta"
              />
              <div className="flex justify-between text-[10px] text-ink/30">
                <span>City</span>
                <span>Street</span>
                <span>Building</span>
              </div>
            </div>
            <Toggle
              label="Draw a route line between entries"
              hint="Connects your located entries in date order on the map, tracing your path over time."
              checked={s.showPaths}
              onChange={(v) => s.update('showPaths', v)}
            />
            <Toggle
              label="Places of interest on the map"
              hint="Drops a pin on the map for each nearby place of interest. This is independent of the welcome-screen 'Places of interest' card — hiding that card keeps the pins; turn this off to remove them from the map."
              checked={s.showPoiPins}
              disabled={!s.onlineLookups}
              onChange={(v) => s.update('showPoiPins', v)}
            />
          </Section>

          <Section title="Calendar" info={HOLIDAY_INFO}>
            <HolidaySettings />
          </Section>

          <Section
            title="Dictation"
            info="The language the 🎤 mic listens for when you dictate an entry. Speech is transcribed by your browser (best in Chrome/Edge) and needs a connection; Bengali support depends on the browser."
          >
            <Field label="Dictation language">
              <select
                className={selectClass}
                value={s.dictationLang}
                onChange={(e) => s.update('dictationLang', e.target.value)}
              >
                <option value="">Follow this device</option>
                <option value="bn-IN">বাংলা — ভারত (Bengali, India)</option>
                <option value="bn-BD">বাংলা — বাংলাদেশ (Bengali, Bangladesh)</option>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="hi-IN">हिन्दी (Hindi)</option>
                <option value="de-DE">Deutsch (German)</option>
              </select>
            </Field>
          </Section>

          <Section title="Privacy & network">
            <Toggle
              label="Look up place names online"
              hint="Turns coordinates into a place name and a Wikipedia blurb/photo. Only your approximate location is sent; off = fully offline."
              checked={s.onlineLookups}
              onChange={(v) => s.update('onlineLookups', v)}
            />
            <Toggle
              label="Auto-fill place name on pin drop"
              hint="When you set a location for an entry, fill its place name automatically."
              checked={s.autoFillPlace}
              disabled={!s.onlineLookups}
              onChange={(v) => s.update('autoFillPlace', v)}
            />
            <Toggle
              label="Use a photo's location"
              hint="Reads the coordinates a camera stored inside the photo and drops the entry's pin there. Done entirely on this device — nothing is uploaded. It only ever moves a pin you haven't placed yourself, and always tells you, with an undo. Many phones strip this information when sharing a photo, so it isn't always available."
              checked={s.photoGps}
              onChange={(v) => s.update('photoGps', v)}
            />
            <PlaceBackfillPanel disabled={!s.onlineLookups} />
          </Section>

          <Section
            title="Backdrop & performance"
            info="The animated welcome backdrop's day/night behaviour and how rich it renders. Every feature works identically at every graphics level — only the visuals change. Turn the backdrop itself on/off on the main Settings screen."
          >
            <Toggle
              label="Day / night cycle"
              hint="Follows your local sunrise and sunset (computed offline): the sun rides the sky by day, a moon and stars take over at night, with a deep night sky in between. Off keeps it daytime."
              checked={s.diurnalCycle}
              disabled={!s.seasonalAnim}
              onChange={(v) => s.update('diurnalCycle', v)}
            />
            <div>
              <span className="text-xs text-ink/50">Graphics quality</span>
              <div className="mt-1">
                <Segmented
                  value={s.graphicsQuality}
                  onChange={(v) => s.update('graphicsQuality', v)}
                  options={QUALITY_ORDER.map((q) => ({ value: q, label: profileFor(q).label }))}
                  disabled={!s.seasonalAnim}
                />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-ink/50">
                {profileFor(s.graphicsQuality).blurb}
              </p>
              {!s.seasonalAnim && (
                <p className="mt-1 text-[11px] leading-snug text-ink/40">
                  Turn on “Living landscape backdrop” on the main Settings screen to see the scene.
                </p>
              )}
            </div>
            <div>
              <span className="text-xs text-ink/50">Motion</span>
              <div className="mt-1">
                <Segmented
                  value={s.motion}
                  onChange={(v) => s.update('motion', v)}
                  options={[
                    { value: 'full', label: 'Full' },
                    { value: 'reduced', label: 'Reduced' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-ink/50">
                How much the interface itself moves — button presses, panel transitions, entrance
                animations. A separate knob from Graphics quality above, which is the landscape's own
                richness. Always off if your device is set to reduce motion.
              </p>
            </div>
          </Section>

          <Section
            title="Welcome cards"
            info="The cards on the welcome screen. Drag the ≡ handle (or use ▲▼) to reorder them, and tap 👁 to hide one without losing its place. Cards with nothing to show (e.g. no location) hide themselves automatically."
          >
            <WelcomeCardsSettings />
            <div className="pt-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-ink/50">
                  “Places of interest” search radius
                  <InfoTip label="Search radius">
                    How far out the “Places of interest nearby” card looks for notable places. Wikipedia
                    caps this at 10&nbsp;km. A smaller radius keeps the list to your immediate surroundings.
                  </InfoTip>
                </span>
                <span key={s.poiRadiusKm} className="mo-readout-tick text-[11px] font-mono text-ink/60">
                  {s.poiRadiusKm} km
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={s.poiRadiusKm}
                onChange={(e) => s.update('poiRadiusKm', Number(e.target.value))}
                className="mt-2 w-full accent-terracotta"
              />
              <div className="flex justify-between text-[10px] text-ink/30">
                <span>1 km</span>
                <span>10 km</span>
              </div>
            </div>
          </Section>

          <Section
            title="Today's focus"
            info="The large focal card at the top of the welcome screen. When it's showing a nearby place, it rotates to the next one on this interval."
          >
            <FocusRotationField />
            <p className="text-[11px] leading-snug text-ink/40">
              Between 5 and 120 seconds. Rotation pauses while the tab is hidden.
            </p>
          </Section>
        </AdvancedDialog>
      )}
    </div>
  );
}
