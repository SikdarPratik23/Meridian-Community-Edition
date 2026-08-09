import type { AnyEvent, JournalEntry, MediaAttachment } from '../../types';
import { formatDateTime, formatDistance, formatTemperature, haversineKm } from '../../utils';

/**
 * Printable field-journal export — a cartographer-styled document the browser
 * turns into a PDF via "Save as PDF" in its print dialog. Deliberately
 * zero-dependency and fully offline: it renders its own HTML + print CSS, a
 * lightweight inline-SVG route sketch (no map tiles / network), and resolves
 * inline photos from each entry's attachments. Used for a whole trip or the
 * whole journal.
 */

interface PrintOpts {
  title: string;
  subtitle?: string;
  author?: string;
  /** Cover emblem. Defaults to the Meridian compass; trip exports pass 🧳. */
  glyph?: string;
}

/* `esc`, `inlineMd`, `bodyToHtml` and `routeSvg` are exported for unit tests —
 * they are the document's correctness-critical parts (HTML escaping and the
 * hand-rolled markdown pass) and `printJournal` itself can't be asserted on,
 * since it only opens a window and calls print(). Not used outside this module. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function hasLocation(e: AnyEvent): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

function mediaOf(e: AnyEvent): MediaAttachment[] {
  return 'media_attachments' in e && Array.isArray(e.media_attachments) ? e.media_attachments : [];
}

/** Inline markdown → HTML (text is already HTML-escaped by the caller). */
export function inlineMd(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * A small, dependency-free markdown → HTML pass good enough for journal prose:
 * headings, blockquotes, bullet/number lists, paragraphs, and images (inline
 * `attachment:<id>` refs resolved to their stored data URLs).
 */
export function bodyToHtml(md: string, attachments: MediaAttachment[]): string {
  const byId = new Map(attachments.map((a) => [a.id, a] as const));
  const resolveImg = (alt: string, src: string): string => {
    const url = src.startsWith('attachment:') ? byId.get(src.slice('attachment:'.length))?.data : src;
    if (!url) return '';
    return `<figure class="ph"><img src="${esc(url)}" alt="${esc(alt)}" />${alt ? `<figcaption>${esc(alt)}</figcaption>` : ''}</figure>`;
  };

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inlineMd(esc(para.join(' ')))}</p>`); para = []; }
  };
  const flushList = () => {
    if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${inlineMd(esc(i))}</li>`).join('')}</${list.type}>`); list = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const imgOnly = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgOnly) { flushPara(); flushList(); out.push(resolveImg(imgOnly[1], imgOnly[2])); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const lvl = h[1].length + 1; out.push(`<h${lvl}>${inlineMd(esc(h[2]))}</h${lvl}>`); continue; }

    if (line.startsWith('> ')) { flushPara(); flushList(); out.push(`<blockquote>${inlineMd(esc(line.slice(2)))}</blockquote>`); continue; }

    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul) { flushPara(); if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(ul[1]); continue; }
    if (ol) { flushPara(); if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(ol[1]); continue; }

    flushList();
    // Inline image inside a text line → drop the ref out to its own figure after the paragraph.
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

/** An offline SVG "route sketch": numbered pins + dashed path in a framed box. */
export function routeSvg(located: AnyEvent[]): string {
  if (located.length < 1) return '';
  const W = 720;
  const H = 380;
  const pad = 36;
  const lats = located.map((e) => e.latitude);
  const lons = located.map((e) => e.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  // Equirectangular-ish: compress longitude by cos(lat) so shapes aren't stretched.
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
  const spanLon = Math.max(1e-6, (maxLon - minLon) * lonScale);
  const spanLat = Math.max(1e-6, maxLat - minLat);
  const scale = Math.min((W - 2 * pad) / spanLon, (H - 2 * pad) / spanLat);
  const cx = (lon: number) => W / 2 + ((lon - (minLon + maxLon) / 2) * lonScale) * scale;
  const cy = (lat: number) => H / 2 - (lat - midLat) * scale;

  const pts = located.map((e) => ({ x: cx(e.longitude), y: cy(e.latitude) }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const line = pts.length > 1
    ? `<path d="${path}" fill="none" stroke="#C05A45" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round" />`
    : '';
  const pins = pts.map((p, i) => `
    <g>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="11" fill="#C05A45" stroke="#fff" stroke-width="2" />
      <text x="${p.x.toFixed(1)}" y="${(p.y + 3.5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${i + 1}</text>
    </g>`).join('');

  return `<svg class="route" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Route sketch">
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#FBF8F1" stroke="#D4C9B4" stroke-width="1.5" rx="6" />
    ${line}${pins}
  </svg>`;
}

function entryHtml(e: AnyEvent, index: number | null): string {
  const isJournal = e.type === 'journal';
  const j = e as JournalEntry;
  const metaBits: string[] = [formatDateTime(e.timestamp)];
  if (e.location_name) metaBits.push(`📍 ${esc(e.location_name)}`);
  if (isJournal && (j.weather_condition || j.weather_temperature != null)) {
    const w = [j.weather_condition ? esc(j.weather_condition) : '', j.weather_temperature != null ? formatTemperature(j.weather_temperature) : '']
      .filter(Boolean).join(' · ');
    if (w) metaBits.push(`🌡️ ${w}`);
  }
  const num = index != null ? `<span class="num">${index}</span>` : '';
  const body = isJournal && j.content_markdown ? bodyToHtml(j.content_markdown, mediaOf(e)) : '';
  const tags = e.tags.length ? `<div class="tags">${e.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : '';
  return `<article class="entry">
    <h2>${num}${esc(e.title)}</h2>
    <div class="meta">${metaBits.join(' &nbsp;·&nbsp; ')}</div>
    ${body}
    ${tags}
  </article>`;
}

/** Build the full print document and open it in a new window for the browser's PDF/print dialog. */
export function printJournal(events: AnyEvent[], opts: PrintOpts): void {
  const ordered = events.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const located = ordered.filter(hasLocation);
  const mapIndex = new Map(located.map((e, i) => [e.id, i + 1] as const));

  let distanceKm = 0;
  for (let i = 1; i < located.length; i++) {
    distanceKm += haversineKm(
      [located[i - 1].longitude, located[i - 1].latitude],
      [located[i].longitude, located[i].latitude],
    );
  }
  const placeCount = new Set(located.map((e) => e.location_name?.trim() || `${e.latitude.toFixed(3)},${e.longitude.toFixed(3)}`)).size;

  const stats = [
    `${ordered.length} ${ordered.length === 1 ? 'entry' : 'entries'}`,
    placeCount > 0 ? `${placeCount} ${placeCount === 1 ? 'place' : 'places'}` : '',
    located.length > 1 ? formatDistance(distanceKm) : '',
  ].filter(Boolean).join('  ·  ');

  const entriesHtml = ordered.map((e) => entryHtml(e, mapIndex.get(e.id) ?? null)).join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(opts.title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #2C3E50; background: #fff; margin: 0; line-height: 1.55; }
  .cover { text-align: center; padding: 32vh 0 0; page-break-after: always; }
  .cover .glyph { font-size: 40px; }
  .cover h1 { font-size: 34px; margin: 10px 0 4px; letter-spacing: .5px; }
  .cover .sub { font-size: 15px; color: #7B6A56; margin: 0 0 18px; }
  .cover .stats { font-size: 13px; color: #8a7a66; letter-spacing: .3px; }
  .cover .byline { margin-top: 22px; font-size: 13px; color: #8a7a66; font-style: italic; }
  .route { display: block; width: 100%; height: auto; margin: 0 auto 26px; page-break-inside: avoid; }
  .entry { page-break-inside: avoid; margin: 0 0 22px; padding: 0 0 18px; border-bottom: 1px solid #E7DFCF; }
  .entry:last-child { border-bottom: none; }
  .entry h2 { font-size: 19px; margin: 0 0 3px; }
  .entry .num { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-right: 8px; border-radius: 50%; background: #C05A45; color: #fff; font-size: 11px; vertical-align: middle; }
  .entry .meta { font-size: 12px; color: #8a7a66; margin: 0 0 10px; }
  .entry p { margin: 0 0 9px; }
  .entry h2, .entry h3, .entry h4 { line-height: 1.25; }
  .entry blockquote { margin: 8px 0; padding: 4px 14px; border-left: 3px solid #D9A441; color: #5c5344; font-style: italic; }
  .entry code { background: #F2EFE9; padding: 1px 4px; border-radius: 3px; font-size: 90%; }
  .entry ul, .entry ol { margin: 6px 0 10px 22px; }
  .entry .ph { margin: 10px 0; text-align: center; page-break-inside: avoid; }
  .entry .ph img { max-width: 100%; max-height: 360px; border: 1px solid #E7DFCF; border-radius: 6px; }
  .entry .ph figcaption { font-size: 11px; color: #8a7a66; font-style: italic; margin-top: 3px; }
  .entry .tags { margin-top: 8px; }
  .entry .tags span { display: inline-block; font-size: 11px; background: #F2EFE9; color: #5c5344; padding: 2px 8px; border-radius: 999px; margin: 0 5px 5px 0; }
  a { color: #C05A45; text-decoration: none; }
</style></head>
<body>
  <section class="cover">
    <div class="glyph">${opts.glyph ?? '🧭'}</div>
    <h1>${esc(opts.title)}</h1>
    ${opts.subtitle ? `<p class="sub">${esc(opts.subtitle)}</p>` : ''}
    <p class="stats">${esc(stats)}</p>
    ${opts.author ? `<p class="byline">A field journal by ${esc(opts.author)}</p>` : ''}
  </section>
  ${located.length ? routeSvg(located) : ''}
  ${entriesHtml}
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return; // popup blocked — caller may surface a hint
  win.document.open();
  win.document.write(html);
  win.document.close();
}
