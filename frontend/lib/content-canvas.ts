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
  type CanvasDocument, type CanvasNode, type CanvasSection,
} from '@/lib/types/canvas-document';
import { renderCanvasBodyHtml } from '@/lib/export/canvas-html';

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

/** The public HTML projection stored in blocks[0].body. Content has no merge fields. */
export function docBodyFromCanvas(canvas: CanvasDocument): string {
  return renderCanvasBodyHtml(canvas, {}).trim();
}

// ── Seed parsing: existing markdown/HTML body → canvas nodes ──────────────────────────────

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};
function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Downconvert the common HTML block tags to markdown-ish lines, then strip the rest. */
function htmlToMarkdownish(html: string): string {
  let s = html;
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/(p|div|section|article)\s*>/gi, '\n\n');
  s = s.replace(/<\s*h([1-6])[^>]*>/gi, (_m, l: string) => '\n' + '#'.repeat(Number(l)) + ' ');
  s = s.replace(/<\s*\/h[1-6]\s*>/gi, '\n\n');
  s = s.replace(/<\s*li[^>]*>/gi, '\n- ');
  s = s.replace(/<\s*\/li\s*>/gi, '');
  s = s.replace(/<\s*\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ''); // strip remaining tags
  return decodeEntities(s);
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
 * Best-effort and lossless-enough — a one-time on-open seed the author then edits richly.
 */
export function parseBodyToNodes(body: string): CanvasNode[] {
  const src = /<[a-z!/][^>]*>/i.test(body) ? htmlToMarkdownish(body) : body;
  const lines = src.replace(/\r\n?/g, '\n').split('\n').map(classify);
  const nodes: CanvasNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];
  const flushPara = () => { if (para.length) { nodes.push(node('text_block', { text: para.join(' ') })); para = []; } };
  const flushBullets = () => { if (bullets.length) { nodes.push(node('bulleted_list', { items: bullets.map((t) => ({ text: t })) })); bullets = []; } };
  const flushNumbers = () => { if (numbers.length) { nodes.push(node('numbered_list', { items: numbers.map((t) => ({ text: t })) })); numbers = []; } };
  const flushAll = () => { flushPara(); flushBullets(); flushNumbers(); };

  for (const ln of lines) {
    if (ln.kind === 'heading') { flushAll(); nodes.push(node('heading', { level: Math.min(ln.level ?? 2, 4), text: ln.text })); continue; }
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
