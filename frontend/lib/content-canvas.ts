/**
 * Content Studio ⇄ Canvas bridge (pure, IO-free, unit-testable).
 *
 * Front-facing content (blog_post / resource / guide / …) is authored in the SAME Canvas as
 * proposals, with the CanvasDocument as the source of truth (persisted in the content_pages
 * row's metadata.canvas). The public marketing site reads the row's blocks[0].body, so on
 * every save we project the canvas → HTML there. The public renderer detects an HTML body
 * (`body.startsWith('<')`) and sanitizes it — zero public-side change.
 *
 * Two directions:
 *   docBodyFromCanvas(canvas)      → the HTML projection stored in blocks[0].body (public read)
 *   canvasFromDocBody(title, body) → seed a starter canvas from an existing markdown/HTML body
 *   newContentCanvas(title)        → a friendly blank canvas for a brand-new document
 *
 * See docs/CONTENT_STUDIO_DESIGN.md.
 */
import {
  CANVAS_PRESETS,
  type CanvasDocument, type CanvasNode, type CanvasSection, type TextBlockContent,
} from '@/lib/types/canvas-document';

// Self-contained node factory (mirrors lib/library/artifact-canvas.ts) — a seed node needs
// no actor history; provenance 'template' marks it as starter content.
const node = (type: CanvasNode['type'], content: unknown): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  content: content as CanvasNode['content'],
  style: {} as CanvasNode['style'],
  provenance: { source: 'template' },
  history: [],
  library_eligible: false,
});

function baseDoc(title: string, nodes: CanvasNode[]): CanvasDocument {
  const section: CanvasSection = {
    id: crypto.randomUUID(),
    title,
    layout: { mode: 'flow' },
    groups: [{ id: crypto.randomUUID(), nodes }],
  };
  return {
    version: 2,
    document_id: crypto.randomUUID(),
    // Web content is not page-bound → the `custom` preset (no page budget, images allowed)
    // so the compliance floor never raises a false page-limit warning on an article.
    canvas: CANVAS_PRESETS.custom,
    nodes: [],
    sections: [section],
    metadata: {
      title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'in_progress',
    },
  } as CanvasDocument;
}

// ── Public web projection ─────────────────────────────────────────────────────────────────
// The marketing site does NOT ship @tailwindcss/typography — there is no `.prose`, and Tailwind
// Preflight RESETS bare tags (ul/ol → no markers, h1-6 → body size, a → no color). The legacy
// markdown path (lib/markdown.ts) coped by baking utility classes into its output. Canvas content
// must be just as self-contained, so we emit semantic tags with INLINE web styles — bulletproof
// against JIT purging AND Preflight (inline beats the reset), and preserved by the page sanitizer
// (which keeps style attrs). This is a WEB renderer, deliberately separate from the print/PDF
// renderCanvasBodyHtml (pt units, page furniture) which stays for exports.

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const INLINE_TAG_WEB: Record<string, [string, string]> = {
  bold: ['<strong>', '</strong>'], strong: ['<strong>', '</strong>'],
  italic: ['<em>', '</em>'], emphasis: ['<em>', '</em>'],
  underline: ['<u>', '</u>'], strikethrough: ['<s>', '</s>'], code: ['<code>', '</code>'],
};

/** Render a text-block's inline runs (bold/italic/…) to escaped HTML with web-safe tags. */
function inlineRunsWeb(tb: { text?: string; inline_formats?: { start: number; length: number; format: string }[] }): string {
  const chars = [...(tb.text ?? '')];
  const n = chars.length;
  if (n === 0) return '';
  const at: Array<Set<string>> = Array.from({ length: n }, () => new Set());
  for (const f of tb.inline_formats ?? []) {
    for (let k = f.start; k < f.start + f.length && k < n; k++) if (k >= 0) at[k].add(f.format);
  }
  const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  let out = ''; let k = 0;
  while (k < n) {
    const set = at[k]; let j = k + 1;
    while (j < n && setsEqual(at[j], set)) j++;
    let seg = esc(chars.slice(k, j).join(''));
    for (const f of set) { const t = INLINE_TAG_WEB[f]; if (t) seg = `${t[0]}${seg}${t[1]}`; }
    out += seg; k = j;
  }
  return out;
}

const H_STYLE: Record<number, string> = {
  1: 'font-size:1.875rem;font-weight:700;line-height:1.2;margin:1.5rem 0 .75rem',
  2: 'font-size:1.5rem;font-weight:600;line-height:1.25;margin:1.25rem 0 .5rem',
  3: 'font-size:1.25rem;font-weight:600;margin:1rem 0 .5rem',
  4: 'font-size:1.1rem;font-weight:600;margin:.9rem 0 .4rem',
  5: 'font-size:1rem;font-weight:700;margin:.8rem 0 .3rem',
  6: 'font-size:.9rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#475569;margin:.8rem 0 .3rem',
};

function contentNodeToHtml(node: CanvasNode): string {
  const c = (node.content ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case 'heading': {
      const lvl = Math.min(Math.max(Number(c.level ?? 2), 1), 6);
      return `<h${lvl} style="${H_STYLE[lvl]}">${esc(String(c.text ?? ''))}</h${lvl}>`;
    }
    case 'text_block': {
      const inner = inlineRunsWeb(c as { text?: string; inline_formats?: { start: number; length: number; format: string }[] });
      return inner ? `<p style="margin:0 0 1rem;line-height:1.7">${inner}</p>` : '';
    }
    case 'bulleted_list':
    case 'numbered_list': {
      const items = Array.isArray(c.items) ? (c.items as { text?: string }[]) : [];
      const tag = node.type === 'numbered_list' ? 'ol' : 'ul';
      const listStyle = node.type === 'numbered_list' ? 'decimal' : 'disc';
      const lis = items.map((it) => `<li style="margin:.25rem 0">${esc(String(it.text ?? ''))}</li>`).join('');
      return `<${tag} style="list-style:${listStyle};padding-left:1.5rem;margin:0 0 1rem">${lis}</${tag}>`;
    }
    case 'blockquote':
      return `<blockquote style="border-left:4px solid #cbd5e1;padding-left:1rem;font-style:italic;color:#475569;margin:1rem 0">${esc(String(c.text ?? ''))}</blockquote>`;
    case 'url': {
      const href = String(c.href ?? '#'); const txt = String(c.display_text ?? href);
      return `<p style="margin:0 0 1rem"><a href="${esc(href)}" style="color:#2563eb;text-decoration:underline">${esc(txt)}</a></p>`;
    }
    case 'callout':
      return `<aside style="border-left:3px solid #3b82f6;background:#eff6ff;padding:.75rem 1rem;margin:1rem 0;border-radius:.375rem">${c.title ? `<strong>${esc(String(c.title))}</strong> ` : ''}${esc(String(c.text ?? ''))}</aside>`;
    case 'code_block':
      return `<pre style="background:#f1f5f9;padding:1rem;border-radius:.375rem;overflow:auto;margin:0 0 1rem"><code>${esc(String(c.code ?? ''))}</code></pre>`;
    case 'divider':
      return '<hr style="border:0;border-top:1px solid #e2e8f0;margin:1.5rem 0">';
    case 'caption':
      return `<p style="font-size:.875rem;color:#64748b;text-align:center;font-style:italic;margin:.5rem 0">${c.prefix ? `${esc(String(c.prefix))} ${esc(String(c.number ?? ''))}. ` : ''}${esc(String(c.text ?? ''))}</p>`;
    case 'table': {
      const headers = Array.isArray(c.headers) ? (c.headers as string[]) : [];
      const rows = Array.isArray(c.rows) ? (c.rows as unknown[][]) : [];
      const th = headers.map((h) => `<th style="border:1px solid #e2e8f0;padding:.5rem;text-align:left;background:#f8fafc">${esc(String(h))}</th>`).join('');
      const trs = rows.map((r) => `<tr>${(Array.isArray(r) ? r : []).map((cell) => `<td style="border:1px solid #e2e8f0;padding:.5rem">${esc(typeof cell === 'string' ? cell : String((cell as { text?: string })?.text ?? ''))}</td>`).join('')}</tr>`).join('');
      return `<table style="border-collapse:collapse;width:100%;margin:0 0 1rem">${th ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${trs}</tbody></table>`;
    }
    case 'image': {
      const key = String(c.storage_key ?? '');
      const alt = esc(String(c.alt_text ?? ''));
      // Only inline a resolvable src (http/data). An S3 key without a public URL is skipped (no broken img).
      if (/^(https?:|data:)/i.test(key)) return `<figure style="margin:1rem 0"><img src="${esc(key)}" alt="${alt}" style="max-width:100%;height:auto"></figure>`;
      return '';
    }
    default:
      return typeof c.text === 'string' ? `<p style="margin:0 0 1rem;line-height:1.7">${esc(c.text)}</p>` : '';
  }
}

/** Flatten a content canvas to its nodes in reading order (sections' groups, then any flat nodes). */
function contentNodes(doc: CanvasDocument): CanvasNode[] {
  const out: CanvasNode[] = [];
  for (const s of doc.sections ?? []) for (const g of s.groups ?? []) out.push(...(g.nodes ?? []));
  out.push(...(doc.nodes ?? []));
  return out;
}

/**
 * The public HTML projection stored in blocks[0].body — self-styled semantic web HTML.
 * Content has no merge fields. Starts with `<` so the marketing renderer treats it as HTML.
 */
export function docBodyFromCanvas(canvas: CanvasDocument): string {
  return contentNodes(canvas).map(contentNodeToHtml).filter(Boolean).join('\n').trim();
}

// ── Seed parsing: existing markdown/HTML body → canvas nodes ──────────────────────────────

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
  '&rdquo;': '”', '&ldquo;': '“', '&hellip;': '…', '&copy;': '©', '&reg;': '®', '&trade;': '™',
};
function decodeEntities(s: string): string {
  return s
    // numeric entities first (&#37; → %, &#x2019; → ’) so they aren't left literal and double-escaped
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d+);/g, (m, d: string) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; } })
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|rsquo|lsquo|rdquo|ldquo|hellip|copy|reg|trade);/g, (m) => ENTITIES[m] ?? m);
}

/** Downconvert the common HTML block tags to markdown-ish lines, then strip the rest. */
function htmlToMarkdownish(html: string): string {
  let s = html;
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  // Ordered lists → numbered markers, unordered → bullets (preserve ol-vs-ul; the generic
  // per-<li> pass below only catches strays outside a list).
  s = s.replace(/<\s*ol[^>]*>([\s\S]*?)<\s*\/\s*ol\s*>/gi, (_m, inner: string) =>
    '\n' + inner.replace(/<\s*li[^>]*>/gi, '\n1. ').replace(/<\s*\/li\s*>/gi, '') + '\n');
  s = s.replace(/<\s*ul[^>]*>([\s\S]*?)<\s*\/\s*ul\s*>/gi, (_m, inner: string) =>
    '\n' + inner.replace(/<\s*li[^>]*>/gi, '\n- ').replace(/<\s*\/li\s*>/gi, '') + '\n');
  s = s.replace(/<\s*li[^>]*>/gi, '\n- ');
  s = s.replace(/<\s*\/li\s*>/gi, '');
  s = s.replace(/<\s*\/(p|div|section|article)\s*>/gi, '\n\n');
  s = s.replace(/<\s*h([1-6])[^>]*>/gi, (_m, l: string) => '\n' + '#'.repeat(Number(l)) + ' ');
  s = s.replace(/<\s*\/h[1-6]\s*>/gi, '\n\n');
  s = s.replace(/<\s*\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ''); // strip remaining tags
  return decodeEntities(s);
}

// ── Inline markdown → canvas inline_formats ───────────────────────────────────────────────
//
// WHY THIS EXISTS. The seed above turns a legacy markdown body into canvas nodes, and until this
// pass it copied every line through VERBATIM. So opening one of the older guides in the Content
// Studio and saving it published literal `**SBIR**` and literal `[eligibility checklist](/…)` onto
// the public marketing site — four active pages carry 76 emphasis markers and 4 markdown links
// between them. The corruption needed no mistake by the editor: opening and saving is the whole
// job the Studio exists for.
//
// WHAT IS AND IS NOT REPRESENTABLE. `TextBlockContent.inline_formats` accepts exactly
// bold/italic/underline/superscript/subscript, so `**x**` and `*x*` round-trip properly and the
// web projection already renders them as <strong>/<em>. Two things cannot round-trip and are
// handled honestly rather than silently:
//   · LINKS have no canvas primitive (no href anywhere in the node vocabulary, which is locked
//     against every exporter). `[text](url)` becomes `text (url)` — lossy, but it keeps the
//     destination readable and puts no markup on the page.
//   · LIST ITEMS have no `inline_formats` field at all (`ListContent.items` is `{text, indent_level,
//     children}`), so emphasis inside a bullet is STRIPPED to plain text. Losing the bold is a far
//     smaller harm than printing the asterisks.
// `_underscore_` emphasis and `` `code` `` are deliberately NOT parsed: no stored body uses them,
// and every underscore in the corpus sits inside a word or a URL, where treating it as a marker
// would mangle real text.
const MD_LINK = /\[([^\]\n]+)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
const MD_EMPHASIS = /(\*\*|\*)(?=\S)([\s\S]*?\S)\1/;

/** `[text](url)` → `text (url)`. Applied before emphasis so a marker inside a label still parses. */
function flattenLinks(s: string): string {
  return s.replace(MD_LINK, (_m, label: string, url: string) => `${label} (${url})`);
}

interface Inline { text: string; formats: NonNullable<TextBlockContent['inline_formats']> }

/**
 * Strip `**bold**` / `*italic*` markers, recording each span as an inline_format offset.
 * Offsets are in CODE POINTS, matching `inlineRunsWeb`, which indexes `[...text]` — counting
 * UTF-16 units here would slide every format right of an emoji or a surrogate pair.
 */
function parseInline(raw: string): Inline {
  const src = flattenLinks(raw);
  const formats: Inline['formats'] = [];
  let out = '';
  let rest = src;
  while (rest.length > 0) {
    const m = MD_EMPHASIS.exec(rest);
    if (!m) { out += rest; break; }
    out += rest.slice(0, m.index);
    const inner = parseInline(m[2]);          // nested: `**bold with *italic* inside**`
    const start = [...out].length;
    for (const f of inner.formats) formats.push({ ...f, start: f.start + start });
    formats.push({ start, length: [...inner.text].length, format: m[1] === '**' ? 'bold' : 'italic' });
    out += inner.text;
    rest = rest.slice(m.index + m[0].length);
  }
  return { text: out, formats };
}

/** The same strip with no formats kept — for list items and headings, which cannot carry them. */
function plainInline(raw: string): string {
  return parseInline(raw).text;
}

interface Line { kind: 'heading' | 'bullet' | 'number' | 'text' | 'blank'; level?: number; text: string; }

function classify(raw: string): Line {
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) return { kind: 'blank', text: '' };
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) return { kind: 'heading', level: h[1].length, text: h[2].trim() };
  const b = line.match(/^\s*[-*+]\s+(.*)$/);
  if (b) return { kind: 'bullet', text: b[1].trim() };
  const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
  if (n) return { kind: 'number', text: n[1].trim() };
  return { kind: 'text', text: line.trim() };
}

/**
 * Parse a markdown/HTML body into a flat sequence of canvas nodes:
 *   headings → heading, consecutive bullets/numbers → list, other runs → text_block.
 * Inline `**bold**` / `*italic*` become inline_formats on a text_block; see parseInline above for
 * what links and list items do instead, and why.
 * Best-effort and lossless-enough — a one-time on-open seed the author then edits richly.
 */
export function parseBodyToNodes(body: string): CanvasNode[] {
  const src = /<[a-z!/][^>]*>/i.test(body) ? htmlToMarkdownish(body) : body;
  const lines = src.replace(/\r\n?/g, '\n').split('\n').map(classify);
  const nodes: CanvasNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    // Join FIRST, then parse: emphasis that opens on one line and closes on the next is one span
    // in the joined paragraph, and parsing per line would leave both markers stranded.
    const { text, formats } = parseInline(para.join(' '));
    nodes.push(node('text_block', formats.length ? { text, inline_formats: formats } : { text }));
    para = [];
  };
  const flushBullets = () => { if (bullets.length) { nodes.push(node('bulleted_list', { items: bullets.map((t) => ({ text: plainInline(t) })) })); bullets = []; } };
  const flushNumbers = () => { if (numbers.length) { nodes.push(node('numbered_list', { items: numbers.map((t) => ({ text: plainInline(t) })) })); numbers = []; } };
  const flushAll = () => { flushPara(); flushBullets(); flushNumbers(); };

  for (const ln of lines) {
    // HeadingContent is {level, text, numbering} — no inline_formats — so a heading strips too.
    if (ln.kind === 'heading') { flushAll(); nodes.push(node('heading', { level: Math.min(ln.level ?? 2, 6), text: plainInline(ln.text) })); continue; }
    if (ln.kind === 'bullet') { flushPara(); flushNumbers(); bullets.push(ln.text); continue; }
    if (ln.kind === 'number') { flushPara(); flushBullets(); numbers.push(ln.text); continue; }
    if (ln.kind === 'blank') { flushAll(); continue; }
    // text: a paragraph line — end any open list first
    flushBullets(); flushNumbers(); para.push(ln.text);
  }
  flushAll();
  return nodes;
}

/** Seed a starter CanvasDocument from an existing document body (markdown or HTML). */
export function canvasFromDocBody(title: string, body: string): CanvasDocument {
  const nodes = parseBodyToNodes(body || '');
  if (nodes.length === 0) nodes.push(node('text_block', { text: '' }));
  return baseDoc(title || 'Untitled', nodes);
}

/** A friendly blank canvas for a brand-new document: title heading + an empty paragraph. */
export function newContentCanvas(title: string): CanvasDocument {
  return baseDoc(title || 'Untitled', [
    node('heading', { level: 1, text: title || 'Untitled' }),
    node('text_block', { text: '' }),
  ]);
}
