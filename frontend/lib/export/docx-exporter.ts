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
  convertInchesToTwip,
} from 'docx';
import type {
  CanvasDocument,
  CanvasNode,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell as CanvasTableCell,
  CaptionContent,
  FootnoteContent,
  UrlContent,
} from '@/lib/types/canvas-document';

/**
 * Convert a CanvasDocument to a .docx Buffer suitable for download.
 *
 * @param doc — the canvas document to export
 * @param variables — template variable substitutions (company_name, topic_number, etc.)
 * @returns Buffer containing the .docx file bytes
 */
export async function exportToDocx(
  doc: CanvasDocument,
  variables: Record<string, string> = {},
): Promise<Buffer> {
  const { canvas, nodes } = doc;

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
          children: [
            new TextRun({
              text: sub(canvas.footer.template)
                .replace('{n}', '')
                .replace('{N}', ''),
              font: canvas.footer.font.family,
              size: canvas.footer.font.size * 2,
            }),
            new TextRun({ children: [PageNumber.CURRENT] }),
            new TextRun({ text: ' of ' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
          ],
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

  // Build children from nodes
  const children: (Paragraph | Table)[] = [];
  for (const node of nodes) {
    const elements = nodeToDocx(node, fontDefault, lineSpacing, nodes);
    children.push(...elements);
  }

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

function nodeToDocx(
  node: CanvasNode,
  fontDefault: { family: string; size: number },
  lineSpacing: number,
  allNodes: CanvasNode[],
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
      });
      return [new Paragraph({
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
      return c.items.map((item) =>
        new Paragraph({
          bullet: node.type === 'bulleted_list' ? { level: item.indent_level ?? 0 } : undefined,
          numbering: node.type === 'numbered_list' ? { reference: 'default-numbering', level: item.indent_level ?? 0 } : undefined,
          children: [new TextRun({ text: item.text, font, size })],
        }),
      );
    }

    case 'table': {
      const c = node.content as TableContent;
      const resolveCell = (cell: string | CanvasTableCell): CanvasTableCell =>
        typeof cell === 'string' ? { text: cell } : cell;

      const headerRow = new TableRow({
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

    case 'image':
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `[Image: ${(node.content as { alt_text: string })?.alt_text ?? 'image'}]`, italics: true, color: '999999', font, size })],
      })];

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
  nodeStyle?: { color?: string; bold?: boolean; italic?: boolean },
): TextRun[] {
  const defaultColor = nodeStyle?.color?.replace('#', '') || undefined;
  const defaultBold = nodeStyle?.bold || undefined;
  const defaultItalic = nodeStyle?.italic || undefined;

  if (!content.inline_formats || content.inline_formats.length === 0) {
    return [new TextRun({ text: content.text, font, size, color: defaultColor, bold: defaultBold, italics: defaultItalic })];
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
      underline: isUnderline ? {} : undefined,
      superScript: isSuperscript || undefined,
      subScript: isSubscript || undefined,
      color: defaultColor,
    }));
  }

  return runs;
}
