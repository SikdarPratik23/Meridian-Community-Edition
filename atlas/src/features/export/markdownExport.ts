/**
 * Markdown bundle export — the journal as plain files you own.
 *
 * Every entry becomes one `.md` file with YAML front-matter, photos are written
 * alongside as real image files, and the whole thing is zipped. The point is
 * portability: the output drops straight into Obsidian, Logseq, a static site
 * generator, or a plain folder that will still open in 20 years. It is the most
 * durable of Meridian's export formats precisely because it needs no Meridian.
 *
 * Layout inside the archive:
 *
 *   README.md                        what this is, and how it's organised
 *   2026/
 *     2026-07-15-summit-day.md       one file per entry, date-prefixed
 *   attachments/
 *     <attachment-id>.jpg            photos, referenced relatively from the notes
 *
 * Front-matter carries the structured fields (coordinates, tags, mood, weather,
 * trip) so a tool that understands YAML can rebuild the metadata, while the body
 * stays exactly the Markdown the user wrote.
 */
import type { AnyEvent, JournalEntry, MediaAttachment } from '../../types';
import { createZip, safeFileName, type ZipEntry } from '../../utils/zip';
import { getDayKey, isDateTitle } from '../../utils';
import { isLocated } from '../../utils/geoExport';

/** Map a MIME type to a sensible file extension for the attachments folder. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
};

function extensionFor(attachment: MediaAttachment): string {
  const known = EXTENSIONS[attachment.mime?.toLowerCase() ?? ''];
  if (known) return known;
  // Fall back to the original name's extension, else a neutral one.
  const dot = attachment.name?.lastIndexOf('.') ?? -1;
  if (dot > 0) {
    const ext = attachment.name.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  }
  return attachment.kind === 'audio' ? 'bin' : 'jpg';
}

/** Quote a value for YAML only when it needs it, so simple output stays readable. */
function yamlValue(value: string): string {
  if (value === '') return "''";
  // Anything that could be read as another YAML type, or that contains
  // structural characters, gets single-quoted (with internal quotes doubled).
  const needsQuoting =
    /^[\s>|*&!%@`?-]|[:#]\s|[:[\]{},"']|^(?:true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[+-]?\d/.test(value) ||
    /\s$/.test(value);
  return needsQuoting ? `'${value.replace(/'/g, "''")}'` : value;
}

function yamlList(items: string[]): string {
  return `[${items.map(yamlValue).join(', ')}]`;
}

/**
 * Decode a data URL into raw bytes. Returns null for anything that isn't a
 * base64 data URL (an attachment could in principle hold a blob/remote URL).
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!match) return null;
  const [, , isBase64, payload] = match;
  try {
    if (!isBase64) {
      return new TextEncoder().encode(decodeURIComponent(payload));
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function mediaOf(event: AnyEvent): MediaAttachment[] {
  return 'media_attachments' in event && Array.isArray(event.media_attachments)
    ? event.media_attachments
    : [];
}

/**
 * The file name (without folder) for an entry: date-prefixed so a plain
 * alphabetical listing is chronological, then a slug of the title when the entry
 * has a real name of its own.
 */
export function entryFileName(event: AnyEvent): string {
  const day = getDayKey(event.timestamp);
  const named = !isDateTitle(event.title, event.timestamp) && event.title.trim();
  const slug = named ? `-${safeFileName(event.title, '').toLowerCase().replace(/ /g, '-')}` : '';
  return `${day}${slug}.md`;
}

/** Build one entry's Markdown file: YAML front-matter, a heading, then the body. */
export function entryToMarkdown(event: AnyEvent, attachmentPaths: Map<string, string>): string {
  const journal = event.type === 'journal' ? (event as JournalEntry) : null;

  const front: string[] = [
    `title: ${yamlValue(event.title)}`,
    `date: ${yamlValue(event.timestamp)}`,
  ];
  if (isLocated(event)) {
    // Written as separate scalars rather than a pair, so the meaning of each is
    // unambiguous — the [lon, lat] vs [lat, lon] confusion is a real hazard.
    front.push(`latitude: ${event.latitude}`);
    front.push(`longitude: ${event.longitude}`);
  }
  if (event.location_name) front.push(`place: ${yamlValue(event.location_name)}`);
  if (event.tags.length) front.push(`tags: ${yamlList(event.tags)}`);
  if (event.trip) front.push(`trip: ${yamlValue(event.trip)}`);
  if (journal?.mood) front.push(`mood: ${yamlValue(journal.mood)}`);
  if (journal?.weather_condition) front.push(`weather: ${yamlValue(journal.weather_condition)}`);
  if (journal?.weather_temperature != null) {
    front.push(`temperature_c: ${journal.weather_temperature}`);
  }

  // Rewrite `attachment:<id>` image refs to the archive's relative paths so the
  // photos actually resolve when the folder is opened in another tool.
  let body = journal?.content_markdown ?? '';
  body = body.replace(
    /(!\[[^\]]*\]\()attachment:([a-zA-Z0-9-]+)(\))/g,
    (whole, open: string, id: string, close: string) => {
      const path = attachmentPaths.get(id);
      return path ? `${open}../${path}${close}` : whole;
    },
  );

  // Any attachment NOT placed inline (e.g. an audio note) is listed at the end so
  // the export never silently loses a file the entry owns.
  const inlineIds = new Set(
    [...body.matchAll(/!\[[^\]]*\]\(\.\.\/attachments\/([^)]+)\)/g)].map((m) => m[1]),
  );
  const extras = mediaOf(event).filter((a) => {
    const path = attachmentPaths.get(a.id);
    return path && !inlineIds.has(path.replace('attachments/', ''));
  });

  const sections = [
    '---',
    ...front,
    '---',
    '',
    `# ${event.title}`,
    '',
    body.trim(),
  ];

  if (extras.length) {
    sections.push('', '## Attachments', '');
    for (const a of extras) {
      const path = attachmentPaths.get(a.id)!;
      sections.push(
        a.kind === 'audio'
          ? `- [${a.name || 'Audio note'}](../${path})`
          : `- ![${a.name || ''}](../${path})`,
      );
    }
  }

  return `${sections.join('\n').trimEnd()}\n`;
}

function readme(events: AnyEvent[], generatedAt: Date): string {
  const years = [...new Set(events.map((e) => e.timestamp.slice(0, 4)))].sort();
  return [
    '# Meridian journal export',
    '',
    `${events.length} ${events.length === 1 ? 'entry' : 'entries'}, exported ${generatedAt.toISOString()}.`,
    '',
    '## How this is organised',
    '',
    '- One Markdown file per entry, grouped into a folder per year.',
    '- File names start with the entry date, so a plain alphabetical listing reads chronologically.',
    "- Each file opens with YAML front-matter holding the entry's structured fields",
    '  (coordinates, place, tags, trip, mood, weather). The rest is the entry as written.',
    '- `attachments/` holds the photos and audio, referenced relatively from each note.',
    '',
    'Coordinates are WGS 84 (EPSG:4326) decimal degrees. `latitude` and `longitude`',
    'are separate fields to avoid any ambiguity about their order.',
    '',
    years.length ? `## Years\n\n${years.map((y) => `- ${y}`).join('\n')}\n` : '',
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');
}

/**
 * Build the whole export archive. Tombstoned (deleted) entries are excluded —
 * this is a readable copy of the journal, not a sync payload.
 *
 * `generatedAt` is injected rather than read from the clock so the output is
 * reproducible and testable.
 */
export function buildMarkdownBundle(events: AnyEvent[], generatedAt = new Date()): Blob {
  const live = events
    .filter((e) => !e.deleted_at)
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Attachment id → path in the archive. Ids are UUIDs, so they're already unique
  // and make stable, collision-free file names.
  const attachmentPaths = new Map<string, string>();
  const files: ZipEntry[] = [];

  for (const event of live) {
    for (const attachment of mediaOf(event)) {
      if (attachmentPaths.has(attachment.id)) continue;
      const bytes = dataUrlToBytes(attachment.data);
      if (!bytes) continue; // nothing decodable to write
      const path = `attachments/${safeFileName(attachment.id, 'file')}.${extensionFor(attachment)}`;
      attachmentPaths.set(attachment.id, path);
      files.push({ path, content: bytes, date: new Date(event.timestamp) });
    }
  }

  // Entry notes. Two entries on the same day with the same name would collide, so
  // disambiguate with a counter rather than silently overwriting.
  const usedPaths = new Set<string>();
  for (const event of live) {
    const year = event.timestamp.slice(0, 4);
    const base = entryFileName(event);
    let path = `${year}/${base}`;
    let n = 2;
    while (usedPaths.has(path)) {
      path = `${year}/${base.replace(/\.md$/, '')}-${n}.md`;
      n += 1;
    }
    usedPaths.add(path);
    files.push({
      path,
      content: entryToMarkdown(event, attachmentPaths),
      date: new Date(event.timestamp),
    });
  }

  files.push({ path: 'README.md', content: readme(live, generatedAt), date: generatedAt });

  return createZip(files);
}

/** A dated file name for the download, e.g. `meridian-journal-2026-08-05.zip`. */
export function bundleFileName(generatedAt = new Date()): string {
  return `meridian-journal-${getDayKey(generatedAt.toISOString())}.zip`;
}
