/**
 * Inline image references.
 *
 * Image *bytes* live in an entry's `media_attachments` (as data URLs); the
 * Markdown body refers to them by id with a short tag so the text stays small
 * and readable: `![optional caption](attachment:<id>)`. The reader resolves the
 * `attachment:<id>` URL back to the stored bytes. The alt text is the (optional)
 * caption — blank means no caption.
 */

export const ATTACHMENT_SCHEME = 'attachment:';

/** Build the Markdown tag that places an attachment inline. */
export function attachmentRef(id: string, caption = ''): string {
  return `![${caption}](${ATTACHMENT_SCHEME}${id})`;
}

const REF_PATTERN = /!\[[^\]]*\]\(attachment:([a-zA-Z0-9-]+)\)/g;

/** Ids of every attachment currently placed inline in the given Markdown. */
export function referencedAttachmentIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  if (!markdown) return ids;
  for (const m of markdown.matchAll(REF_PATTERN)) ids.add(m[1]);
  return ids;
}

/** Is this attachment placed somewhere in the body? */
export function hasInlineRef(markdown: string, id: string): boolean {
  return markdown.includes(`(${ATTACHMENT_SCHEME}${id})`);
}

/** Map of attachment id → its inline caption (alt text), for any placed refs. */
export function inlineCaptions(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!markdown) return out;
  const pattern = /!\[([^\]]*)\]\(attachment:([a-zA-Z0-9-]+)\)/g;
  for (const m of markdown.matchAll(pattern)) out[m[2]] = m[1];
  return out;
}

/** Replace the caption (alt text) of an inline reference to `id`, in place. */
export function setInlineCaption(markdown: string, id: string, caption: string): string {
  const re = new RegExp(`!\\[[^\\]]*\\]\\(attachment:${id}\\)`);
  return markdown.replace(re, attachmentRef(id, caption));
}

/** Remove an attachment's inline reference (and any padding blank lines). */
export function removeInlineRef(markdown: string, id: string): string {
  const re = new RegExp(`\\n*!\\[[^\\]]*\\]\\(attachment:${id}\\)\\n*`);
  return markdown.replace(re, '\n\n');
}
