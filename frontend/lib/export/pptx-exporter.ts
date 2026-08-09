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
  NodeStyle,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell as CanvasTableCell,
  CaptionContent,
  FootnoteContent,
  UrlContent,
  ShapeContent,
  ShapeKind,
  TextBoxContent,
  CalloutContent,
  CodeBlockContent,
  BlockquoteContent,
  ChartContent,
  EquationContent,
  DividerContent,
  VideoContent,
  SignatureContent,
} from '@/lib/types/canvas-document';
import { rasterizeDataUri, resolveImageDataUri, fitBox, type RasterPng } from '@/lib/export/image-raster';
import { docNodes, sectionsToNodes } from '@/lib/types/canvas-document';

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

// ─── Extended-element style plumbing (the ribbon's Shape-Format tab) ───
// Our ShapeKind → the pptxgenjs shape name; our chart_type → its chart name.
const SHAPE_MAP: Record<ShapeKind, PptxGenJS.SHAPE_NAME> = {
  rectangle: 'rect', rounded_rectangle: 'roundRect', ellipse: 'ellipse', triangle: 'triangle',
  line: 'line', arrow: 'rightArrow', star: 'star5', diamond: 'diamond', callout_bubble: 'wedgeRoundRectCallout',
};
// scatter has no shared data shape here (needs numeric X) → approximate with a line.
const CHART_MAP: Record<ChartContent['chart_type'], PptxGenJS.CHART_NAME> = {
  bar: 'bar', line: 'line', pie: 'pie', scatter: 'line', area: 'area', doughnut: 'doughnut',
};
const CHART_COLORS: string[] = ['1F4E79', '2E75B6', '9DC3E6', 'C55A11', 'ED7D31', 'FFC000', '70AD47', 'A5A5A5'];
const CALLOUT_COLORS: Record<string, { bg: string; fg: string }> = {
  info: { bg: 'EFF6FF', fg: '1D4ED8' }, warning: { bg: 'FEF3C7', fg: 'B45309' },
  tip: { bg: 'ECFDF5', fg: '047857' }, success: { bg: 'ECFDF5', fg: '047857' }, note: { bg: 'F1F5F9', fg: '475569' },
};
const SHADOW: PptxGenJS.ShadowProps = { type: 'outer', blur: 3, offset: 2, angle: 45, color: '000000', opacity: 0.35 };

/** Opacity 0..1 → pptx transparency percent (0=opaque). */
function transparencyOf(opacity?: number): number | undefined {
  if (opacity == null) return undefined;
  return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100);
}
/** node.style.fill → a pptx shape fill (color + transparency), or undefined if none. */
function fillFrom(style: NodeStyle): PptxGenJS.ShapeFillProps | undefined {
  const color = hex(style.fill?.color);
  if (!color) return undefined;
  const t = transparencyOf(style.fill?.opacity);
  return { color, ...(t != null ? { transparency: t } : {}) };
}
/** node.style.border → a pptx line spec (color/width/dash + transparency), or undefined. */
function lineFrom(style: NodeStyle): PptxGenJS.ShapeLineProps | undefined {
  const b = style.border;
  if (!b) return undefined;
  if (b.style === 'none') return { type: 'none' };
  const t = transparencyOf(b.opacity);
  const dashType = b.style === 'dashed' ? 'dash' : b.style === 'dotted' ? 'sysDot' : 'solid';
  return { color: hex(b.color) ?? INK, width: b.width ?? 1, dashType, ...(t != null ? { transparency: t } : {}) };
}
function clampRotate(deg?: number): number { return Math.max(-360, Math.min(360, deg ?? 0)); }

/**
 * Resolve a node's box. A node with an explicit `position.x/y` is FREE-PLACED
 * (absolute slide coords, does not advance the body flow — Word's "in front of /
 * behind text"); otherwise it flows at (x,y) with a measured default height.
 */
function placeBox(
  node: CanvasNode, x: number, y: number, w: number, defaultH: number, maxH: number,
): { x: number; y: number; w: number; h: number; consumed: number } {
  const p = node.position;
  if (p && (p.x != null || p.y != null)) {
    return { x: p.x ?? x, y: p.y ?? y, w: p.w ?? w, h: p.h ?? defaultH, consumed: 0 };
  }
  const h = Math.min(p?.h ?? defaultH, maxH);
  return { x, y, w: p?.w ?? w, h, consumed: h + 0.12 };
}

/** The run styling common to every primitive (bold/italic/underline/strike/highlight/align/color). */
function runStyle(style: NodeStyle, font: string, fontSize: number, fallbackColor: string): PptxGenJS.TextPropsOptions {
  const o: PptxGenJS.TextPropsOptions = { fontFace: style.family ?? font, fontSize: style.size ?? fontSize, color: hex(style.color) ?? fallbackColor };
  if (style.weight === 'bold') o.bold = true;
  if (style.style === 'italic') o.italic = true;
  if (style.underline) o.underline = { style: 'sng' } as PptxGenJS.TextPropsOptions['underline'];
  if (style.strikethrough) o.strike = 'sngStrike';
  const hl = hex(style.highlight); if (hl) o.highlight = hl;
  if (style.alignment) o.align = style.alignment;
  return o;
}

export async function exportToPptx(
  doc: CanvasDocument,
  variables: Record<string, string> = {},
): Promise<Buffer> {
  const { canvas } = doc;
  // Flat node view (v2 sections flattened) for the raster pre-pass, deck accent,
  // and per-slide TOC.
  const nodes = docNodes(doc);
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
      const key = await resolveImageDataUri((n.content as { storage_key?: string })?.storage_key);
      raster.set(n, await rasterizeDataUri(key));
    }),
  );

  // Deck accent = the first heading's color (falls back to a slide navy).
  const firstHeadingColor = nodes.find((n) => n.type === 'heading')?.style?.color;
  const accent = hex(firstHeadingColor) ?? DEFAULT_ACCENT;

  // v2: one section per slide (break intent is implicit — each section is a
  // discrete slide). v1: split the flat node list on page_break as before.
  const slideGroups = doc.sections && doc.sections.length
    ? doc.sections.map((s) => sectionsToNodes([s]))
    : splitIntoSlides(nodes);
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
        slide.addText(sub(c.text), { x, y, w, h, ...runStyle(node.style, font, fontSize, INK), valign: 'top', wrap: true });
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
    case 'shape': {
      const c = node.content as ShapeContent;
      const b = placeBox(node, x, y, w, 1.2, maxH);
      const shapeName = SHAPE_MAP[c.shape] ?? 'rect';
      const geom: PptxGenJS.ShapeProps = {
        x: b.x, y: b.y, w: b.w, h: b.h,
        fill: fillFrom(node.style) ?? { color: hex(node.style.color) ?? 'DCE6F1' },
        line: lineFrom(node.style) ?? { type: 'none' },
        ...(node.style.rotation ? { rotate: clampRotate(node.style.rotation) } : {}),
        ...(c.shape === 'rounded_rectangle' ? { rectRadius: 0.1 } : {}),
        ...(node.style.shadow ? { shadow: SHADOW } : {}),
      };
      if (c.text) {
        slide.addText(sub(c.text), { ...geom, shape: shapeName, align: 'center', valign: 'middle', fontFace: font, fontSize, color: nodeColor ?? INK, wrap: true });
      } else {
        slide.addShape(shapeName, geom);
      }
      return b.consumed;
    }
    case 'text_box': {
      const c = node.content as TextBoxContent;
      const lines = Math.max(1, Math.ceil(sub(c.text).length / 60));
      const b = placeBox(node, x, y, w, Math.min(Math.max(0.4, lines * 0.3 + 0.15), maxH), maxH);
      slide.addText(sub(c.text), {
        x: b.x, y: b.y, w: b.w, h: b.h,
        ...runStyle(node.style, font, fontSize, INK),
        fill: fillFrom(node.style), line: lineFrom(node.style),
        ...(node.style.rotation ? { rotate: clampRotate(node.style.rotation) } : {}),
        ...(node.style.shadow ? { shadow: SHADOW } : {}),
        valign: 'top', wrap: true, isTextBox: true, margin: 6,
      });
      return b.consumed;
    }
    case 'callout': {
      const c = node.content as CalloutContent;
      const pal = CALLOUT_COLORS[c.variant] ?? CALLOUT_COLORS.note;
      const lines = Math.max(1, Math.ceil(sub(c.text).length / 60)) + (c.title ? 1 : 0);
      const b = placeBox(node, x, y, w, Math.min(Math.max(0.6, lines * 0.3 + 0.2), maxH), maxH);
      slide.addText([
        ...(c.title ? [{ text: sub(c.title), options: { bold: true, color: pal.fg, fontFace: font, fontSize, breakLine: true } }] : []),
        { text: sub(c.text), options: { color: INK, fontFace: font, fontSize } },
      ], {
        x: b.x, y: b.y, w: b.w, h: b.h,
        shape: 'roundRect', rectRadius: 0.05, fill: { color: pal.bg }, line: { color: pal.fg, width: 1 },
        align: 'left', valign: 'top', wrap: true, margin: 8,
      });
      return b.consumed;
    }
    case 'code_block': {
      const c = node.content as CodeBlockContent;
      const lines = c.code.split('\n').length;
      const b = placeBox(node, x, y, w, Math.min(Math.max(0.4, lines * 0.24 + 0.2), maxH), maxH);
      slide.addText(c.code || ' ', {
        x: b.x, y: b.y, w: b.w, h: b.h,
        fontFace: 'Courier New', fontSize: Math.max(9, fontSize - 2), color: 'E2E8F0',
        fill: { color: '1E293B' }, align: 'left', valign: 'top', wrap: true, margin: 8, isTextBox: true,
      });
      return b.consumed;
    }
    case 'blockquote': {
      const c = node.content as BlockquoteContent;
      const lines = Math.max(1, Math.ceil(sub(c.text).length / 65));
      const b = placeBox(node, x, y, w, Math.min(Math.max(0.5, lines * 0.32 + 0.2), maxH), maxH);
      slide.addShape('rect', { x: b.x, y: b.y, w: 0.06, h: b.h, fill: { color: accent }, line: { type: 'none' } });
      slide.addText([
        { text: sub(c.text), options: { italic: true, color: INK, fontFace: font, fontSize, breakLine: true } },
        ...(c.cite ? [{ text: `— ${sub(c.cite)}`, options: { color: MUTED, fontFace: font, fontSize: Math.max(9, fontSize - 2) } }] : []),
      ], { x: b.x + 0.2, y: b.y, w: b.w - 0.2, h: b.h, align: 'left', valign: 'top', wrap: true });
      return b.consumed;
    }
    case 'chart': {
      const c = node.content as ChartContent;
      const type = CHART_MAP[c.chart_type] ?? 'bar';
      const isPie = type === 'pie' || type === 'doughnut';
      const b = placeBox(node, x, y, w, Math.min(Math.max(2.4, maxH * 0.7), maxH), maxH);
      const data = isPie
        ? [{ name: c.series[0]?.name ?? 'Series', labels: c.categories, values: c.series[0]?.data ?? [] }]
        : c.series.map((s) => ({ name: s.name, labels: c.categories, values: s.data }));
      const colors = c.series.map((s) => hex(s.color)).filter((v): v is string => !!v);
      slide.addChart(type, data, {
        x: b.x, y: b.y, w: b.w, h: b.h,
        showTitle: !!c.title, ...(c.title ? { title: sub(c.title) } : {}),
        showLegend: c.series.length > 1 || isPie, legendPos: 'b',
        showValue: false, chartColors: colors.length ? colors : CHART_COLORS,
        catAxisLabelFontFace: font, valAxisLabelFontFace: font, dataLabelFontFace: font,
        ...(isPie ? { showPercent: true } : {}),
        ...(type === 'doughnut' ? { holeSize: 55 } : {}),
      });
      return b.consumed;
    }
    case 'equation': {
      const c = node.content as EquationContent;
      const tex = c.latex ?? c.mathml ?? '';
      const b = placeBox(node, x, y, w, 0.5, maxH);
      slide.addText(tex || '(equation)', {
        x: b.x, y: b.y, w: b.w, h: b.h, fontFace: 'Cambria Math', fontSize: fontSize + 1,
        italic: true, color: INK, align: c.display === false ? 'left' : 'center', valign: 'middle',
      });
      return b.consumed;
    }
    case 'divider': {
      const c = node.content as DividerContent;
      const dash = c.line_style === 'dashed' ? 'dash' : c.line_style === 'dotted' ? 'sysDot' : 'solid';
      slide.addShape('line', { x, y: y + 0.15, w, h: 0, line: { color: hex(c.color) ?? 'CBD5E1', width: c.thickness ?? 1, dashType: dash } });
      return 0.35;
    }
    case 'video': {
      const c = node.content as VideoContent;
      const b = placeBox(node, x, y, w, Math.min(2.4, maxH), maxH);
      const label = c.caption ?? c.url ?? 'Video';
      slide.addShape('rect', { x: b.x, y: b.y, w: b.w, h: b.h, fill: { color: '0F172A' }, line: { type: 'none' } });
      slide.addText('▶', { x: b.x, y: b.y, w: b.w, h: b.h - 0.3, align: 'center', valign: 'middle', fontSize: 40, color: 'FFFFFF' });
      slide.addText(sub(label), { x: b.x, y: b.y + b.h - 0.35, w: b.w, h: 0.3, align: 'center', valign: 'middle', fontSize: Math.max(9, fontSize - 3), color: 'E2E8F0', ...(c.url ? { hyperlink: { url: c.url } } : {}) });
      return b.consumed;
    }
    case 'signature': {
      const c = node.content as SignatureContent;
      const b = placeBox(node, x, y, w, 0.9, maxH);
      const lineY = b.y + 0.5;
      const sigW = Math.min(3.2, b.w);
      if (c.signed && c.signer_name) {
        slide.addText(sub(c.signer_name), { x: b.x, y: lineY - 0.34, w: sigW, h: 0.32, fontFace: 'Segoe Script', fontSize: fontSize + 2, italic: true, color: '1E3A8A', valign: 'bottom' });
      }
      slide.addShape('line', { x: b.x, y: lineY, w: sigW, h: 0, line: { color: INK, width: 1 } });
      slide.addText(sub(c.label ?? 'Signature') + (c.signed_at ? `   ·   ${c.signed_at}` : ''), { x: b.x, y: lineY + 0.03, w: b.w, h: 0.28, fontFace: font, fontSize: Math.max(9, fontSize - 2), color: MUTED });
      return b.consumed;
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
