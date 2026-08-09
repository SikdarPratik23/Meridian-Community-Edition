/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports a TipTap extension + Markdown helpers alongside its internal NodeView
   component; they belong together and HMR full-reloading this file is fine. */
import { Image } from '@tiptap/extension-image';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ATTACHMENT_SCHEME } from './inlineImages';
import type { MediaAttachment } from '../../types';

/**
 * A TipTap image node for the WYSIWYG editor that keeps Meridian's photo model
 * intact.
 *
 * Photos are NEVER stored as inline data-URLs in the saved Markdown — the app
 * deliberately stores a small downscaled copy in `media_attachments` and refers
 * to it by id (`![caption](attachment:<id>)`) so the phone stays light and the
 * full-resolution original can live on the PC. To make that work with a visual
 * editor, we keep the *editor's* image `src` as the resolved data-URL (so it
 * renders), and translate `attachment:<id>` ⇄ data-URL only at the load/save
 * boundaries (see `refsToDataUrls` / `dataUrlsToRefs`). The node view adds an
 * inline caption field (bound to the image alt text) and a remove button.
 */

function ImageView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const src = (node.attrs.src as string) || '';
  const alt = (node.attrs.alt as string) || '';
  return (
    <NodeViewWrapper as="span" className="rich-img" contentEditable={false}>
      <span className="rich-img-frame">
        <img src={src} alt={alt} draggable={false} />
        <button
          type="button"
          className="rich-img-x"
          title="Remove image"
          aria-label="Remove image"
          onClick={() => deleteNode()}
        >
          ✕
        </button>
      </span>
      <input
        className="rich-img-cap"
        type="text"
        value={alt}
        placeholder="Caption (optional)"
        onChange={(e) => updateAttributes({ alt: e.target.value })}
      />
    </NodeViewWrapper>
  );
}

export const AttachmentImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  // Serialize back to standard Markdown image syntax. The `src` here is the
  // in-editor data-URL; `dataUrlsToRefs` swaps it for `attachment:<id>` after.
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: { alt?: string; src?: string } },
        ) {
          const alt = (node.attrs.alt || '').replace(/[\r\n]+/g, ' ');
          state.write(`![${alt}](${node.attrs.src || ''})`);
        },
        // parse: omitted — tiptap-markdown's default image handling maps the
        // markdown-it `image` token to this node (name stays "image").
      },
    };
  },
});

/** Stored Markdown (`attachment:<id>`) → editor Markdown (data-URLs) for display. */
export function refsToDataUrls(markdown: string, byId: Map<string, MediaAttachment>): string {
  return markdown.replace(/\]\(attachment:([a-zA-Z0-9-]+)\)/g, (whole, id: string) => {
    const a = byId.get(id);
    return a?.data ? `](${a.data})` : whole;
  });
}

/** Editor Markdown (data-URLs) → stored Markdown (`attachment:<id>`).
 *  Exact string swap (data-URLs contain regex-special chars, so no regex). */
export function dataUrlsToRefs(markdown: string, attachments: MediaAttachment[]): string {
  let out = markdown;
  for (const a of attachments) {
    if (!a.data) continue;
    out = out.split(`](${a.data})`).join(`](${ATTACHMENT_SCHEME}${a.id})`);
  }
  return out;
}
