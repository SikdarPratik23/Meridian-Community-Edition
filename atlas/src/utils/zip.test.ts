/**
 * Unit tests for the hand-written ZIP writer.
 *
 * Since there's no library underneath, these check the archive against an
 * independent parser (`test/unzip.ts`) and an independent CRC-32 — a writer
 * verified only against its own assumptions would happily pass on a file no
 * unzip tool could open. Offsets are the classic failure: a wrong central-directory
 * offset produces an archive that looks fine byte-count-wise and fails to extract.
 */
import { describe, expect, test } from 'vitest'
import { createZip, safeFileName } from './zip'
import { crc32Of, unzipBlob } from '../test/unzip'

describe('createZip', () => {
  test('round-trips a single text file', async () => {
    const zip = createZip([{ path: 'hello.txt', content: 'Hello, world!' }])
    const entries = await unzipBlob(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('hello.txt')
    expect(entries[0].text).toBe('Hello, world!')
  })

  test('round-trips several files, preserving order', async () => {
    const zip = createZip([
      { path: 'a.md', content: 'first' },
      { path: 'b.md', content: 'second' },
      { path: 'c.md', content: 'third' },
    ])
    const entries = await unzipBlob(zip)
    expect(entries.map((e) => e.path)).toEqual(['a.md', 'b.md', 'c.md'])
    expect(entries.map((e) => e.text)).toEqual(['first', 'second', 'third'])
  })

  test('preserves nested folder paths', async () => {
    const zip = createZip([
      { path: '2026/2026-07-15.md', content: 'entry' },
      { path: 'attachments/photo.jpg', content: new Uint8Array([1, 2, 3]) },
    ])
    const entries = await unzipBlob(zip)
    expect(entries.map((e) => e.path)).toEqual(['2026/2026-07-15.md', 'attachments/photo.jpg'])
  })

  test('uses the STORE method (no compression)', async () => {
    const entries = await unzipBlob(createZip([{ path: 'a.txt', content: 'x' }]))
    expect(entries[0].method).toBe(0)
  })

  test('records a correct CRC-32 for each file', async () => {
    // Checked against an independent CRC implementation.
    const zip = createZip([
      { path: 'a.txt', content: 'The quick brown fox' },
      { path: 'b.txt', content: '' },
      { path: 'c.bin', content: new Uint8Array([0, 255, 128, 7]) },
    ])
    for (const entry of await unzipBlob(zip)) {
      expect(entry.crc, entry.path).toBe(crc32Of(entry.bytes))
    }
  })

  test('an empty archive is still a valid ZIP', async () => {
    await expect(unzipBlob(createZip([]))).resolves.toEqual([])
  })

  test('handles an empty file', async () => {
    const entries = await unzipBlob(createZip([{ path: 'empty.txt', content: '' }]))
    expect(entries[0].bytes).toHaveLength(0)
    expect(entries[0].text).toBe('')
  })

  test('round-trips binary content byte-for-byte', async () => {
    const bytes = new Uint8Array(512)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256
    const entries = await unzipBlob(createZip([{ path: 'blob.bin', content: bytes }]))
    expect([...entries[0].bytes]).toEqual([...bytes])
  })

  test('encodes UTF-8 text correctly', async () => {
    const text = 'আজ আমি হাঁটলাম 🌍 — Nürnberg'
    const entries = await unzipBlob(createZip([{ path: 'bengali.md', content: text }]))
    expect(entries[0].text).toBe(text)
  })

  test('encodes non-ASCII file names as UTF-8', async () => {
    const entries = await unzipBlob(createZip([{ path: 'হাঁটা.md', content: 'x' }]))
    expect(entries[0].path).toBe('হাঁটা.md')
  })

  test('offsets stay correct across many files of differing sizes', async () => {
    // The strongest structural check: any offset arithmetic error shows up here as
    // a corrupt local header or shifted content.
    const files = Array.from({ length: 60 }, (_, i) => ({
      path: `dir${i % 5}/file-${i}.md`,
      content: 'x'.repeat(i * 17),
    }))
    const entries = await unzipBlob(createZip(files))
    expect(entries).toHaveLength(60)
    for (let i = 0; i < 60; i++) {
      expect(entries[i].path).toBe(files[i].path)
      expect(entries[i].text).toBe(files[i].content)
    }
  })

  test('strips a leading slash so paths stay relative', async () => {
    const entries = await unzipBlob(createZip([{ path: '/absolute.md', content: 'x' }]))
    expect(entries[0].path).toBe('absolute.md')
  })

  test('reports the archive as a zip MIME type', () => {
    expect(createZip([{ path: 'a.txt', content: 'x' }]).type).toBe('application/zip')
  })

  test('output is byte-stable when no dates are given', async () => {
    // Determinism matters for testability and for diffing two exports.
    const build = () => createZip([{ path: 'a.md', content: 'same' }])
    const first = new Uint8Array(await build().arrayBuffer())
    const second = new Uint8Array(await build().arrayBuffer())
    expect([...first]).toEqual([...second])
  })

  test('a supplied date is recorded without breaking the archive', async () => {
    const zip = createZip([
      { path: 'a.md', content: 'x', date: new Date(2026, 6, 15, 10, 30, 0) },
    ])
    await expect(unzipBlob(zip)).resolves.toHaveLength(1)
  })

  test('a pre-1980 date is clamped rather than corrupting the header', async () => {
    // DOS timestamps start at 1980; a 1970 date would underflow the bit field.
    const zip = createZip([{ path: 'a.md', content: 'x', date: new Date(1970, 0, 1) }])
    await expect(unzipBlob(zip)).resolves.toHaveLength(1)
  })

  test('a large file round-trips', async () => {
    const big = 'A'.repeat(300_000)
    const entries = await unzipBlob(createZip([{ path: 'big.md', content: big }]))
    expect(entries[0].text).toHaveLength(300_000)
    expect(entries[0].crc).toBe(crc32Of(entries[0].bytes))
  })
})

describe('safeFileName', () => {
  test('leaves an ordinary title alone', () => {
    expect(safeFileName('Summit day')).toBe('Summit day')
  })

  test('keeps hyphens and underscores', () => {
    expect(safeFileName('alps-2026_final')).toBe('alps-2026_final')
  })

  test('keeps unicode, including Bengali', () => {
    expect(safeFileName('হাঁটা')).toBe('হাঁটা')
  })

  test('turns path separators into dashes', () => {
    expect(safeFileName('a/b')).toBe('a-b')
    expect(safeFileName('a\\b')).toBe('a-b')
  })

  test('blocks directory traversal', () => {
    // The security case: a title like this must not be able to escape its folder.
    const safe = safeFileName('../../etc/passwd')
    expect(safe).not.toContain('/')
    expect(safe).not.toContain('\\')
    expect(safe.startsWith('.')).toBe(false)
  })

  test('strips characters Windows forbids', () => {
    expect(safeFileName('a<b>c:d"e|f?g*h')).toBe('abcdefgh')
  })

  test('strips control characters', () => {
    expect(safeFileName('a\u0000b\u001fc\u007f')).toBe('abc')
  })

  test('collapses runs of whitespace', () => {
    expect(safeFileName('a    b\t\tc')).toBe('a b c')
  })

  test('drops leading whitespace and dots', () => {
    expect(safeFileName('   .hidden')).toBe('hidden')
  })

  test('drops trailing dots and spaces (Windows strips them silently)', () => {
    expect(safeFileName('name...  ')).toBe('name')
  })

  test('truncates a very long name', () => {
    expect(safeFileName('x'.repeat(500)).length).toBeLessThanOrEqual(80)
  })

  test('truncation does not leave a trailing space', () => {
    const name = safeFileName(`${'x'.repeat(79)} tail`)
    expect(name.endsWith(' ')).toBe(false)
  })

  test('falls back when nothing usable is left', () => {
    expect(safeFileName('///')).toBe('---') // separators map to dashes, which are fine
    expect(safeFileName('***')).toBe('untitled')
    expect(safeFileName('')).toBe('untitled')
    expect(safeFileName('   ')).toBe('untitled')
    expect(safeFileName('...')).toBe('untitled')
  })

  test('honours a custom fallback', () => {
    expect(safeFileName('', 'entry')).toBe('entry')
  })

  test('never returns a name a zip entry could not hold', () => {
    for (const input of ['../x', 'C:\\Windows', 'a\u0000b', '.', '..', '   ', '?', 'ok']) {
      const out = safeFileName(input)
      expect(out.length).toBeGreaterThan(0)
      expect(out).not.toContain('/')
      expect(out).not.toContain('\\')
      expect(out.startsWith('.')).toBe(false)
    }
  })
})
