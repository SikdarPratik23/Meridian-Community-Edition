/**
 * Unit tests for the inline-attachment reference scheme.
 *
 * This is the contract between an entry's Markdown body and its stored photo
 * bytes: the body holds `![caption](attachment:<id>)` and the bytes live in
 * `media_attachments`. `referencedAttachmentIds` decides which attachments are
 * KEPT on save — so a bug here silently drops photos out of saved entries, which
 * is unrecoverable data loss.
 */
import { describe, expect, test } from 'vitest'
import {
  ATTACHMENT_SCHEME,
  attachmentRef,
  hasInlineRef,
  inlineCaptions,
  referencedAttachmentIds,
  removeInlineRef,
  setInlineCaption,
} from './inlineImages'

const ID = 'a1b2c3d4-0000-4000-8000-000000000001'

describe('attachmentRef', () => {
  test('builds a Markdown image tag with the attachment scheme', () => {
    expect(attachmentRef(ID)).toBe(`![](${ATTACHMENT_SCHEME}${ID})`)
  })

  test('includes the caption as alt text', () => {
    expect(attachmentRef(ID, 'The summit')).toBe(`![The summit](attachment:${ID})`)
  })

  test('round-trips through referencedAttachmentIds', () => {
    expect([...referencedAttachmentIds(attachmentRef(ID, 'x'))]).toEqual([ID])
  })
})

describe('referencedAttachmentIds', () => {
  test('finds a single reference', () => {
    expect([...referencedAttachmentIds(`Text\n\n![](attachment:${ID})`)]).toEqual([ID])
  })

  test('finds several references across the body', () => {
    const md = `![a](attachment:id-1)\n\nmiddle\n\n![b](attachment:id-2)`
    expect([...referencedAttachmentIds(md)].sort()).toEqual(['id-1', 'id-2'])
  })

  test('de-duplicates a photo placed twice', () => {
    const md = `![](attachment:id-1)\n\n![again](attachment:id-1)`
    expect([...referencedAttachmentIds(md)]).toEqual(['id-1'])
  })

  test('returns an empty set for a body with no photos', () => {
    expect(referencedAttachmentIds('Just prose.').size).toBe(0)
  })

  test('returns an empty set for an empty body', () => {
    expect(referencedAttachmentIds('').size).toBe(0)
  })

  test('ignores ordinary Markdown images that are not attachments', () => {
    const md = '![remote](https://example.com/a.jpg)'
    expect(referencedAttachmentIds(md).size).toBe(0)
  })

  test('ignores a link (not an image) to an attachment', () => {
    expect(referencedAttachmentIds(`[text](attachment:${ID})`).size).toBe(0)
  })

  test('matches a UUID id in full', () => {
    // The pattern allows [a-zA-Z0-9-], so a real crypto.randomUUID must match
    // completely rather than being truncated at the first dash.
    expect([...referencedAttachmentIds(`![](attachment:${ID})`)]).toEqual([ID])
  })
})

describe('hasInlineRef', () => {
  test('true when the attachment is placed in the body', () => {
    expect(hasInlineRef(`![](attachment:${ID})`, ID)).toBe(true)
  })

  test('false when it is not', () => {
    expect(hasInlineRef('![](attachment:other)', ID)).toBe(false)
  })

  test('false for an empty body', () => {
    expect(hasInlineRef('', ID)).toBe(false)
  })
})

describe('inlineCaptions', () => {
  test('maps id → caption', () => {
    const md = `![The summit](attachment:id-1)\n\n![Base camp](attachment:id-2)`
    expect(inlineCaptions(md)).toEqual({ 'id-1': 'The summit', 'id-2': 'Base camp' })
  })

  test('an uncaptioned photo maps to an empty string', () => {
    expect(inlineCaptions('![](attachment:id-1)')).toEqual({ 'id-1': '' })
  })

  test('is an empty object when there are no photos', () => {
    expect(inlineCaptions('prose only')).toEqual({})
  })

  test('is an empty object for an empty body', () => {
    expect(inlineCaptions('')).toEqual({})
  })
})

describe('setInlineCaption', () => {
  test('replaces an empty caption', () => {
    expect(setInlineCaption('![](attachment:id-1)', 'id-1', 'New')).toBe('![New](attachment:id-1)')
  })

  test('replaces an existing caption', () => {
    expect(setInlineCaption('![Old](attachment:id-1)', 'id-1', 'New')).toBe('![New](attachment:id-1)')
  })

  test('clears a caption when passed an empty string', () => {
    expect(setInlineCaption('![Old](attachment:id-1)', 'id-1', '')).toBe('![](attachment:id-1)')
  })

  test('leaves other photos untouched', () => {
    const md = '![A](attachment:id-1)\n\n![B](attachment:id-2)'
    expect(setInlineCaption(md, 'id-2', 'Bee')).toBe('![A](attachment:id-1)\n\n![Bee](attachment:id-2)')
  })

  test('is a no-op when the id is not present', () => {
    const md = '![A](attachment:id-1)'
    expect(setInlineCaption(md, 'missing', 'x')).toBe(md)
  })

  test('preserves surrounding prose', () => {
    const md = `Before\n\n![Old](attachment:id-1)\n\nAfter`
    expect(setInlineCaption(md, 'id-1', 'New')).toBe(`Before\n\n![New](attachment:id-1)\n\nAfter`)
  })
})

describe('removeInlineRef', () => {
  test('removes the reference', () => {
    expect(referencedAttachmentIds(removeInlineRef('![A](attachment:id-1)', 'id-1')).size).toBe(0)
  })

  test('collapses the surrounding blank lines to one paragraph break', () => {
    const md = 'Before\n\n![A](attachment:id-1)\n\nAfter'
    expect(removeInlineRef(md, 'id-1')).toBe('Before\n\nAfter')
  })

  test('leaves other photos in place', () => {
    const md = '![A](attachment:id-1)\n\n![B](attachment:id-2)'
    const out = removeInlineRef(md, 'id-1')
    expect([...referencedAttachmentIds(out)]).toEqual(['id-2'])
  })

  test('is a no-op when the id is not present', () => {
    const md = '![A](attachment:id-1)'
    expect(removeInlineRef(md, 'missing')).toBe(md)
  })

  test('removing the only content leaves just whitespace', () => {
    expect(removeInlineRef('![A](attachment:id-1)', 'id-1').trim()).toBe('')
  })
})
