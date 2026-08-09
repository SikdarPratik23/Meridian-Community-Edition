/**
 * Audio-recording capability and limits.
 *
 * Split out of `AudioRecorder.tsx` because a file that exports both a component
 * and plain values breaks Vite's Fast Refresh (it can't hot-swap a module whose
 * non-component exports other modules depend on). The editor needs the support
 * check to decide whether to show the button at all, before the recorder itself is
 * ever mounted, so these belong in their own module regardless.
 */

/** Hard cap on a single clip. Long enough for a real field note, short enough that
 *  a forgotten recording can't bloat the synced database — voice notes travel
 *  inline with the entry, so every second is data on every device. */
export const MAX_SECONDS = 180;

/** Below this, a clip is almost certainly an accidental tap rather than a note. */
export const MIN_SECONDS = 0.4;

/**
 * Is recording possible here at all?
 *
 * Needs both `getUserMedia` and `MediaRecorder`. Note that `getUserMedia` only
 * exists in a SECURE CONTEXT — which the LAN address (plain
 * `http://192.168.x.x`) is not, and that's precisely how the phone reaches
 * Meridian when syncing over WiFi. It's a browser rule with no workaround, so the
 * caller should hide the button rather than show one that can't work.
 */
export function audioRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}
