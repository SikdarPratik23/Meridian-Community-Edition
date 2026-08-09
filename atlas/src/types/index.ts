export type Coordinates = [longitude: number, latitude: number];

export type EventType = 'journal' | 'place';

export interface AtlasEvent {
  id: string;
  type: EventType;
  title: string;
  timestamp: string;
  longitude: number;
  latitude: number;
  location_name?: string;
  tags: string[];
  /**
   * Optional trip/expedition name this entry belongs to. Set by hand in the
   * editor (checkbox → name). Entries sharing a name group into a trip in the
   * Trips panel; the entry still shows normally in the timeline. Empty/undefined
   * means the entry isn't part of any trip.
   */
  trip?: string;
  created_at: string;
  updated_at: string;
  /**
   * Soft-delete marker (ISO timestamp). When set, the entry is a *tombstone*:
   * it is hidden from every view but still travels through sync so the deletion
   * propagates to the other device. Without this, a delete on one device is
   * indistinguishable from "not seen yet" and the entry resurrects on next sync.
   */
  deleted_at?: string;
}

/**
 * A media attachment (image or audio) stored with an entry. Kept open-ended on
 * format: `mime` carries the exact type so previews/playback can adapt.
 *
 * `data` holds the bytes that TRAVEL with the entry (and so sync to every
 * device): for images this is a *downscaled* copy (see `utils/image.ts`), for
 * audio the clip itself. When `original` is set, a full-resolution original is
 * kept only on the PC's sync server under this attachment's `id` and fetched on
 * demand (see `data/media.ts`) — that's what keeps the phone's copy light.
 */
export interface MediaAttachment {
  id: string;
  kind: 'image' | 'audio';
  mime: string;
  name: string;
  data: string; // data URL — downscaled image / audio bytes
  /** A full-resolution original is stored on the PC server under this `id`. */
  original?: boolean;
  originalMime?: string;
  originalName?: string;
  originalSize?: number;
}

export interface JournalEntry extends AtlasEvent {
  type: 'journal';
  content_markdown: string;
  mood?: string;
  weather_condition?: string;
  weather_temperature?: number;
  media_attachments: MediaAttachment[];
}

export interface Place extends AtlasEvent {
  type: 'place';
  visited: boolean;
  rating?: number;
  media_attachments?: MediaAttachment[];
}

export type AnyEvent = JournalEntry | Place;

export interface ExportData {
  events: AnyEvent[];
  exported_at: string;
}
