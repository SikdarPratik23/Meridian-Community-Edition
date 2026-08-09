import { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { useAtlasStore } from '../../store/atlas';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useDialogs } from '../../components/ui/dialogs';
import { toast } from '../../components/ui/toasts';
import AsyncButton, { type AsyncButtonResult } from '../../components/ui/AsyncButton';
import { saveEvent } from '../../data/db';
import { scheduleSync } from '../../data/sync';
import { generateId, formatLatLng, formatTemperature, formatDate } from '../../utils';
import { downscaleImage } from '../../utils/image';
import { readPhotoGps } from '../../utils/exif';
import { storeOriginal } from '../../data/media';
import { useSettings } from '../../store/settings';
import { reverseGeocode } from '../welcome/locationInfo';
import { fetchCurrentWeather, describeWeatherCode, type CurrentWeather } from '../welcome/weather';
import { AttachmentImage, refsToDataUrls, dataUrlsToRefs } from './AttachmentImage';
import { referencedAttachmentIds } from './inlineImages';
import TagInput from './TagInput';
import AudioRecorder from './AudioRecorder';
import { audioRecordingSupported } from './audioSupport';
import { tripNames } from '../trips/trips';
import Presence from '../../components/ui/Presence';
import Disclosure from '../../components/ui/Disclosure';
import { useFrozen } from '../../hooks/useFrozen';
import type { Coordinates, JournalEntry, MediaAttachment } from '../../types';

/** Read a File into a data URL (inline bytes). Used for small images and audio. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Read an image File into a MediaAttachment. Large photos are DOWNSCALED for the
 * inline copy (what syncs to every device, keeping the phone light) while the
 * full-resolution original is shipped to the PC and fetched on demand. Small
 * images are kept inline as-is (nothing worth splitting off).
 */
async function readImageAttachment(file: File): Promise<MediaAttachment> {
  const id = generateId();
  const down = await downscaleImage(file);
  if (down) {
    // Ship the original to the PC (or queue it if the PC is offline right now).
    void storeOriginal(id, file);
    return {
      id, kind: 'image', mime: down.mime, name: file.name, data: down.dataUrl,
      original: true, originalMime: file.type, originalName: file.name, originalSize: file.size,
    };
  }
  return { id, kind: 'image', mime: file.type, name: file.name, data: await fileToDataUrl(file) };
}

/** Minimal shape of the Web Speech API bits we use (not in lib.dom yet). */
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

/**
 * Conservative clean-up of a finalised dictation chunk before it lands in the
 * text. Deliberately gentle for now — collapse runaway whitespace and fix the
 * lone lowercase "i" — so it never mangles meaning. The richer pass (sentence
 * punctuation + filler-word removal) is the planned follow-up (see notes), best
 * done by a real language model rather than brittle regexes.
 */
function tidyDictation(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\bi\b/g, 'I')
    .trim();
}

/** Format a Date as a `YYYY-MM-DDTHH:mm` string in local time for <input type="datetime-local">. */
function toDatetimeLocal(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const DRAFT_KEY = 'atlas_draft_v2';

/** The crash-safety draft for a NEW entry, read once from localStorage. Returns
 *  an empty object when there's no draft or storage is unavailable.
 *
 *  We also delete the LEGACY `atlas_draft` key here: earlier builds could leave a
 *  stale draft full of the old starter-template text, which then reappeared every
 *  time a new entry opened. Bumping the key (and clearing the old one) guarantees
 *  a clean, blank field going forward while preserving crash-recovery. */
function loadDraft(): { title?: string; content?: string; mood?: string } {
  try {
    localStorage.removeItem('atlas_draft'); // drop any legacy template junk
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

/**
 * Compose a new journal entry, or edit an existing one when `event` is passed.
 * In edit mode the entry's id and created_at are preserved; only updated_at is
 * bumped on save.
 */
export default function JournalEditor({ event, onClose }: { event?: JournalEntry; onClose: () => void }) {
  const isEditing = !!event;
  const addOrUpdateEvent = useAtlasStore((s) => s.addOrUpdateEvent);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const draftLocation = useAtlasStore((s) => s.draftLocation);
  const setDraftLocation = useAtlasStore((s) => s.setDraftLocation);
  const pickingLocation = useAtlasStore((s) => s.pickingLocation);
  const setPickingLocation = useAtlasStore((s) => s.setPickingLocation);
  const geo = useGeolocation();
  const { prompt: promptDialog } = useDialogs();

  // A new entry recovers any crash-draft; an edited one ignores it. Read once at
  // first render (not in an effect) so there are no extra mount-time re-renders.
  const [initialDraft] = useState(() => (event ? {} : loadDraft()));

  // The optional custom name. A date-titled entry has no real name, so we leave the
  // field empty (it stays date-driven and re-derives if the date changes); only a
  // genuine custom name prefills.
  const [title, setTitle] = useState(() =>
    event
      ? (event.title !== formatDate(event.timestamp) ? event.title : '')
      : (initialDraft.title ?? ''),
  );
  const [content, setContent] = useState(event?.content_markdown ?? initialDraft.content ?? '');
  const [mood, setMood] = useState(event?.mood ?? initialDraft.mood ?? '');
  const [tags, setTags] = useState<string[]>(event?.tags ?? []);
  // Manual trip tagging: check the box and name the trip. Entries sharing a name
  // group in the Trips tab; the entry still appears normally in the timeline.
  const [tripEnabled, setTripEnabled] = useState<boolean>(!!event?.trip);
  const [tripName, setTripName] = useState<string>(event?.trip ?? '');
  const allEvents = useAtlasStore((s) => s.events);
  const tripSuggestions = useMemo(() => tripNames(allEvents), [allEvents]);
  // Weather recorded with the entry. Captured automatically for a new entry;
  // preserved (from storage) when editing one.
  const [weather, setWeather] = useState<CurrentWeather | null>(() =>
    event?.weather_temperature != null
      ? {
          temperatureC: event.weather_temperature,
          code: -1,
          label: event.weather_condition || describeWeatherCode(-1).label,
          emoji: describeWeatherCode(-1).emoji,
        }
      : null,
  );
  const weatherFetched = useRef(false);
  const [locationName, setLocationName] = useState(event?.location_name ?? '');
  const [attachments, setAttachments] = useState<MediaAttachment[]>(event?.media_attachments ?? []);
  // Always the latest attachments, for the editor's onUpdate transform (which
  // must not re-create the editor on every image add).
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; });
  // The entry's date/time. Defaults to now but is editable so you can journal for a past day.
  const [when, setWhen] = useState(() => toDatetimeLocal(event ? new Date(event.timestamp) : new Date()));
  const [listening, setListening] = useState(false);
  // Live partial transcript (shown while speaking) and a human-readable problem
  // (e.g. mic blocked / offline) so dictation never just silently does nothing.
  const [interim, setInterim] = useState('');
  const [dictationError, setDictationError] = useState<string | null>(null);
  // So the exit fade shows the message it's actually fading out, rather than
  // blanking the instant the error is cleared.
  const shownDictationError = useFrozen(dictationError ?? '', !!dictationError);
  const [geocoding, setGeocoding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const userStoppedRef = useRef(false);
  const restartCountRef = useRef(0);
  // Once the user edits the place name themselves — or when editing an entry that
  // already has one — stop auto-filling it.
  const placeNameTouched = useRef(!!event?.location_name);
  /**
   * True once the pin represents a deliberate choice rather than the automatic
   * GPS seed: the user picked it on the map, cleared it, or we're editing an
   * entry that already had one. A photo's EXIF position only takes over while
   * this is false, so attaching a photo can never silently move a pin the user
   * placed by hand.
   */
  const locationTouched = useRef(isEditing);
  /** Set when a photo's EXIF moved the pin, so we can say so and offer an undo. */
  const [photoGps, setPhotoGps] = useState<{ from: Coordinates | null; fileName: string } | null>(null);
  const pendingCaptureMode = useAtlasStore((s) => s.pendingCaptureMode);
  const setPendingCaptureMode = useAtlasStore((s) => s.setPendingCaptureMode);
  const pendingCapturePhoto = useAtlasStore((s) => s.pendingCapturePhoto);
  const setPendingCapturePhoto = useAtlasStore((s) => s.setPendingCapturePhoto);

  /** Whether the voice-note recorder panel is open. */
  const [recordingAudio, setRecordingAudio] = useState(
    () => pendingCaptureMode === 'audio',
  );

  useEffect(() => {
    if (pendingCaptureMode === 'audio') {
      setPendingCaptureMode(null);
    }
  }, [pendingCaptureMode, setPendingCaptureMode]);

  const coordFormat = useSettings((s) => s.coordFormat);
  const tempUnit = useSettings((s) => s.tempUnit);
  const autoFillPlace = useSettings((s) => s.autoFillPlace);
  const onlineLookups = useSettings((s) => s.onlineLookups);
  const dictationLang = useSettings((s) => s.dictationLang);
  const photoGpsEnabled = useSettings((s) => s.photoGps);

  // Resolve existing entry photos (attachment:<id>) to data-URLs so they render
  // in the WYSIWYG editor. Save converts them back (dataUrlsToRefs) so storage,
  // sync and exports keep using the light attachment-ref form.
  const attachmentsById = useMemo(
    () => new Map((event?.media_attachments ?? []).map((a) => [a.id, a] as const)),
    [event],
  );

  /** Voice notes get their own list — unlike photos they have no inline node. */
  const audioAttachments = useMemo(
    () => attachments.filter((a) => a.kind === 'audio'),
    [attachments],
  );

  // Toolbar active-state buttons need a re-render on each editor transaction.
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Write your entry…' }),
      Markdown.configure({ html: false, transformPastedText: true }),
      AttachmentImage.configure({ inline: true, allowBase64: true }),
    ],
    content: refsToDataUrls(event?.content_markdown ?? initialDraft.content ?? '', attachmentsById),
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
      setContent(dataUrlsToRefs(md, attachmentsRef.current));
    },
  });

  // Keep the latest editor for the dictation callback without re-creating it.
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; });

  useEffect(() => {
    if (!editor) return;
    const handler = () => forceRender();
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  // Add a link to the current selection (or clear it if one is selected).
  const addLink = useCallback(async () => {
    if (!editor) return;
    if (editor.isActive('link')) { editor.chain().focus().unsetLink().run(); return; }
    const url = await promptDialog({ title: 'Add a link', label: 'URL', placeholder: 'https://', confirmLabel: 'Add link' });
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor, promptDialog]);

  // Auto-fill the place name when a location is set (GPS or hand-picked), unless
  // the user has typed their own, or disabled online lookups / autofill.
  useEffect(() => {
    if (!draftLocation || !autoFillPlace || !onlineLookups || placeNameTouched.current) return;
    const ctrl = new AbortController();
    setGeocoding(true);
    reverseGeocode(draftLocation[1], draftLocation[0], ctrl.signal, 'locality')
      .then((name) => { if (name && !placeNameTouched.current) setLocationName(name); })
      .catch(() => {})
      .finally(() => setGeocoding(false));
    return () => ctrl.abort();
  }, [draftLocation, autoFillPlace, onlineLookups]);

  // Capture current weather once for a NEW entry, as soon as a position is known
  // (hand-picked draft location preferred, else GPS). Editing keeps the saved value.
  useEffect(() => {
    if (isEditing || !onlineLookups || weatherFetched.current) return;
    const lat = draftLocation ? draftLocation[1] : geo.latitude;
    const lon = draftLocation ? draftLocation[0] : geo.longitude;
    if (lat == null || lon == null) return;
    weatherFetched.current = true;
    const ctrl = new AbortController();
    fetchCurrentWeather(lat, lon, ctrl.signal).then((w) => { if (w) setWeather(w); }).catch(() => {});
    return () => ctrl.abort();
  }, [isEditing, onlineLookups, draftLocation, geo.latitude, geo.longitude]);

  const speechSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Ask for the current position once; seed the draft location with it if nothing is set yet.
  useEffect(() => { geo.requestPosition(); }, []);
  useEffect(() => {
    if (geo.latitude != null && geo.longitude != null && !draftLocation) {
      setDraftLocation([geo.longitude, geo.latitude]);
    }
  }, [geo.latitude, geo.longitude]);

  // Lightweight crash-safety: keep a text draft in localStorage. Only for new
  // entries — editing works against the saved record, not the unsaved draft.
  useEffect(() => {
    if (isEditing) return;
    const timer = setInterval(() => {
      if (title || content) {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content, mood }));
        } catch {
          // storage full / disabled (private mode) — losing the crash-draft is fine
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [isEditing, title, content, mood]);

  // Add image(s): downscale (keeps the phone light), stash the attachment, and
  // drop an image node into the editor at the cursor. The editor holds the
  // data-URL for display; save() converts it back to an attachment:<id> ref.
  const insertImages = useCallback(
    async (files: FileList | File[] | null) => {
      const imageFiles = files ? Array.from(files).filter((f) => f.type.startsWith('image/')) : [];
      if (!imageFiles.length || !editor) return;

      // Read the photo's own GPS from the ORIGINAL file, before downscaling — the
      // canvas re-encode in `downscaleImage` strips all EXIF. Only the first
      // photo that carries a position is used, and only while the pin is still
      // the automatic GPS seed (see `locationTouched`). Many phones strip GPS on
      // share/export, so finding nothing is the normal case, not a failure.
      const gpsPromise = photoGpsEnabled
        ? (async () => {
            for (const file of imageFiles) {
              const coords = await readPhotoGps(file);
              if (coords) return { coords, fileName: file.name };
            }
            return null;
          })()
        : Promise.resolve(null);

      const [added, found] = await Promise.all([
        Promise.all(imageFiles.map(readImageAttachment)),
        gpsPromise,
      ]);

      setAttachments((prev) => [...prev, ...added]);
      let chain = editor.chain().focus();
      for (const a of added) chain = chain.setImage({ src: a.data, alt: '' });
      chain.run();

      if (found && !locationTouched.current) {
        const previous = useAtlasStore.getState().draftLocation;
        setDraftLocation(found.coords);
        setPhotoGps({ from: previous, fileName: found.fileName });
        // The pin now describes the photo, not the device — let the place name
        // re-resolve to match it.
        placeNameTouched.current = false;
      }
    },
    [editor, photoGpsEnabled, setDraftLocation],
  );

  useEffect(() => {
    if (pendingCapturePhoto && editor) {
      const file = pendingCapturePhoto;
      setPendingCapturePhoto(null);
      setTimeout(() => {
        void insertImages([file]);
      }, 0);
    }
  }, [pendingCapturePhoto, setPendingCapturePhoto, editor, insertImages]);

  /** Put the pin back where it was before a photo's EXIF moved it. */
  const undoPhotoGps = useCallback(() => {
    if (!photoGps) return;
    setDraftLocation(photoGps.from);
    setPhotoGps(null);
    // An explicit undo IS a deliberate choice — don't let the next photo move it.
    locationTouched.current = true;
  }, [photoGps, setDraftLocation]);

  const toggleDictation = useCallback(() => {
    if (!speechSupported) return;
    if (listening) {
      userStoppedRef.current = true;
      recognitionRef.current?.stop();
      return;
    }
    const SR = (window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    });
    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition;
    if (!Ctor) return;
    setDictationError(null);
    setInterim('');
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true; // show words as you speak, for live feedback
    // Chosen dictation language (e.g. 'bn-IN' for Bengali); '' follows the browser.
    rec.lang = dictationLang || navigator.language || 'en-US';
    rec.onresult = (event) => {
      // Real speech arrived — refill the silence-restart budget so a long
      // dictation with natural pauses doesn't exhaust it and quit on you.
      restartCountRef.current = 0;
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      setInterim(interimText.trim());
      if (finalText.trim()) {
        editorRef.current?.chain().focus().insertContent(tidyDictation(finalText) + ' ').run();
        setInterim('');
      }
    };
    rec.onerror = (event) => {
      const err = event?.error ?? '';
      // Fatal conditions: tell the user why, and don't thrash on auto-restart.
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setDictationError('Microphone access is blocked. Allow the mic for this site in your browser, then tap 🎤 again.');
        userStoppedRef.current = true;
      } else if (err === 'audio-capture') {
        setDictationError('No microphone was found on this device.');
        userStoppedRef.current = true;
      } else if (err === 'network') {
        setDictationError('Dictation needs an internet connection — the browser transcribes speech in the cloud.');
        userStoppedRef.current = true;
      }
      // 'no-speech' / 'aborted' are transient; onend handles the restart.
    };
    rec.onend = () => {
      setInterim('');
      if (userStoppedRef.current) {
        userStoppedRef.current = false;
        restartCountRef.current = 0;
        setListening(false);
      } else if (restartCountRef.current < 10) {
        restartCountRef.current++;
        setTimeout(() => { try { rec.start(); } catch { setListening(false); } }, 300);
      } else {
        restartCountRef.current = 0;
        setListening(false);
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if called while already running, or on some locked-down
      // browsers — surface it rather than leaving a dead button.
      setDictationError('Could not start dictation. Please try again.');
    }
  }, [speechSupported, listening, dictationLang]);

  // Stop dictation if the editor unmounts mid-recording. Mark it user-stopped
  // first so onend doesn't try to restart on an unmounted component.
  useEffect(
    () => () => {
      userStoppedRef.current = true;
      recognitionRef.current?.stop();
    },
    [],
  );

  // The write itself is synchronous (sql.js is in-memory) — split out from
  // navigating away so <AsyncButton> can show its checkmark BEFORE the pane
  // closes, rather than the two happening in the same instant the way the
  // save used to. `onSettled` (below) does the actual closing, once that
  // confirmation has had a moment to be seen.
  const doSave = useCallback((): { ok: true; data: JournalEntry } => {
    const now = new Date().toISOString();
    // Use the chosen date for the entry's timestamp (so it sorts on the timeline by
    // when it happened); fall back to now if the field was cleared.
    const happenedAt = when ? new Date(when).toISOString() : now;
    // The date is the entry's natural title. A custom name is optional; when the
    // name field is blank we title the entry by its date.
    const finalTitle = title.trim() || formatDate(happenedAt);
    // Only keep the photos still referenced in the body (deleting an image node
    // in the editor drops its ref from the Markdown, so it's excluded here).
    // Audio is exempt: a voice note is never placed inline, so filtering it by
    // body references would silently discard every recording on save.
    const usedIds = referencedAttachmentIds(content);
    const usedAttachments = attachments.filter((a) => a.kind === 'audio' || usedIds.has(a.id));
    const entry: JournalEntry = {
      // Editing keeps the original id and created_at; a new entry mints both.
      id: event?.id ?? generateId(),
      type: 'journal',
      title: finalTitle,
      timestamp: happenedAt,
      longitude: draftLocation ? draftLocation[0] : 0,
      latitude: draftLocation ? draftLocation[1] : 0,
      location_name: locationName || undefined,
      tags,
      trip: tripEnabled && tripName.trim() ? tripName.trim() : undefined,
      content_markdown: content,
      mood: mood || undefined,
      weather_condition: weather?.label,
      weather_temperature: weather?.temperatureC,
      media_attachments: usedAttachments,
      created_at: event?.created_at ?? now,
      updated_at: now,
    };

    saveEvent(entry);
    addOrUpdateEvent(entry);
    scheduleSync(); // push the new/edited entry to the other device
    return { ok: true, data: entry };
  }, [title, content, mood, tags, tripEnabled, tripName, weather, draftLocation, locationName, when, attachments, event, addOrUpdateEvent]);

  const handleSaved = useCallback(
    (result: AsyncButtonResult<JournalEntry>) => {
      const entry = result.data;
      if (!entry) return;
      // When editing, refresh the open card so it shows the saved changes.
      if (isEditing) selectEvent(entry);
      else localStorage.removeItem(DRAFT_KEY);
      onClose();
      // Saving used to be silent: the pane just changed, with nothing confirming
      // the write actually landed in the database.
      toast.success(isEditing ? 'Changes saved' : 'Entry saved');
    },
    [isEditing, selectEvent, onClose],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between safe-pt px-3 pb-3 border-b border-water">
        <h2 className="font-serif text-lg font-bold">{isEditing ? 'Edit Entry' : 'New Entry'}</h2>
        <div className="flex items-center gap-1.5">
          {/* Mark this entry as part of a trip right up front. The name field
              drops in just below the header when this is on. */}
          <button
            type="button"
            onClick={() => setTripEnabled((v) => !v)}
            aria-pressed={tripEnabled}
            title={tripEnabled ? 'This entry is part of a trip' : 'Mark this entry as part of a trip'}
            className={`btn btn-sm ${tripEnabled ? 'btn-active' : 'btn-secondary'}`}
          >
            🧳 <span>{tripEnabled ? 'Part of a trip' : 'Mark as trip'}</span>
          </button>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
          <AsyncButton
            className="btn btn-primary btn-sm"
            run={doSave}
            onSettled={handleSaved}
            idleLabel={isEditing ? 'Save changes' : 'Save Entry'}
            workingLabel="Saving…"
            doneLabel="Saved"
          />
        </div>
      </div>

      {/* Trip name — appears directly under the header when "Trip" is on, so the
          entry can be tagged before writing. Same name = same trip in the Trips
          tab; the entry still shows normally in the timeline. */}
      <Disclosure open={tripEnabled}>
        <div className="border-b border-water px-3 py-2.5">
          <input
            type="text"
            list="trip-suggestions"
            placeholder="🧳 Trip name (e.g. Nuremberg Weekend)"
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            className="w-full rounded border border-water bg-surface px-3 py-2 text-sm focus:border-terracotta focus:outline-none"
          />
          <datalist id="trip-suggestions">
            {tripSuggestions.map((t) => <option key={t} value={t} />)}
          </datalist>
          <p className="mt-1 text-[11px] text-ink/40">Groups in the Trips tab · this entry still stays in your timeline.</p>
        </div>
      </Disclosure>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink/50 whitespace-nowrap">🗓️ Date &amp; time</span>
          <input
            type="datetime-local"
            value={when}
            max={toDatetimeLocal(new Date())}
            onChange={(e) => setWhen(e.target.value)}
            className="flex-1 px-3 py-2 bg-surface border border-water rounded text-sm focus:outline-none focus:border-terracotta"
          />
          <button
            type="button"
            onClick={() => setWhen(toDatetimeLocal(new Date()))}
            className="text-xs text-ink/50 hover:text-ink whitespace-nowrap"
            title="Reset to the current date and time"
          >
            Now
          </button>
        </label>
        {/* WYSIWYG editor — formatting shows the way it will look (no ** or ##
            on screen). Buttons toggle formatting on the current selection; the
            body is still stored as portable Markdown under the hood. */}
        <div className="rich-editor rounded border border-water bg-surface focus-within:border-terracotta">
          <div className="flex flex-wrap items-center gap-1 border-b border-water p-1.5">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} className={`fmt-btn ${editor?.isActive('heading', { level: 2 }) ? 'fmt-btn-active' : ''}`} title="Heading">H</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()} className={`fmt-btn font-bold ${editor?.isActive('bold') ? 'fmt-btn-active' : ''}`} title="Bold">B</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()} className={`fmt-btn italic ${editor?.isActive('italic') ? 'fmt-btn-active' : ''}`} title="Italic">I</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`fmt-btn ${editor?.isActive('bulletList') ? 'fmt-btn-active' : ''}`} title="Bulleted list">• List</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={`fmt-btn ${editor?.isActive('blockquote') ? 'fmt-btn-active' : ''}`} title="Quote">❝ Quote</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addLink} className={`fmt-btn ${editor?.isActive('link') ? 'fmt-btn-active' : ''}`} title="Add or remove a link">🔗 Link</button>
            {speechSupported && (
              <button type="button" onClick={toggleDictation} aria-pressed={listening} title={listening ? 'Stop dictation' : 'Dictate — speak to add text'} className={`fmt-btn ml-auto ${listening ? 'fmt-btn-rec' : ''}`}>
                🎤{listening ? ' Stop' : ''}
              </button>
            )}
          </div>
          <div className="markdown px-3 py-2">
            <EditorContent editor={editor} />
          </div>
        </div>
        <Presence when={listening} exitMs={160} enterClassName="mo-rise-in" exitClassName="mo-fade-out">
          <p className="text-[11px] text-red-500">
            <span className="animate-pulse">●</span> Listening… speak, then tap 🎤 again to stop.
            {interim && <span className="ml-1 italic text-ink/50">“{interim}”</span>}
          </p>
        </Presence>
        <Presence when={!!dictationError} exitMs={160} enterClassName="mo-rise-in" exitClassName="mo-fade-out">
          <p className="text-[11px] text-red-500" role="alert">⚠ {dictationError ?? shownDictationError}</p>
        </Presence>
        <p className="text-[11px] text-ink/40">
          Select text and tap a button to format it — it shows the way it will look, no symbols to remember.
          {speechSupported && ' Tap 🎤 to dictate.'} Use <span className="font-medium">🖼️ Add image</span> below to drop a photo in.
        </p>

        {/* Attach: images + camera + location */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 min-w-[8rem] py-2 border border-water rounded text-sm hover:bg-land transition-colors"
            title="Insert image(s) into your text where the cursor is"
          >
            🖼️ Add image
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 min-w-[8rem] py-2 border border-water rounded text-sm hover:bg-land transition-colors"
            title="Take a photo now and insert it where the cursor is"
          >
            📷 Take photo
          </button>
          {/* Recording needs getUserMedia, which only exists in a secure context —
              so this is absent over plain http on the LAN. Hidden rather than shown
              broken, since it's a browser rule we can't work around. */}
          {audioRecordingSupported() && (
            <button
              type="button"
              onClick={() => setRecordingAudio((v) => !v)}
              className={`flex-1 min-w-[8rem] py-2 border rounded text-sm transition-colors ${
                recordingAudio ? 'border-terracotta bg-terracotta/10 text-terracotta' : 'border-water hover:bg-land'
              }`}
              title="Record a voice note and attach it to this entry"
            >
              🎙 Voice note
            </button>
          )}
          <button
            type="button"
            onClick={() => { locationTouched.current = true; setPhotoGps(null); setPickingLocation(true); }}
            className={`flex-1 min-w-[8rem] py-2 border rounded text-sm transition-colors ${
              pickingLocation ? 'border-terracotta bg-terracotta/10 text-terracotta' : 'border-water hover:bg-land'
            }`}
          >
            🗺️ {pickingLocation ? 'Click the map…' : 'Set location'}
          </button>
        </div>

        <Presence when={recordingAudio} exitMs={160} enterClassName="mo-rise-in" exitClassName="mo-fade-out">
          <AudioRecorder
            onAttach={(attachment) => {
              setAttachments((prev) => [...prev, attachment]);
              setRecordingAudio(false);
            }}
            onCancel={() => setRecordingAudio(false)}
          />
        </Presence>

        {/* Voice notes attached to this entry. Photos are managed inline in the
            editor body; audio has no inline representation, so it's listed here. */}
        {audioAttachments.length > 0 && (
          <ul className="space-y-1.5">
            {audioAttachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded border border-water bg-surface px-2 py-1.5">
                {/* A voice note is its own content; there is no separate caption track to add. */}
                <audio src={a.data} controls className="h-8 min-w-0 flex-1" />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="shrink-0 text-xs text-ink/40 hover:text-terracotta"
                  title="Remove this voice note"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { insertImages(e.target.files); e.target.value = ''; }}
        />
        {/* Camera capture: on a phone this opens the live camera; on desktop it
            falls back to the file picker. Same insert-at-cursor pipeline. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { insertImages(e.target.files); e.target.value = ''; }}
        />

        {/* Photos now live inline in the editor itself (each with its own caption
            field + remove button), so the old thumbnail manager is gone. */}

        {/* Location status */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-ink/50">
            {pickingLocation
              ? '📍 Click anywhere on the map to set the location'
              : draftLocation
                ? `📍 ${formatLatLng(draftLocation[0], draftLocation[1], coordFormat)}`
                : geo.loading
                  ? '📍 Getting location…'
                  : '📍 No location set'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => geo.requestPosition()}
              className="text-ink/50 hover:text-ink"
              title="Use my current GPS position"
            >
              Use current
            </button>
            {draftLocation && (
              <button
                type="button"
                onClick={() => { locationTouched.current = true; setPhotoGps(null); setDraftLocation(null); }}
                className="text-ink/40 hover:text-ink"
                title="Remove the location from this entry"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* The pin came from a photo's own EXIF GPS. Say so plainly and offer a
            one-tap undo — a silently moved pin would be worse than no help. */}
        <Disclosure open={!!photoGps}>
          <div className="flex items-center justify-between gap-2 rounded border border-forest/30 bg-forest/10 px-3 py-2 text-xs">
            <span className="text-ink/70">
              📸 Pin set from where <strong className="font-medium">{photoGps?.fileName}</strong> was taken
            </span>
            <button
              type="button"
              onClick={undoPhotoGps}
              className="shrink-0 text-ink/60 underline hover:text-ink"
            >
              Undo
            </button>
          </div>
        </Disclosure>

        <input
          type="text"
          placeholder={geocoding ? 'Finding place name…' : 'Place name (optional)'}
          value={locationName}
          onChange={(e) => { placeNameTouched.current = true; setLocationName(e.target.value); }}
          className="w-full px-3 py-2 bg-surface border border-water rounded text-sm focus:outline-none focus:border-terracotta"
        />
        {/* Optional custom name. Left blank, the entry is titled by its date. */}
        <input
          type="text"
          placeholder="Name this entry (optional — defaults to the date)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 bg-surface border border-water rounded text-sm focus:outline-none focus:border-terracotta"
        />
        <input
          type="text"
          placeholder="Mood (e.g., thoughtful, tired)"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          className="w-full px-3 py-2 bg-surface border border-water rounded text-sm focus:outline-none focus:border-terracotta"
        />

        {/* Tags — searchable keywords for this entry. */}
        <div>
          <span className="block text-[11px] text-ink/40 mb-1">🏷️ Tags</span>
          <TagInput value={tags} onChange={setTags} />
        </div>

        {weather && (
          <p className="text-[11px] text-ink/40">
            {weather.emoji} {weather.label} · {formatTemperature(weather.temperatureC, tempUnit)}
            <span className="text-ink/30"> — recorded with this entry</span>
          </p>
        )}
      </div>
    </div>
  );
}
