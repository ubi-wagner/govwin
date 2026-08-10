/**
 * Canvas JSON → Word (.docx) export engine.
 *
 * Walks the CanvasDocument node list and produces a .docx file with
 * exact font, margin, header/footer compliance. Uses the `docx` npm
 * package for Open XML generation.
 *
 * The output is pixel-accurate to the canvas editor's WYSIWYG view
 * because both use the same canvas rules (font, margins, line spacing).
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  Table,
  TableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  BorderStyle,
  ShadingType,
  ImageRun,
  convertInchesToTwip,
} from 'docx';
import { rasterizeDataUri, resolveImageDataUri, type RasterPng } from '@/lib/export/image-raster';
import { renderChartSvg, renderShapeSvg } from '@/lib/export/canvas-html';
import { docNodes } from '@/lib/types/canvas-document';
import type {
  CanvasDocument,
  CanvasNode,
  NodeStyle,
  CanvasSection,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell as CanvasTableCell,
  CaptionContent,
  FootnoteContent,
  UrlContent,
  ShapeContent,
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

/** Shapes that render as a native docx box (bordered/shaded cell); the rest
 *  rasterize as a vector figure. text_box + callout reuse the same box idiom. */
const BOX_SHAPES: ReadonlySet<string> = new Set(['rectangle', 'rounded_rectangle']);
const CALLOUT_PALETTE: Record<string, { bg: string; fg: string }> = {
  info: { bg: 'EFF6FF', fg: '1D4ED8' }, warning: { bg: 'FEF3C7', fg: 'B45309' },
  tip: { bg: 'ECFDF5', fg: '047857' }, success: { bg: 'ECFDF5', fg: '047857' }, note: { bg: 'F1F5F9', fg: '475569' },
};

/** An SVG string → a utf8 data URI (encoded so the payload's commas/hashes don't
 *  confuse the rasterizer's header/payload split). */
function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const hx = (c?: string | null): string | undefined => (c ? c.replace(/^#/, '').trim().toUpperCase() : undefined);
const BORDER_STYLE: Record<string, (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  solid: BorderStyle.SINGLE, dashed: BorderStyle.DASHED, dotted: BorderStyle.DOTTED, none: BorderStyle.NONE,
};

/** Paragraph-level pagination flags applied to a keep-together group's content. */
type ParaOpts = { keepLines?: boolean; keepNext?: boolean };

/**
 * Convert a CanvasDocument to a .docx Buffer suitable for download.
 *
 * @param doc — the canvas document to export
 * @param variables — template variable substitutions (company_name, topic_number, etc.)
 * @returns Buffer containing the .docx file bytes
 */
/**
 * Tokenize a footer template into runs, substituting {n}/{N} with live page-number
 * fields (so "Page {n} of {N}" renders "Page 1 of 5", not "Page  of 1 of 5"). A
 * template with no {n}/{N} gets "· Page X of Y" appended.
 */
function footerRuns(template: string, font: string, size: number): TextRun[] {
  const runs: TextRun[] = [];
  for (const part of template.split(/(\{n\}|\{N\})/g)) {
    if (part === '{n}') runs.push(new TextRun({ children: [PageNumber.CURRENT], font, size }));
    else if (part === '{N}') runs.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size }));
    else if (part) runs.push(new TextRun({ text: part, font, size }));
  }
  if (!/\{n\}|\{N\}/.test(template)) {
    runs.push(
      new TextRun({ text: ' · Page ', font, size }),
      new TextRun({ children: [PageNumber.CURRENT], font, size }),
      new TextRun({ text: ' of ', font, size }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size }),
    );
  }
  return runs;
}

export async function exportToDocx(
  doc: CanvasDocument,
  variables: Record<string, string> = {},
): Promise<Buffer> {
  const { canvas } = doc;
  // Flat node view of either shape (v2 sections flattened) for the raster
  // pre-pass, numbered-list instance indexing, and the TOC.
  const nodes = docNodes(doc);

  // Canvas config is optional / may be partial on a hand-authored or freshly
  // provisioned section; fall back to document defaults (US Letter, 1" margins,
  // 12pt Times, single spacing) so export NEVER crashes on a missing
  // font_default / margins / page size. Header/footer guards also tolerate a
  // header/footer that carries no font.
  const fontDefault = canvas?.font_default ?? { family: 'Times New Roman', size: 12 };
  const lineSpacing = canvas?.line_spacing ?? 1.15;
  const margins = canvas?.margins ?? { top: 72, right: 72, bottom: 72, left: 72 };
  const pageWidth = canvas?.width ?? 612;
  const pageHeight = canvas?.height ?? 792;

  const sub = (t: string) =>
    t.replace(/\{(\w+)\}/g, (_, k) => variables[k] ?? `{${k}}`);

  // Build header/footer
  const headers = canvas?.header?.font ? {
    default: new Header({
      children: [
        new Paragraph({
          children: [new TextRun({
            text: sub(canvas.header.template),
            font: canvas.header.font.family,
            size: canvas.header.font.size * 2,
          })],
        }),
      ],
    }),
  } : undefined;

  const footers = canvas?.footer?.font ? {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: footerRuns(sub(canvas.footer.template), canvas.footer.font.family, canvas.footer.font.size * 2),
        }),
      ],
    }),
  } : undefined;

  // Convert margins from points to twips (1 point = 20 twips)
  const marginTwips = {
    top: margins.top * 20,
    right: margins.right * 20,
    bottom: margins.bottom * 20,
    left: margins.left * 20,
  };

  // Pre-rasterize the picture-backed nodes (SVG/data-URI → PNG) so the sync node
  // walker can embed a real picture: image nodes, chart nodes (chart SVG), and
  // the vector shapes docx has no primitive for (ellipse/triangle/line/arrow/
  // star/diamond/callout-bubble). Box shapes (rect/rounded) render natively.
  const raster = new Map<CanvasNode, RasterPng | null>();
  const needsRaster = (n: CanvasNode): boolean =>
    n.type === 'image' || n.type === 'chart' ||
    (n.type === 'shape' && !BOX_SHAPES.has((n.content as ShapeContent)?.shape ?? 'rectangle'));
  await Promise.all(
    nodes.filter(needsRaster).map(async (n) => {
      const uri = n.type === 'image'
        ? await resolveImageDataUri((n.content as { storage_key?: string })?.storage_key)
        : n.type === 'chart'
          ? svgDataUri(renderChartSvg(n.content as ChartContent))
          : svgDataUri(renderShapeSvg(n));
      raster.set(n, await rasterizeDataUri(uri));
    }),
  );

  // Build children. A v2 doc walks sections→groups→nodes (flow, no forced
  // breaks; keep_together sections/groups get keepLines/keepNext + break_before
  // a page break); a v1 doc walks the flat node list exactly as before.
  const children: (Paragraph | Table)[] = doc.sections && doc.sections.length
    ? sectionsToDocxChildren(doc.sections, fontDefault, lineSpacing, nodes, raster)
    : nodes.flatMap((node) => nodeToDocx(node, fontDefault, lineSpacing, nodes, raster));

  const document = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: Array.from({ length: 9 }, (_, i) => ({
          level: i,
          format: 'decimal' as const,
          text: `%${i + 1}.`,
          alignment: 'start' as const,
          style: {
            paragraph: {
              indent: { left: 720 * (i + 1), hanging: 360 },
            },
          },
        })),
      }],
    },
    sections: [{
      properties: {
        page: {
          margin: marginTwips,
          size: {
            width: pageWidth * 20,
            height: pageHeight * 20,
          },
        },
      },
      headers,
      footers,
      children,
    }],
    styles: {
      default: {
        document: {
          run: {
            font: fontDefault.family,
            size: fontDefault.size * 2,
          },
          paragraph: {
            spacing: {
              line: Math.round(lineSpacing * 240),
            },
          },
        },
      },
    },
  });

  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer);
}

/**
 * Walk the section layer (v2) into docx children. Sections FLOW — Word's native
 * pagination fills each page and runs content across boundaries, so there are no
 * bottom-of-page gaps. `break_before` inserts a page break before the section; a
 * `keep_together` section or group tags its paragraphs keepLines/keepNext (and
 * its table rows cantSplit) so Word keeps the block whole on one page.
 */
function sectionsToDocxChildren(
  sections: CanvasSection[],
  fontDefault: { family: string; size: number },
  lineSpacing: number,
  allNodes: CanvasNode[],
  raster: Map<CanvasNode, RasterPng | null>,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  sections.forEach((section, i) => {
    if (section.layout?.break_before && i > 0) {
      children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    }
    const sectionKeep = section.layout?.mode === 'keep_together';
    for (const group of section.groups ?? []) {
      const keep = sectionKeep || !!group.keep_together;
      const paraOpts: ParaOpts = keep ? { keepLines: true, keepNext: true } : {};
      for (const node of group.nodes ?? []) {
        children.push(...nodeToDocx(node, fontDefault, lineSpacing, allNodes, raster, paraOpts));
      }
    }
  });
  return children;
}

/**
 * A native docx "box" — a single-cell table with a fill (shading) + border,
 * holding the given paragraphs. This is the idiom behind the box-like extended
 * elements: shape(rectangle/rounded), text_box, and callout. `leftAccent` draws a
 * thick colored left rule (callouts); a border `style:'none'` suppresses the frame.
 */
function boxTable(paras: Paragraph[], opts: { fill?: string; border?: NodeStyle['border']; leftAccent?: string } = {}): Table {
  const b = opts.border;
  const edge = b?.style === 'none'
    ? { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    : b
      ? { style: BORDER_STYLE[b.style ?? 'solid'] ?? BorderStyle.SINGLE, size: Math.max(2, Math.round((b.width ?? 1) * 8)), color: hx(b.color) ?? '334155' }
      : { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const left = opts.leftAccent ? { style: BorderStyle.SINGLE, size: 28, color: hx(opts.leftAccent) ?? '334155' } : edge;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new DocxTableCell({
        shading: opts.fill ? { type: ShadingType.SOLID, color: hx(opts.fill)!, fill: hx(opts.fill)! } : undefined,
        borders: { top: edge, bottom: edge, left, right: edge },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: paras,
      })],
    })],
  });
}

/** A centered image paragraph from a pre-rastered PNG, capped to the content column. */
function pngParagraph(r: RasterPng, maxW: number, paraOpts: ParaOpts = {}): Paragraph {
  const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 1.6;
  const w = Math.min(r.width || maxW, maxW);
  const h = Math.round(w / aspect);
  return new Paragraph({
    ...paraOpts, keepLines: true, alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 },
    children: [new ImageRun({ type: 'png', data: r.buffer, transformation: { width: w, height: h } })],
  });
}

function nodeToDocx(
  node: CanvasNode,
  fontDefault: { family: string; size: number },
  lineSpacing: number,
  allNodes: CanvasNode[],
  raster?: Map<CanvasNode, RasterPng | null>,
  paraOpts: ParaOpts = {},
): (Paragraph | Table)[] {
  // A node may carry no explicit style (hand-authored content / template output);
  // default it so per-node style reads never crash. Field fallbacks below still apply.
  const style = node.style ?? ({} as NonNullable<CanvasNode['style']>);
  const font = style.family ?? fontDefault.family;
  const size = (style.size ?? fontDefault.size) * 2;
  const alignment = ({
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  } as const)[style.alignment ?? 'left'] ?? AlignmentType.LEFT;

  switch (node.type) {
    case 'heading': {
      const c = node.content as HeadingContent;
      const level = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 }[c.level] ?? HeadingLevel.HEADING_2;
      return [new Paragraph({
        ...paraOpts,
        keepNext: true, // a heading never sits alone at the foot of a page
        heading: level,
        children: [new TextRun({
          text: (c.numbering ? `${c.numbering} ` : '') + c.text,
          font,
          size,
          bold: true,
        })],
      })];
    }

    case 'text_block': {
      const c = node.content as TextBlockContent;
      const runs = createFormattedRuns(c, font, size, {
        color: style.color,
        bold: style.weight === 'bold',
        italic: style.style === 'italic',
        underline: style.underline,
        strikethrough: style.strikethrough,
        highlight: style.highlight,
      });
      return [new Paragraph({
        ...paraOpts,
        alignment,
        indent: style.indent ? { left: style.indent * 20 } : undefined,
        spacing: {
          before: (style.space_before ?? 0) * 20,
          after: (style.space_after ?? 0) * 20,
        },
        children: runs,
      })];
    }

    case 'bulleted_list':
    case 'numbered_list': {
      const c = node.content as ListContent;
      // Each numbered list gets its own concrete `instance` so a second list restarts
      // at 1 instead of continuing the first list's counter (one shared reference =
      // one continuous counter otherwise).
      const instance = node.type === 'numbered_list' ? allNodes.filter((n) => n.type === 'numbered_list').indexOf(node) : 0;
      return c.items.map((item) =>
        new Paragraph({
          ...paraOpts,
          bullet: node.type === 'bulleted_list' ? { level: item.indent_level ?? 0 } : undefined,
          numbering: node.type === 'numbered_list' ? { reference: 'default-numbering', level: item.indent_level ?? 0, instance } : undefined,
          children: [new TextRun({ text: item.text, font, size })],
        }),
      );
    }

    case 'table': {
      const c = node.content as TableContent;
      const resolveCell = (cell: string | CanvasTableCell): CanvasTableCell =>
        typeof cell === 'string' ? { text: cell } : cell;

      const headerRow = new TableRow({
        cantSplit: !!paraOpts.keepLines,
        children: c.headers.map((h) => {
          const cell = resolveCell(h);
          const mergedStyle = { ...c.header_style, ...cell.style };
          const cellAlignment = mergedStyle.alignment
            ? ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const)[mergedStyle.alignment] ?? AlignmentType.LEFT
            : AlignmentType.LEFT;
          return new DocxTableCell({
            children: [new Paragraph({
              alignment: cellAlignment,
              children: [new TextRun({
                text: cell.text,
                bold: mergedStyle.bold !== false,
                color: mergedStyle.fg ? mergedStyle.fg.replace('#', '') : undefined,
                font,
                size,
              })],
            })],
            width: { size: 100 / c.headers.length, type: WidthType.PERCENTAGE },
            rowSpan: cell.rowSpan,
            columnSpan: cell.colSpan,
            shading: mergedStyle.bg ? { type: ShadingType.SOLID, color: mergedStyle.bg.replace('#', '') } : undefined,
          });
        }),
      });
      const dataRows = c.rows.map((row) =>
        new TableRow({
          cantSplit: paraOpts.keepLines || undefined,
          children: row.map((rawCell) => {
            const cell = resolveCell(rawCell);
            const cellStyle = cell.style;
            const cellAlignment = cellStyle?.alignment
              ? ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const)[cellStyle.alignment] ?? AlignmentType.LEFT
              : AlignmentType.LEFT;
            return new DocxTableCell({
              children: [new Paragraph({
                alignment: cellAlignment,
                children: [new TextRun({
                  text: cell.text,
                  bold: cellStyle?.bold ?? false,
                  color: cellStyle?.fg ? cellStyle.fg.replace('#', '') : undefined,
                  font,
                  size,
                })],
              })],
              rowSpan: cell.rowSpan,
              columnSpan: cell.colSpan,
              shading: cellStyle?.bg ? { type: ShadingType.SOLID, color: cellStyle.bg.replace('#', '') } : undefined,
            });
          }),
        }),
      );
      return [new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      })];
    }

    case 'caption': {
      const c = node.content as CaptionContent;
      return [new Paragraph({
        ...paraOpts,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `${c.prefix} ${c.number}: `, bold: true, italics: true, font, size }),
          new TextRun({ text: c.text, italics: true, font, size }),
        ],
      })];
    }

    case 'footnote': {
      const c = node.content as FootnoteContent;
      return [new Paragraph({
        ...paraOpts,
        children: [
          new TextRun({ text: c.marker, superScript: true, font, size: size - 4 }),
          new TextRun({ text: ` ${c.text}`, font, size: size - 4 }),
        ],
        border: { top: { style: BorderStyle.SINGLE, size: 1 } },
      })];
    }

    case 'url': {
      const c = node.content as UrlContent;
      return [new Paragraph({
        ...paraOpts,
        children: [new TextRun({ text: c.display_text, font, size, color: '0000FF' })],
      })];
    }

    case 'page_break':
      return [new Paragraph({ pageBreakBefore: true, children: [] })];

    case 'spacer':
      return [new Paragraph({ spacing: { after: 200 }, children: [] })];

    case 'toc': {
      const headings = allNodes
        .filter((n) => n.type === 'heading')
        .map((n) => {
          const hc = n.content as HeadingContent;
          return { level: hc.level, text: hc.text, numbering: hc.numbering };
        });

      const tocParagraphs: Paragraph[] = [
        new Paragraph({
          children: [new TextRun({ text: 'Table of Contents', bold: true, font, size: fontDefault.size * 2 + 4 })],
          spacing: { after: 200 },
        }),
      ];

      for (const h of headings) {
        const indent = (h.level - 1) * 720; // 0.5 inch per level
        const prefix = h.numbering ? `${h.numbering} ` : '';
        tocParagraphs.push(new Paragraph({
          children: [new TextRun({
            text: `${prefix}${h.text}`,
            font,
            size: h.level === 1 ? fontDefault.size * 2 + 2 : fontDefault.size * 2,
            bold: h.level === 1,
          })],
          indent: { left: indent },
          spacing: { before: h.level === 1 ? 120 : 40, after: 40 },
        }));
      }

      if (headings.length === 0) {
        tocParagraphs.push(new Paragraph({
          children: [new TextRun({ text: '(No headings)', italics: true, color: '999999', font, size: fontDefault.size * 2 })],
        }));
      }

      return tocParagraphs;
    }

    case 'image': {
      const ic = node.content as { alt_text?: string; caption?: string; width?: number; height?: number };
      const r = raster?.get(node);
      if (!r) {
        return [new Paragraph({
          ...paraOpts,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `[Image: ${ic.alt_text ?? 'image'}]`, italics: true, color: '999999', font, size })],
        })];
      }
      // Display size: the node's intended width/height, else the intrinsic raster
      // size, capped to the ~6.5" content column (624px @ 96dpi), aspect-preserved.
      const natW = ic.width && ic.width > 0 ? ic.width : r.width;
      const natH = ic.height && ic.height > 0 ? ic.height : r.height;
      const aspect = natW > 0 && natH > 0 ? natW / natH : 1;
      let dispW = Math.min(natW, 470);
      let dispH = Math.round(dispW / aspect);
      // Keep the figure atomic: the image never splits from its caption, and the
      // image+caption block never orphans across a page break (keepNext/keepLines).
      const out: Paragraph[] = [new Paragraph({
        ...paraOpts,
        keepLines: true,
        keepNext: !!ic.caption,
        alignment: AlignmentType.CENTER,
        spacing: { before: 140, after: ic.caption ? 20 : 140 },
        children: [new ImageRun({ type: 'png', data: r.buffer, transformation: { width: dispW, height: dispH } })],
      })];
      if (ic.caption) {
        out.push(new Paragraph({
          ...paraOpts,
          keepLines: true,
          alignment: AlignmentType.CENTER,
          spacing: { after: 150 },
          children: [new TextRun({ text: ic.caption, italics: true, color: '666666', font, size: size - 2 })],
        }));
      }
      return out;
    }

    // ── Extended elements ──────────────────────────────────────────────
    case 'shape': {
      const sc = node.content as ShapeContent;
      if (BOX_SHAPES.has(sc.shape)) {
        // rectangle / rounded → native bordered+shaded box (crisp, editable text)
        const runs = [new TextRun({ text: sc.text ?? '', font, size, color: hx(style.color), bold: style.weight === 'bold', italics: style.style === 'italic' })];
        return [boxTable([new Paragraph({ alignment: AlignmentType.CENTER, children: runs })], { fill: style.fill?.color, border: style.border })];
      }
      // ellipse/triangle/line/arrow/star/diamond/bubble → rasterized vector figure
      const r = raster?.get(node);
      if (r) return [pngParagraph(r, 360, paraOpts)];
      return [new Paragraph({ ...paraOpts, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[${sc.shape}]`, italics: true, color: '999999', font, size })] })];
    }

    case 'text_box': {
      const c = node.content as TextBoxContent;
      const runs = createFormattedRuns({ text: c.text, inline_formats: c.inline_formats }, font, size, {
        color: style.color, bold: style.weight === 'bold', italic: style.style === 'italic',
        underline: style.underline, strikethrough: style.strikethrough, highlight: style.highlight,
      });
      return [boxTable([new Paragraph({ alignment, children: runs })], { fill: style.fill?.color, border: style.border ?? { color: '#CBD5E1', width: 1 } })];
    }

    case 'callout': {
      const c = node.content as CalloutContent;
      const pal = CALLOUT_PALETTE[c.variant] ?? CALLOUT_PALETTE.note;
      const paras: Paragraph[] = [];
      if (c.title) paras.push(new Paragraph({ children: [new TextRun({ text: c.title, bold: true, color: pal.fg, font, size })] }));
      paras.push(new Paragraph({ children: [new TextRun({ text: c.text, font, size, color: '1E293B' })] }));
      return [boxTable(paras, { fill: pal.bg, leftAccent: pal.fg, border: { color: pal.fg, width: 1 } })];
    }

    case 'code_block': {
      const c = node.content as CodeBlockContent;
      const paras = (c.code || ' ').split('\n').map((ln) =>
        new Paragraph({ spacing: { after: 0, line: 240 }, children: [new TextRun({ text: ln || ' ', font: 'Courier New', size, color: 'E2E8F0' })] }));
      return [boxTable(paras, { fill: '#1E293B', border: { style: 'none' } })];
    }

    case 'blockquote': {
      const c = node.content as BlockquoteContent;
      const rule = { left: { style: BorderStyle.SINGLE, size: 24, color: hx(style.color) ?? '1F4E79', space: 12 } };
      const out: Paragraph[] = [new Paragraph({
        ...paraOpts, indent: { left: 240 }, border: rule, spacing: { before: 80, after: c.cite ? 0 : 80 },
        children: [new TextRun({ text: c.text, italics: true, font, size, color: '334155' })],
      })];
      if (c.cite) out.push(new Paragraph({ indent: { left: 240 }, border: rule, spacing: { after: 80 }, children: [new TextRun({ text: `— ${c.cite}`, font, size: size - 2, color: '64748B' })] }));
      return out;
    }

    case 'chart': {
      const r = raster?.get(node);
      if (r) return [pngParagraph(r, 470, paraOpts)];
      const c = node.content as ChartContent;
      return [new Paragraph({ ...paraOpts, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[Chart: ${c.chart_type}]`, italics: true, color: '999999', font, size })] })];
    }

    case 'equation': {
      const c = node.content as EquationContent;
      const tex = c.latex ?? c.mathml ?? '(equation)';
      return [new Paragraph({
        ...paraOpts, alignment: c.display === false ? AlignmentType.LEFT : AlignmentType.CENTER, spacing: { before: 80, after: 80 },
        children: [new TextRun({ text: tex, font: 'Cambria Math', size: size + 2, italics: true, color: '1E293B' })],
      })];
    }

    case 'divider': {
      const c = node.content as DividerContent;
      const st = c.line_style === 'dashed' ? BorderStyle.DASHED : c.line_style === 'dotted' ? BorderStyle.DOTTED : BorderStyle.SINGLE;
      return [new Paragraph({
        ...paraOpts, spacing: { before: 80, after: 80 },
        border: { bottom: { style: st, size: Math.max(4, Math.round((c.thickness ?? 1) * 8)), color: hx(c.color) ?? 'CBD5E1' } },
        children: [],
      })];
    }

    case 'video': {
      const c = node.content as VideoContent;
      const label = c.caption ?? c.url ?? 'Video';
      const play = new TextRun({ text: '▶  ', font, size: size + 4, color: 'FFFFFF' });
      const text = c.url
        ? new ExternalHyperlink({ link: c.url, children: [new TextRun({ text: label, font, size, color: 'FFFFFF', underline: {} })] })
        : new TextRun({ text: label, font, size, color: 'FFFFFF' });
      return [boxTable([new Paragraph({ alignment: AlignmentType.CENTER, children: [play, text] })], { fill: '#0F172A', border: { style: 'none' } })];
    }

    case 'signature': {
      const c = node.content as SignatureContent;
      const out: Paragraph[] = [];
      if (c.signed && c.signer_name) {
        out.push(new Paragraph({ spacing: { before: 160, after: 0 }, children: [new TextRun({ text: c.signer_name, italics: true, font: 'Segoe Script', size: size + 6, color: '1E3A8A' })] }));
      }
      out.push(new Paragraph({
        spacing: { before: c.signed && c.signer_name ? 0 : 260, after: 20 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1E293B' } },
        children: [new TextRun({ text: ' '.repeat(48), font, size })],
      }));
      out.push(new Paragraph({ children: [new TextRun({ text: (c.label ?? 'Signature') + (c.signed_at ? `   ·   ${c.signed_at}` : ''), font, size: size - 2, color: '64748B' })] }));
      return out;
    }

    default:
      return [];
  }
}

/**
 * Split a TextBlockContent into multiple TextRun objects, applying
 * bold/italic/underline/superscript/subscript from inline_formats.
 */
function createFormattedRuns(
  content: TextBlockContent,
  font: string,
  size: number,
  nodeStyle?: { color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; highlight?: string },
): TextRun[] {
  const defaultColor = nodeStyle?.color?.replace('#', '') || undefined;
  const defaultBold = nodeStyle?.bold || undefined;
  const defaultItalic = nodeStyle?.italic || undefined;
  const defaultUnderline = nodeStyle?.underline || undefined;
  const defaultStrike = nodeStyle?.strikethrough || undefined;
  const defaultShading = nodeStyle?.highlight ? { fill: nodeStyle.highlight.replace('#', '') } : undefined;

  if (!content.inline_formats || content.inline_formats.length === 0) {
    return [new TextRun({
      text: content.text, font, size, color: defaultColor, bold: defaultBold, italics: defaultItalic,
      underline: defaultUnderline ? {} : undefined, strike: defaultStrike, shading: defaultShading,
    })];
  }

  const text = content.text;
  const formats = [...content.inline_formats].sort((a, b) => a.start - b.start);

  // Collect all boundary points
  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(text.length);
  for (const f of formats) {
    boundaries.add(f.start);
    boundaries.add(f.start + f.length);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const runs: TextRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segStart >= segEnd) continue;
    const segText = text.slice(segStart, segEnd);

    // Determine which formats apply to this segment
    const activeFormats = formats.filter(
      (f) => f.start <= segStart && f.start + f.length >= segEnd,
    );

    const isBold = activeFormats.some((f) => f.format === 'bold');
    const isItalic = activeFormats.some((f) => f.format === 'italic');
    const isUnderline = activeFormats.some((f) => f.format === 'underline');
    const isSuperscript = activeFormats.some((f) => f.format === 'superscript');
    const isSubscript = activeFormats.some((f) => f.format === 'subscript');

    runs.push(new TextRun({
      text: segText,
      font,
      size,
      bold: isBold || defaultBold || undefined,
      italics: isItalic || defaultItalic || undefined,
      underline: (isUnderline || defaultUnderline) ? {} : undefined,
      strike: defaultStrike,
      shading: defaultShading,
      superScript: isSuperscript || undefined,
      subScript: isSubscript || undefined,
      color: defaultColor,
    }));
  }

  return runs;
}
