/**
 * Canvas JSON → PowerPoint (.pptx) export engine.
 *
 * Walks the CanvasDocument node list and produces a .pptx presentation.
 * Uses page_break nodes as slide boundaries. Headings become slide
 * titles; other nodes become body content.
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

// ─── Layout constants (inches) ────────────────────────────────────────

const SLIDE_LAYOUTS: Record<string, { w: number; h: number }> = {
  slide_16_9: { w: 13.33, h: 7.5 },
  slide_4_3: { w: 10, h: 7.5 },
  letter: { w: 10, h: 7.5 },
  custom: { w: 10, h: 7.5 },
};

const TITLE_ZONE = { x: 0.5, y: 0.3, h: 1.0 };
const BODY_ZONE = { x: 0.5, y: 1.5 };
const FOOTER_ZONE_H = 0.4;

/**
 * Convert a CanvasDocument to a .pptx Buffer suitable for download.
 */
export async function exportToPptx(
  doc: CanvasDocument,
  variables: Record<string, string> = {},
): Promise<Buffer> {
  const { canvas, nodes } = doc;

  const sub = (t: string) =>
    t.replace(/\{(\w+)\}/g, (_, k: string) => variables[k] ?? `{${k}}`);

  const dims = SLIDE_LAYOUTS[canvas.format] ?? SLIDE_LAYOUTS.slide_16_9;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CUSTOM', width: dims.w, height: dims.h });
  pptx.layout = 'CUSTOM';
  pptx.title = doc.metadata.title;

  // Split nodes into slides at page_break boundaries
  const slideGroups = splitIntoSlides(nodes);

  let slideIndex = 0;
  for (const group of slideGroups) {
    slideIndex++;
    const slide = pptx.addSlide();

    const bodyW = dims.w - 1.0; // 0.5 margin each side
    const bodyMaxH = dims.h - BODY_ZONE.y - (canvas.footer ? FOOTER_ZONE_H + 0.3 : 0.3);

    // Find the first heading to use as title
    const titleNode = group.find((n) => n.type === 'heading');
    const bodyNodes = titleNode ? group.filter((n) => n !== titleNode) : group;

    // Add title
    if (titleNode) {
      const hc = titleNode.content as HeadingContent;
      const titleText = (hc.numbering ? `${hc.numbering} ` : '') + hc.text;
      slide.addText(titleText, {
        x: TITLE_ZONE.x,
        y: TITLE_ZONE.y,
        w: bodyW,
        h: TITLE_ZONE.h,
        fontSize: titleFontSize(hc.level),
        fontFace: canvas.font_default.family,
        bold: true,
        color: '333333',
        valign: 'bottom',
      });
    }

    // Track vertical position for body content
    let curY = BODY_ZONE.y;

    for (const node of bodyNodes) {
      const added = addNodeToSlide(slide, node, canvas, BODY_ZONE.x, curY, bodyW, bodyMaxH - (curY - BODY_ZONE.y), sub);
      curY += added;
    }

    // Footer with slide number
    if (canvas.footer) {
      const footerText = sub(canvas.footer.template)
        .replace('{n}', String(slideIndex))
        .replace('{N}', String(slideGroups.length));

      slide.addText(footerText, {
        x: 0.5,
        y: dims.h - FOOTER_ZONE_H - 0.1,
        w: bodyW,
        h: FOOTER_ZONE_H,
        fontSize: canvas.footer.font.size,
        fontFace: canvas.footer.font.family,
        color: '888888',
        align: 'center',
        valign: 'bottom',
      });
    }

    // Speaker notes from provenance comments
    const notes = collectNotes(group);
    if (notes) {
      slide.addNotes(notes);
    }
  }

  // Write to nodebuffer
  const result = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(result as ArrayBuffer);
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Split flat node list into slide groups, breaking on page_break nodes. */
function splitIntoSlides(nodes: CanvasNode[]): CanvasNode[][] {
  const slides: CanvasNode[][] = [];
  let current: CanvasNode[] = [];

  for (const node of nodes) {
    if (node.type === 'page_break') {
      if (current.length > 0) {
        slides.push(current);
      }
      current = [];
    } else {
      current.push(node);
    }
  }

  if (current.length > 0) {
    slides.push(current);
  }

  // Ensure at least one slide
  if (slides.length === 0) {
    slides.push([]);
  }

  return slides;
}

/** Map heading level to font size. */
function titleFontSize(level: 1 | 2 | 3): number {
  switch (level) {
    case 1: return 28;
    case 2: return 24;
    case 3: return 20;
    default: return 24;
  }
}

/** Get the text value from a TableCell or string. */
function cellText(cell: string | CanvasTableCell): string {
  return typeof cell === 'string' ? cell : cell.text;
}

/**
 * Add a single canvas node to the slide. Returns the estimated
 * vertical height consumed (inches).
 */
function addNodeToSlide(
  slide: PptxGenJS.Slide,
  node: CanvasNode,
  canvas: CanvasRules,
  x: number,
  y: number,
  w: number,
  maxH: number,
  sub: (t: string) => string,
): number {
  const font = node.style.family ?? canvas.font_default.family;
  const fontSize = node.style.size ?? canvas.font_default.size;

  switch (node.type) {
    case 'heading': {
      const c = node.content as HeadingContent;
      const text = (c.numbering ? `${c.numbering} ` : '') + c.text;
      const size = titleFontSize(c.level);
      slide.addText(text, {
        x, y, w, h: 0.6,
        fontSize: size,
        fontFace: font,
        bold: true,
        color: '333333',
      });
      return 0.7;
    }

    case 'text_block': {
      const c = node.content as TextBlockContent;
      if (!c.text) return 0.1;
      const lineCount = Math.ceil(c.text.length / 80);
      const h = Math.min(Math.max(0.4, lineCount * 0.3), maxH);
      slide.addText(c.text, {
        x, y, w, h,
        fontSize,
        fontFace: font,
        color: '444444',
        valign: 'top',
        wrap: true,
      });
      return h + 0.1;
    }

    case 'bulleted_list':
    case 'numbered_list': {
      const c = node.content as ListContent;
      const isBulleted = node.type === 'bulleted_list';
      const textItems: PptxGenJS.TextProps[] = c.items.map((item, idx) => ({
        text: item.text,
        options: {
          fontSize,
          fontFace: font,
          color: '444444',
          bullet: isBulleted
            ? true
            : { type: 'number' as const, numberStartAt: idx === 0 ? 1 : undefined },
          indentLevel: item.indent_level ?? 0,
          breakLine: true,
        },
      }));
      const h = Math.min(Math.max(0.4, c.items.length * 0.35), maxH);
      slide.addText(textItems, {
        x, y, w, h,
        valign: 'top',
      });
      return h + 0.1;
    }

    case 'table': {
      const c = node.content as TableContent;
      const headerRow: PptxGenJS.TableCell[] = c.headers.map((h) => ({
        text: cellText(h),
        options: {
          bold: true,
          fill: { color: 'E8E8E8' },
          border: { type: 'solid' as const, pt: 0.5, color: 'BBBBBB' },
          fontSize: fontSize - 2,
          fontFace: font,
        },
      }));

      const dataRows: PptxGenJS.TableRow[] = c.rows.map((row) =>
        row.map((cell) => ({
          text: cellText(cell),
          options: {
            border: { type: 'solid' as const, pt: 0.5, color: 'CCCCCC' },
            fontSize: fontSize - 2,
            fontFace: font,
          },
        })),
      );

      const colCount = c.headers.length || (c.rows[0]?.length ?? 1);
      const colW = w / colCount;
      const rowCount = 1 + c.rows.length;
      const h = Math.min(Math.max(0.5, rowCount * 0.35), maxH);

      slide.addTable([headerRow, ...dataRows], {
        x, y, w, h,
        colW,
        border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
        fontSize: fontSize - 2,
        fontFace: font,
      });
      return h + 0.15;
    }

    case 'caption': {
      const c = node.content as CaptionContent;
      slide.addText(`${c.prefix} ${c.number}: ${c.text}`, {
        x, y, w, h: 0.35,
        fontSize: fontSize - 2,
        fontFace: font,
        italic: true,
        color: '666666',
        align: 'center',
      });
      return 0.4;
    }

    case 'footnote': {
      const c = node.content as FootnoteContent;
      slide.addText([
        { text: c.marker, options: { superscript: true, fontSize: fontSize - 4, fontFace: font } },
        { text: ` ${c.text}`, options: { fontSize: fontSize - 4, fontFace: font, color: '666666' } },
      ], {
        x, y, w, h: 0.3,
      });
      return 0.35;
    }

    case 'url': {
      const c = node.content as UrlContent;
      slide.addText([
        {
          text: c.display_text,
          options: {
            fontSize,
            fontFace: font,
            color: '0066CC',
            hyperlink: { url: c.href },
          },
        },
      ], {
        x, y, w, h: 0.35,
      });
      return 0.4;
    }

    case 'image': {
      const alt = (node.content as { alt_text?: string })?.alt_text ?? 'image';
      slide.addText(`[Image: ${alt}]`, {
        x, y, w, h: 0.4,
        fontSize: fontSize - 2,
        fontFace: font,
        italic: true,
        color: '999999',
        align: 'center',
      });
      return 0.45;
    }

    case 'spacer':
      return 0.3;

    case 'toc':
      slide.addText('[Table of Contents]', {
        x, y, w, h: 0.35,
        fontSize: fontSize - 2,
        fontFace: font,
        italic: true,
        color: '999999',
      });
      return 0.4;

    default:
      return 0;
  }
}

/**
 * Collect speaker notes from provenance comments in a slide's nodes.
 * Uses each node's history entries that have a comment.
 */
function collectNotes(nodes: CanvasNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    for (const edit of node.history) {
      if (edit.comment) {
        parts.push(`[${edit.actor_name}] ${edit.comment}`);
      }
    }
  }
  return parts.join('\n');
}
