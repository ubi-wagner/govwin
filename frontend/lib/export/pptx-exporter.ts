/**
 * Canvas JSON → PowerPoint (.pptx) export engine.
 *
 * Walks the CanvasDocument node list and produces a designed .pptx presentation:
 * page_break nodes are slide boundaries; the first heading is the slide title.
 * The first slide renders as a title hero (accent band); the rest get an accent
 * side-bar, a colored title with an accent rule, styled bullets, and — the key
 * fidelity fix — REAL embedded images (generated SVG figures are rasterized to
 * PNG via sharp and placed to their true aspect ratio, with captions), instead
 * of a "[Image: …]" text stub.
 *
 * Uses `pptxgenjs` for Open XML Presentation generation.
 */

import PptxGenJS from 'pptxgenjs';
import type {
  CanvasDocument,
  CanvasNode,
  CanvasRules,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell as CanvasTableCell,
  CaptionContent,
  FootnoteContent,
  UrlContent,
} from '@/lib/types/canvas-document';
import { rasterizeDataUri, fitBox, type RasterPng } from '@/lib/export/image-raster';

// ─── Layout constants (inches) ────────────────────────────────────────
const SLIDE_LAYOUTS: Record<string, { w: number; h: number }> = {
  slide_16_9: { w: 13.33, h: 7.5 },
  slide_4_3: { w: 10, h: 7.5 },
  letter: { w: 10, h: 7.5 },
  custom: { w: 10, h: 7.5 },
};

const MARGIN = 0.6;
const TITLE_Y = 0.42;
const TITLE_H = 0.9;
const BODY_TOP = 1.7;
const SIDEBAR_W = 0.16;
const MAX_FIG_W = 6.8; // figures never span the whole 13.3" slide

const DEFAULT_ACCENT = '1F4E79';
const INK = '1E293B';   // body text
const MUTED = '64748B'; // captions / footer / subtitle

/** Strip a leading '#'; return null for empty/undefined. */
function hex(c?: string | null): string | null {
  if (!c) return null;
  const h = c.replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : null;
}

export async function exportToPptx(
  doc: CanvasDocument,
  variables: Record<string, string> = {},
): Promise<Buffer> {
  const { canvas, nodes } = doc;
  const sub = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => variables[k] ?? `{${k}}`);
  const dims = SLIDE_LAYOUTS[canvas.format] ?? SLIDE_LAYOUTS.slide_16_9;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CUSTOM', width: dims.w, height: dims.h });
  pptx.layout = 'CUSTOM';
  pptx.title = doc.metadata.title;
  const RECT = pptx.ShapeType.rect;

  // Pre-rasterize every image node once (parallel) so slide building is sync-simple.
  const raster = new Map<CanvasNode, RasterPng | null>();
  await Promise.all(
    nodes.filter((n) => n.type === 'image').map(async (n) => {
      const key = (n.content as { storage_key?: string })?.storage_key;
      raster.set(n, await rasterizeDataUri(key));
    }),
  );

  // Deck accent = the first heading's color (falls back to a slide navy).
  const firstHeadingColor = nodes.find((n) => n.type === 'heading')?.style?.color;
  const accent = hex(firstHeadingColor) ?? DEFAULT_ACCENT;

  const slideGroups = splitIntoSlides(nodes);
  const bodyW = dims.w - 2 * MARGIN;

  let slideIndex = 0;
  for (const group of slideGroups) {
    slideIndex++;
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    const titleNode = group.find((n) => n.type === 'heading');
    const bodyNodes = titleNode ? group.filter((n) => n !== titleNode) : group;
    const isTitleSlide =
      slideIndex === 1 &&
      !!titleNode &&
      (titleNode.content as HeadingContent).level === 1 &&
      bodyNodes.every((n) => n.type === 'text_block');

    if (isTitleSlide && titleNode) {
      renderTitleSlide(slide, RECT, titleNode, bodyNodes, canvas, accent, dims, bodyW, sub);
      continue;
    }

    // ── content slide: accent side-bar + title + rule ──
    slide.addShape(RECT, { x: 0, y: 0, w: SIDEBAR_W, h: dims.h, fill: { color: accent }, line: { type: 'none' } });

    if (titleNode) {
      const hc = titleNode.content as HeadingContent;
      const titleText = sub((hc.numbering ? `${hc.numbering} ` : '') + hc.text);
      slide.addText(titleText, {
        x: MARGIN, y: TITLE_Y, w: bodyW, h: TITLE_H,
        fontSize: contentTitleSize(hc.level), fontFace: canvas.font_default.family,
        bold: true, color: hex(titleNode.style?.color) ?? accent, valign: 'bottom',
      });
      slide.addShape(RECT, { x: MARGIN + 0.02, y: TITLE_Y + TITLE_H + 0.04, w: 2.4, h: 0.055, fill: { color: accent }, line: { type: 'none' } });
    }

    // ── body flow ──
    let curY = BODY_TOP;
    const bodyBottom = dims.h - 0.5;
    for (const node of bodyNodes) {
      const added = addNodeToSlide(slide, node, canvas, MARGIN, curY, bodyW, Math.max(0.3, bodyBottom - curY), sub, nodes, raster, accent);
      curY += added;
    }

    // subtle slide number, bottom-right
    slide.addText(`${slideIndex}`, { x: dims.w - 1.0, y: dims.h - 0.45, w: 0.6, h: 0.3, fontSize: 10, fontFace: canvas.font_default.family, color: MUTED, align: 'right' });

    const notes = collectNotes(group);
    if (notes) slide.addNotes(notes);
  }

  const result = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(result as ArrayBuffer);
}

// ─── Title (hero) slide ────────────────────────────────────────────────
function renderTitleSlide(
  slide: PptxGenJS.Slide,
  rect: PptxGenJS.ShapeType,
  titleNode: CanvasNode,
  bodyNodes: CanvasNode[],
  canvas: CanvasRules,
  accent: string,
  dims: { w: number; h: number },
  bodyW: number,
  sub: (t: string) => string,
): void {
  // accent header band
  slide.addShape(rect, { x: 0, y: 0, w: dims.w, h: 2.5, fill: { color: accent }, line: { type: 'none' } });
  const hc = titleNode.content as HeadingContent;
  slide.addText(sub(hc.text), {
    x: MARGIN, y: 0.7, w: bodyW, h: 1.2,
    fontSize: 40, fontFace: canvas.font_default.family, bold: true, color: 'FFFFFF', valign: 'middle',
  });
  // subtitle lines below the band
  let y = 3.0;
  for (const n of bodyNodes) {
    if (n.type !== 'text_block') continue;
    const c = n.content as TextBlockContent;
    if (!c.text) continue;
    const first = y === 3.0;
    slide.addText(sub(c.text), {
      x: MARGIN, y, w: bodyW, h: 0.5,
      fontSize: first ? 22 : 16, fontFace: canvas.font_default.family,
      color: first ? INK : MUTED, bold: first, valign: 'top', wrap: true,
    });
    y += first ? 0.7 : 0.45;
  }
  // accent footer rule
  slide.addShape((slide as unknown as { _shapeType?: never }, 'rect') as unknown as PptxGenJS.ShapeType, { x: 0, y: dims.h - 0.28, w: dims.w, h: 0.28, fill: { color: accent }, line: { type: 'none' } } as PptxGenJS.ShapeProps);
}

// ─── Helpers ───────────────────────────────────────────────────────────
function splitIntoSlides(nodes: CanvasNode[]): CanvasNode[][] {
  const slides: CanvasNode[][] = [];
  let current: CanvasNode[] = [];
  for (const node of nodes) {
    if (node.type === 'page_break') {
      if (current.length > 0) slides.push(current);
      current = [];
    } else current.push(node);
  }
  if (current.length > 0) slides.push(current);
  if (slides.length === 0) slides.push([]);
  return slides;
}

function contentTitleSize(level: 1 | 2 | 3): number {
  switch (level) {
    case 1: return 30;
    case 2: return 24;
    case 3: return 20;
    default: return 26;
  }
}

function cellText(cell: string | CanvasTableCell): string {
  return typeof cell === 'string' ? cell : cell.text;
}
function cellBold(cell: string | CanvasTableCell): boolean {
  return typeof cell === 'string' ? false : !!cell.style?.bold;
}
function cellBg(cell: string | CanvasTableCell): string | undefined {
  return typeof cell === 'string' ? undefined : hex(cell.style?.bg) ?? undefined;
}

/** Add a body node; returns estimated vertical inches consumed. */
function addNodeToSlide(
  slide: PptxGenJS.Slide,
  node: CanvasNode,
  canvas: CanvasRules,
  x: number,
  y: number,
  w: number,
  maxH: number,
  sub: (t: string) => string,
  allNodes: CanvasNode[],
  raster: Map<CanvasNode, RasterPng | null>,
  accent: string,
): number {
  const font = node.style.family ?? canvas.font_default.family;
  const fontSize = node.style.size ?? canvas.font_default.size;
  const nodeColor = hex(node.style.color);

  switch (node.type) {
    case 'heading': {
      const c = node.content as HeadingContent;
      const text = sub((c.numbering ? `${c.numbering} ` : '') + c.text);
      slide.addText(text, { x, y, w, h: 0.5, fontSize: contentTitleSize(c.level), fontFace: font, bold: true, color: nodeColor ?? accent });
      return 0.6;
    }
    case 'text_block': {
      const c = node.content as TextBlockContent;
      if (!c.text) return 0.1;
      const lineCount = Math.ceil(sub(c.text).length / 95);
      const h = Math.min(Math.max(0.35, lineCount * 0.28), maxH);
      const formats = c.inline_formats ?? [];
      if (formats.length === 0) {
        slide.addText(sub(c.text), { x, y, w, h, fontSize, fontFace: font, color: nodeColor ?? INK, valign: 'top', wrap: true });
      } else {
        const boundaries = new Set<number>([0, c.text.length]);
        for (const f of formats) { boundaries.add(f.start); boundaries.add(f.start + f.length); }
        const points = [...boundaries].sort((a, b) => a - b);
        const runs: PptxGenJS.TextProps[] = [];
        for (let i = 0; i < points.length - 1; i++) {
          const s = points[i], e = points[i + 1];
          if (s >= e) continue;
          const active = formats.filter((f) => f.start <= s && f.start + f.length >= e);
          const opts: PptxGenJS.TextPropsOptions = { fontSize, fontFace: font, color: nodeColor ?? INK };
          for (const f of active) {
            if (f.format === 'bold') opts.bold = true;
            else if (f.format === 'italic') opts.italic = true;
            else if (f.format === 'underline') opts.underline = { style: 'sng' } as PptxGenJS.TextPropsOptions['underline'];
            else if (f.format === 'superscript') opts.superscript = true;
            else if (f.format === 'subscript') opts.subscript = true;
          }
          runs.push({ text: sub(c.text.slice(s, e)), options: opts });
        }
        slide.addText(runs, { x, y, w, h, valign: 'top', wrap: true });
      }
      return h + 0.12;
    }
    case 'bulleted_list':
    case 'numbered_list': {
      const c = node.content as ListContent;
      const isBulleted = node.type === 'bulleted_list';
      const items: PptxGenJS.TextProps[] = c.items.map((item, idx) => ({
        text: sub(item.text),
        options: {
          fontSize, fontFace: font, color: INK,
          bullet: isBulleted ? { indent: 18 } : { type: 'number' as const, numberStartAt: idx === 0 ? 1 : undefined, indent: 18 },
          indentLevel: item.indent_level ?? 0,
          paraSpaceAfter: 8, breakLine: true,
        },
      }));
      const h = Math.min(Math.max(0.4, c.items.length * 0.42), maxH);
      slide.addText(items, { x, y, w, h, valign: 'top', lineSpacingMultiple: 1.05 });
      return h + 0.12;
    }
    case 'table': {
      const c = node.content as TableContent;
      const headerRow: PptxGenJS.TableCell[] = c.headers.map((hh) => ({
        text: sub(cellText(hh)),
        options: { bold: true, color: 'FFFFFF', fill: { color: accent }, border: { type: 'solid' as const, pt: 0.5, color: 'FFFFFF' }, fontSize: Math.max(10, fontSize - 4), fontFace: font, align: 'left' as const, valign: 'middle' as const },
      }));
      const dataRows: PptxGenJS.TableRow[] = c.rows.map((row, ri) =>
        row.map((cell) => ({
          text: sub(cellText(cell)),
          options: { bold: cellBold(cell), fill: { color: cellBg(cell) ?? (ri % 2 ? 'F1F5F9' : 'FFFFFF') }, border: { type: 'solid' as const, pt: 0.5, color: 'E2E8F0' }, fontSize: Math.max(10, fontSize - 4), fontFace: font, color: INK, valign: 'middle' as const },
        })),
      );
      const colCount = c.headers.length || (c.rows[0]?.length ?? 1);
      const rowCount = 1 + c.rows.length;
      const h = Math.min(Math.max(0.5, rowCount * 0.36), maxH);
      slide.addTable([headerRow, ...dataRows], { x, y, w, h, colW: w / colCount, fontSize: Math.max(10, fontSize - 4), fontFace: font, valign: 'middle' });
      return h + 0.2;
    }
    case 'image': {
      const r = raster.get(node);
      const alt = (node.content as { alt_text?: string })?.alt_text ?? 'image';
      const capText = (node.content as { caption?: string })?.caption;
      if (!r) {
        slide.addText(`[Image: ${alt}]`, { x, y, w, h: 0.4, fontSize: fontSize - 2, fontFace: font, italic: true, color: '999999', align: 'center' });
        return 0.45;
      }
      const box = fitBox(r.width, r.height, Math.min(w, MAX_FIG_W), Math.max(1.2, maxH - (capText ? 0.35 : 0)));
      const cx = x + (w - box.w) / 2; // center horizontally
      slide.addImage({ data: r.dataUri, x: cx, y, w: box.w, h: box.h });
      let consumed = box.h + 0.1;
      if (capText) {
        slide.addText(sub(capText), { x, y: y + box.h + 0.05, w, h: 0.3, fontSize: Math.max(9, fontSize - 5), fontFace: font, italic: true, color: MUTED, align: 'center' });
        consumed += 0.35;
      }
      return consumed;
    }
    case 'caption': {
      const c = node.content as CaptionContent;
      slide.addText(sub(`${c.prefix} ${c.number}: ${c.text}`), { x, y, w, h: 0.3, fontSize: Math.max(9, fontSize - 4), fontFace: font, italic: true, color: MUTED, align: 'center' });
      return 0.35;
    }
    case 'footnote': {
      const c = node.content as FootnoteContent;
      slide.addText([
        { text: c.marker, options: { superscript: true, fontSize: fontSize - 4, fontFace: font } },
        { text: sub(` ${c.text}`), options: { fontSize: fontSize - 4, fontFace: font, color: MUTED } },
      ], { x, y, w, h: 0.3 });
      return 0.35;
    }
    case 'url': {
      const c = node.content as UrlContent;
      slide.addText([{ text: sub(c.display_text), options: { fontSize, fontFace: font, color: '0066CC', hyperlink: { url: c.href } } }], { x, y, w, h: 0.35 });
      return 0.4;
    }
    case 'spacer':
      return 0.3;
    case 'toc': {
      const headings = allNodes.filter((n) => n.type === 'heading').map((n) => n.content as HeadingContent);
      const tocText = headings.map((hh) => `${'  '.repeat(hh.level - 1)}${hh.numbering ? `${hh.numbering} ` : ''}${hh.text}`).join('\n');
      const h = Math.min(Math.max(0.4, headings.length * 0.3), maxH);
      slide.addText(sub(tocText) || '(No headings)', { x, y, w, h, fontSize: fontSize - 2, fontFace: font, color: INK, valign: 'top', wrap: true });
      return h + 0.1;
    }
    default:
      return 0;
  }
}

function collectNotes(nodes: CanvasNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) for (const edit of node.history) if (edit.comment) parts.push(`[${edit.actor_name}] ${edit.comment}`);
  return parts.join('\n');
}
