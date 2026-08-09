import { useCallback, useEffect, useRef, useState } from 'react';
import { generateId } from '../../utils';
import type { MediaAttachment } from '../../types';
import { MAX_SECONDS, MIN_SECONDS, audioRecordingSupported } from './audioSupport';

/**
 * Voice notes — record straight into an entry.
 *
 * The data model has carried `kind: 'audio'` attachments since the beginning and
 * the reader could already play one back; what was missing was any way to make
 * one. This is that: a MediaRecorder capture with a live timer, a waveform-ish
 * level meter so you can see it's actually hearing you, and a review step before
 * the clip is attached.
 *
 * Design decisions worth knowing:
 *
 *  - **Clips are stored inline as data URLs**, like small images, so they sync to
 *    every device with the entry. That's why there's a hard cap: audio is far
 *    heavier per second than text, and the whole journal travels in one sync
 *    payload. `MAX_SECONDS` stops a forgotten recording from bloating the
 *    database, and recording auto-stops when it's reached.
 *  - **No PC-authoritative split** (unlike photos, which keep a full-resolution
 *    original on the PC). A voice note has no "downscaled" version that's still
 *    useful, so splitting it would mean the phone couldn't play its own recording
 *    offline. Keeping one modest-bitrate copy everywhere is the honest trade.
 *  - **The mic stream is always stopped** on stop, unmount, and on error. A
 *    left-open stream leaves the browser's recording indicator lit, which reads as
 *    a privacy bug even when it isn't one.
 */


/** The MIME types worth trying, best first. Browsers disagree: Chrome/Firefox do
 *  webm/opus, Safari does mp4/aac. An empty string lets the browser choose. */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  '',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of PREFERRED_TYPES) {
    if (!type) return '';
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function AudioRecorder({
  onAttach,
  onCancel,
}: {
  onAttach: (attachment: MediaAttachment) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** A finished clip awaiting review — the user can play it, keep it or discard it. */
  const [clip, setClip] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Release the microphone and every analysis resource. Safe to call twice. */
  const teardown = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (tickRef.current != null) { clearInterval(tickRef.current); tickRef.current = null; }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recorderRef.current = null;
  }, []);

  // Never leave the mic open, whatever route the component leaves by.
  useEffect(() => teardown, [teardown]);
  // Revoke the review clip's object URL when it's replaced or the panel closes.
  useEffect(() => {
    const url = clip?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [clip?.url]);

  const stop = useCallback(() => {
    // `onstop` (set in start) turns the chunks into the review clip.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!audioRecordingSupported()) {
      setError('Recording needs a browser with microphone access over a secure (https) connection.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Microphone permission denied — allow it for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : "Couldn't start recording.",
      );
      return;
    }
    streamRef.current = stream;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      teardown();
      setError("This browser couldn't start an audio recorder.");
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      teardown();
      setLevel(0);
      if (blob.size === 0 || elapsed < MIN_SECONDS) {
        setError('That was too short to keep — hold the button a moment longer.');
        return;
      }
      setClip({ blob, url: URL.createObjectURL(blob), seconds: elapsed });
    };

    startedAtRef.current = Date.now();
    setSeconds(0);
    recorder.start();
    setRecording(true);

    // Elapsed time, and the auto-stop at the cap.
    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 200);

    // Live input level, so silence from a muted or dead mic is visible rather
    // than being discovered after the fact.
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        const ctx = new AudioCtor();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const sample = () => {
          analyser.getByteTimeDomainData(buffer);
          let peak = 0;
          for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevel(peak);
          rafRef.current = requestAnimationFrame(sample);
        };
        rafRef.current = requestAnimationFrame(sample);
      }
    } catch {
      // The meter is decorative; recording continues without it.
    }
  }, [stop, teardown]);

  const keep = useCallback(async () => {
    if (!clip) return;
    setBusy(true);
    try {
      const data = await blobToDataUrl(clip.blob);
      const extension = clip.blob.type.includes('mp4') ? 'm4a' : clip.blob.type.includes('ogg') ? 'ogg' : 'webm';
      onAttach({
        id: generateId(),
        kind: 'audio',
        mime: clip.blob.type || 'audio/webm',
        name: `Voice note ${formatClock(clip.seconds)}.${extension}`,
        data,
      });
    } catch {
      setError("Couldn't save that recording.");
    } finally {
      setBusy(false);
    }
  }, [clip, onAttach]);

  const discard = useCallback(() => {
    setClip(null);
    setError(null);
  }, []);

  const remaining = Math.max(0, MAX_SECONDS - seconds);

  return (
    <div className="space-y-2 rounded border border-water bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink/70">🎙 Voice note</span>
        <button type="button" onClick={onCancel} className="text-xs text-ink/40 hover:text-ink" title="Close">
          ✕
        </button>
      </div>

      {error && <p className="text-xs text-terracotta">{error}</p>}

      {!clip && (
        <>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={recording ? stop : start}
              className={`btn btn-sm ${recording ? 'btn-danger' : 'btn-primary'}`}
            >
              {recording ? '■ Stop' : '● Record'}
            </button>
            <span className="font-mono text-sm tabular-nums text-ink/70">{formatClock(seconds)}</span>
            {recording && (
              <span className="text-[11px] text-ink/40">
                {remaining < 30 ? `${Math.ceil(remaining)}s left` : `max ${formatClock(MAX_SECONDS)}`}
              </span>
            )}
          </div>

          {/* Input level. Rendered as discrete bars rather than a smooth meter so
              it reads at a glance even at a tiny size. */}
          {recording && (
            <div className="flex h-6 items-end gap-0.5" aria-hidden="true">
              {Array.from({ length: 24 }, (_, i) => {
                const lit = level * 24 > i;
                return (
                  <span
                    key={i}
                    className={`w-1 rounded-sm transition-[height,background-color] duration-75 ${
                      lit ? 'bg-terracotta' : 'bg-water'
                    }`}
                    style={{ height: `${lit ? 25 + (i / 24) * 75 : 12}%` }}
                  />
                );
              })}
            </div>
          )}
          {recording && level < 0.01 && seconds > 2 && (
            <p className="text-[11px] text-ink/40">
              No sound detected — check the microphone is unmuted.
            </p>
          )}
        </>
      )}

      {clip && (
        <div className="space-y-2">
          {/* A voice note is its own content; there is no separate caption track to add. */}
          <audio src={clip.url} controls className="w-full" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={keep} disabled={busy} className="btn btn-sm btn-primary">
              {busy ? 'Attaching…' : '✓ Attach'}
            </button>
            <button type="button" onClick={discard} className="btn btn-sm btn-secondary">
              Discard
            </button>
            <span className="ml-auto text-[11px] text-ink/40">{formatClock(clip.seconds)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
