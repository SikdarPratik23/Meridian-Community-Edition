/**
 * Unit tests for the Markdown bundle export.
 *
 * This is the export meant to outlive the app, so the contract is: no entry is
 * lost, no attachment is lost, the front-matter is parseable, and inline photo
 * refs resolve to real files in the archive. The `attachment:<id>` rewrite is the
 * fiddly part — get it wrong and every photo in the export is a broken image.
 */
import { describe, expect, test } from 'vitest'
import {
  bundleFileName,
  buildMarkdownBundle,
  dataUrlToBytes,
  entryFileName,
  entryToMarkdown,
} from './markdownExport'
import { unzipBlob } from '../../test/unzip'
import { audio, image, journal, place } from '../../test/factories'
import { formatDate } from '../../utils'

const AT = '2026-07-15T10:30:00.000Z'
/** A 1×1 red GIF, as a real base64 data URL. */
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs='

describe('dataUrlToBytes', () => {
  test('decodes a base64 data URL', () => {
    const bytes = dataUrlToBytes(GIF)
    expect(bytes).not.toBeNull()
    expect(bytes![0]).toBe(0x47) // 'G' of GIF87a
    expect(bytes![1]).toBe(0x49)
    expect(bytes![2]).toBe(0x46)
  })

  test('decodes a plain (non-base64) data URL', () => {
    expect(new TextDecoder().decode(dataUrlToBytes('data:text/plain,hello')!)).toBe('hello')
  })

  test('returns null for a non-data URL', () => {
    expect(dataUrlToBytes('https://example.com/a.jpg')).toBeNull()
    expect(dataUrlToBytes('')).toBeNull()
  })

  test('returns null for malformed base64 rather than throwing', () => {
    expect(dataUrlToBytes('data:image/png;base64,!!!not-base64!!!')).toBeNull()
  })
})

describe('entryFileName', () => {
  test('is date-prefixed so listings sort chronologically', () => {
    expect(entryFileName(journal({ timestamp: AT, title: formatDate(AT) }))).toMatch(/^2026-07-15/)
  })

  test('a date-titled entry gets no slug', () => {
    // The title carries no information beyond the date already in the name.
    expect(entryFileName(journal({ timestamp: AT, title: formatDate(AT) }))).toBe('2026-07-15.md')
  })

  test('a named entry gets a lowercase hyphenated slug', () => {
    expect(entryFileName(journal({ timestamp: AT, title: 'Summit Day' }))).toBe(
      '2026-07-15-summit-day.md',
    )
  })

  test('a title with unsafe characters cannot escape the folder', () => {
    const name = entryFileName(journal({ timestamp: AT, title: '../../etc/passwd' }))
    expect(name).not.toContain('/')
    expect(name.endsWith('.md')).toBe(true)
  })

  test('always ends in .md', () => {
    for (const title of ['', 'x', '***', 'Ünïcodé', 'হাঁটা']) {
      expect(entryFileName(journal({ timestamp: AT, title })).endsWith('.md')).toBe(true)
    }
  })
})

describe('entryToMarkdown', () => {
  const paths = new Map<string, string>()

  test('opens with YAML front-matter', () => {
    const md = entryToMarkdown(journal({ timestamp: AT, title: 'Summit' }), paths)
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('title: Summit')
    expect(md).toContain(`date: '${AT}'`)
    // Front-matter must be closed.
    expect(md.split('---').length).toBeGreaterThanOrEqual(3)
  })

  test('includes latitude and longitude as separate named fields', () => {
    // Separate scalars, not a pair — the [lon, lat] vs [lat, lon] ambiguity is a
    // real hazard for anyone consuming the export.
    const md = entryToMarkdown(journal({ longitude: 11.0767, latitude: 49.4521 }), paths)
    expect(md).toContain('latitude: 49.4521')
    expect(md).toContain('longitude: 11.0767')
  })

  test('omits coordinates for an unlocated entry', () => {
    const md = entryToMarkdown(journal(), paths)
    expect(md).not.toContain('latitude:')
    expect(md).not.toContain('longitude:')
  })

  test('carries place, tags, trip, mood and weather', () => {
    const md = entryToMarkdown(
      journal({
        location_name: 'Nuremberg',
        tags: ['hiking', 'alps'],
        trip: 'Alps 2026',
        mood: 'elated',
        weather_condition: 'clear',
        weather_temperature: -4.5,
      }),
      paths,
    )
    expect(md).toContain('place: Nuremberg')
    expect(md).toContain('tags: [hiking, alps]')
    expect(md).toContain('trip: Alps 2026')
    expect(md).toContain('mood: elated')
    expect(md).toContain('weather: clear')
    expect(md).toContain('temperature_c: -4.5')
  })

  test('omits fields the entry does not have', () => {
    const md = entryToMarkdown(journal(), paths)
    expect(md).not.toContain('place:')
    expect(md).not.toContain('tags:')
    expect(md).not.toContain('trip:')
    expect(md).not.toContain('mood:')
  })

  test('quotes YAML values that would otherwise change meaning', () => {
    // A place name of "null" or one containing a colon would break a naive parser.
    expect(entryToMarkdown(journal({ location_name: 'null' }), paths)).toContain("place: 'null'")
    expect(entryToMarkdown(journal({ location_name: 'Nuremberg: Old Town' }), paths)).toContain(
      "place: 'Nuremberg: Old Town'",
    )
    expect(entryToMarkdown(journal({ location_name: 'true' }), paths)).toContain("place: 'true'")
  })

  test('escapes a single quote inside a quoted YAML value by doubling it', () => {
    expect(entryToMarkdown(journal({ location_name: "St John's: Hill" }), paths)).toContain(
      "place: 'St John''s: Hill'",
    )
  })

  test('includes the title as a heading and the body verbatim', () => {
    const md = entryToMarkdown(
      journal({ title: 'Summit', content_markdown: '## Notes\n\nCold up here.' }),
      paths,
    )
    expect(md).toContain('# Summit')
    expect(md).toContain('## Notes')
    expect(md).toContain('Cold up here.')
  })

  test('preserves Bengali content unchanged', () => {
    const body = 'আজ আমি হাঁটলাম।'
    expect(entryToMarkdown(journal({ content_markdown: body }), paths)).toContain(body)
  })

  test('ends with exactly one newline', () => {
    const md = entryToMarkdown(journal({ content_markdown: 'x' }), paths)
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })

  describe('attachment rewriting', () => {
    const withPaths = new Map([['ph-1', 'attachments/ph-1.jpg']])

    test('rewrites an inline attachment ref to a relative archive path', () => {
      const md = entryToMarkdown(
        journal({
          content_markdown: '![The summit](attachment:ph-1)',
          media_attachments: [image({ id: 'ph-1' })],
        }),
        withPaths,
      )
      expect(md).toContain('![The summit](../attachments/ph-1.jpg)')
      expect(md).not.toContain('attachment:ph-1')
    })

    test('leaves a ref alone when the attachment is not in the archive', () => {
      const md = entryToMarkdown(
        journal({ content_markdown: '![](attachment:missing)' }),
        withPaths,
      )
      expect(md).toContain('attachment:missing')
    })

    test('lists an attachment that is not placed inline, so nothing is lost', () => {
      const md = entryToMarkdown(
        journal({ content_markdown: 'Just prose.', media_attachments: [image({ id: 'ph-1' })] }),
        withPaths,
      )
      expect(md).toContain('## Attachments')
      expect(md).toContain('../attachments/ph-1.jpg')
    })

    test('an audio attachment is listed as a link, not an image', () => {
      const md = entryToMarkdown(
        journal({ media_attachments: [audio({ id: 'a-1', name: 'Field note' })] }),
        new Map([['a-1', 'attachments/a-1.webm']]),
      )
      expect(md).toContain('[Field note](../attachments/a-1.webm)')
      expect(md).not.toContain('![Field note]')
    })

    test('an inline photo is NOT duplicated in the Attachments list', () => {
      const md = entryToMarkdown(
        journal({
          content_markdown: '![](attachment:ph-1)',
          media_attachments: [image({ id: 'ph-1' })],
        }),
        withPaths,
      )
      expect(md).not.toContain('## Attachments')
    })
  })
})

describe('buildMarkdownBundle', () => {
  const FIXED = new Date('2026-08-05T12:00:00.000Z')

  test('writes one Markdown file per entry, foldered by year', async () => {
    const files = await unzipBlob(
      buildMarkdownBundle(
        [
          journal({ timestamp: '2026-07-15T10:00:00.000Z', title: 'A' }),
          journal({ timestamp: '2025-03-02T10:00:00.000Z', title: 'B' }),
        ],
        FIXED,
      ),
    )
    const paths = files.map((f) => f.path)
    expect(paths).toContain('2026/2026-07-15-a.md')
    expect(paths).toContain('2025/2025-03-02-b.md')
  })

  test('includes a README explaining the layout', async () => {
    const files = await unzipBlob(buildMarkdownBundle([journal()], FIXED))
    const readme = files.find((f) => f.path === 'README.md')
    expect(readme).toBeDefined()
    expect(readme!.text).toContain('Meridian journal export')
    expect(readme!.text).toContain('EPSG:4326')
  })

  test('excludes tombstoned entries', async () => {
    const files = await unzipBlob(
      buildMarkdownBundle(
        [
          journal({ timestamp: '2026-07-15T10:00:00.000Z', title: 'Kept' }),
          journal({
            timestamp: '2026-07-16T10:00:00.000Z',
            title: 'Deleted',
            deleted_at: '2026-07-17T10:00:00.000Z',
          }),
        ],
        FIXED,
      ),
    )
    const notes = files.filter((f) => f.path.endsWith('.md') && f.path !== 'README.md')
    expect(notes).toHaveLength(1)
    expect(notes[0].text).toContain('Kept')
  })

  test('writes attachments as real files and links them from the note', async () => {
    const files = await unzipBlob(
      buildMarkdownBundle(
        [
          journal({
            timestamp: '2026-07-15T10:00:00.000Z',
            title: 'Photo day',
            content_markdown: '![View](attachment:ph-1)',
            media_attachments: [image({ id: 'ph-1', mime: 'image/gif', data: GIF })],
          }),
        ],
        FIXED,
      ),
    )
    const photo = files.find((f) => f.path === 'attachments/ph-1.gif')
    expect(photo).toBeDefined()
    // The bytes must be the decoded image, not the base64 text.
    expect(photo!.bytes[0]).toBe(0x47)

    const note = files.find((f) => f.path.endsWith('photo-day.md'))!
    expect(note.text).toContain('![View](../attachments/ph-1.gif)')
  })

  test('the relative path in a note actually resolves inside the archive', async () => {
    // `2026/note.md` referencing `../attachments/x.gif` must land on a real entry.
    const files = await unzipBlob(
      buildMarkdownBundle(
        [
          journal({
            timestamp: '2026-07-15T10:00:00.000Z',
            content_markdown: '![](attachment:ph-1)',
            media_attachments: [image({ id: 'ph-1', mime: 'image/gif', data: GIF })],
          }),
        ],
        FIXED,
      ),
    )
    const note = files.find((f) => f.path.startsWith('2026/'))!
    const ref = /!\[[^\]]*\]\(\.\.\/([^)]+)\)/.exec(note.text)![1]
    expect(files.map((f) => f.path)).toContain(ref)
  })

  test('an attachment shared by two entries is written once', async () => {
    const shared = image({ id: 'ph-1', mime: 'image/gif', data: GIF })
    const files = await unzipBlob(
      buildMarkdownBundle(
        [
          journal({ timestamp: '2026-07-15T10:00:00.000Z', media_attachments: [shared] }),
          journal({ timestamp: '2026-07-16T10:00:00.000Z', media_attachments: [shared] }),
        ],
        FIXED,
      ),
    )
    expect(files.filter((f) => f.path.startsWith('attachments/'))).toHaveLength(1)
  })

  test('an undecodable attachment is skipped without failing the export', async () => {
    const files = await unzipBlob(
      buildMarkdownBundle(
        [journal({ media_attachments: [image({ id: 'bad', data: 'not-a-data-url' })] })],
        FIXED,
      ),
    )
    expect(files.filter((f) => f.path.startsWith('attachments/'))).toHaveLength(0)
    // The note itself is still exported.
    expect(files.some((f) => f.path.startsWith('2026/'))).toBe(true)
  })

  test('two same-day entries with the same name do not overwrite each other', async () => {
    const files = await unzipBlob(
      buildMarkdownBundle(
        [
          journal({ timestamp: '2026-07-15T09:00:00.000Z', title: 'Summit' }),
          journal({ timestamp: '2026-07-15T18:00:00.000Z', title: 'Summit' }),
        ],
        FIXED,
      ),
    )
    const notes = files.filter((f) => f.path.startsWith('2026/'))
    expect(notes).toHaveLength(2)
    expect(new Set(notes.map((f) => f.path)).size).toBe(2)
  })

  test('place entries are exported too', async () => {
    const files = await unzipBlob(
      buildMarkdownBundle([place({ timestamp: '2026-07-15T10:00:00.000Z', title: 'Cafe' })], FIXED),
    )
    expect(files.some((f) => f.path.endsWith('cafe.md'))).toBe(true)
  })

  test('an empty journal still produces a readable archive', async () => {
    const files = await unzipBlob(buildMarkdownBundle([], FIXED))
    expect(files.map((f) => f.path)).toEqual(['README.md'])
  })

  test('a realistic journal exports every entry', async () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      journal({
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
        title: `Day ${i}`,
        content_markdown: `Entry number ${i}.`,
      }),
    )
    const files = await unzipBlob(buildMarkdownBundle(events, FIXED))
    const notes = files.filter((f) => f.path !== 'README.md')
    expect(notes).toHaveLength(120)
  })
})

describe('bundleFileName', () => {
  test('is dated and ends in .zip', () => {
    expect(bundleFileName(new Date(2026, 7, 5, 12))).toBe('meridian-journal-2026-08-05.zip')
  })
})
