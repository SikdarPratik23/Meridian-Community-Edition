/**
 * Test fixture builders.
 *
 * Entries carry a lot of required fields that most tests don't care about, so
 * these give a valid baseline you override with just the bits under test:
 *
 *   journal({ latitude: 49.45, longitude: 11.08, trip: 'Alps' })
 *
 * Timestamps default to a FIXED date, never `new Date()` — a test that depends on
 * "now" fails a year later for no reason.
 */
import type { JournalEntry, MediaAttachment, Place } from '../types'

let seq = 0
/** Deterministic, collision-free id (tests that assert on ids should pass one). */
export function testId(prefix = 'e'): string {
  seq += 1
  return `${prefix}-${String(seq).padStart(4, '0')}`
}

/** Reset the id counter so ids are stable within a suite that relies on them. */
export function resetIds(): void {
  seq = 0
}

export const FIXED_ISO = '2026-07-15T10:30:00.000Z'

export function journal(over: Partial<JournalEntry> = {}): JournalEntry {
  const ts = over.timestamp ?? FIXED_ISO
  return {
    id: over.id ?? testId(),
    type: 'journal',
    title: 'Test entry',
    timestamp: ts,
    // 0,0 is Meridian's "no pin set" sentinel — the default is deliberately
    // unlocated so a test that cares about location must say so.
    longitude: 0,
    latitude: 0,
    tags: [],
    content_markdown: '',
    media_attachments: [],
    created_at: ts,
    updated_at: ts,
    ...over,
  }
}

export function place(over: Partial<Place> = {}): Place {
  const ts = over.timestamp ?? FIXED_ISO
  return {
    id: over.id ?? testId('p'),
    type: 'place',
    title: 'Test place',
    timestamp: ts,
    longitude: 0,
    latitude: 0,
    tags: [],
    visited: false,
    created_at: ts,
    updated_at: ts,
    ...over,
  }
}

export function image(over: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    id: over.id ?? testId('img'),
    kind: 'image',
    mime: 'image/jpeg',
    name: 'photo.jpg',
    data: 'data:image/jpeg;base64,AAAA',
    ...over,
  }
}

export function audio(over: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    id: over.id ?? testId('aud'),
    kind: 'audio',
    mime: 'audio/webm',
    name: 'note.webm',
    data: 'data:audio/webm;base64,AAAA',
    ...over,
  }
}

/** Well-known coordinates for distance assertions, as [lon, lat]. */
export const COORDS = {
  nuremberg: [11.0767, 49.4521] as [number, number],
  munich: [11.582, 48.1351] as [number, number],
  berlin: [13.405, 52.52] as [number, number],
  kolkata: [88.3639, 22.5726] as [number, number],
  sydney: [151.2093, -33.8688] as [number, number],
  nullIsland: [0, 0] as [number, number],
}
