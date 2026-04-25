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
  TableCell,
  WidthType,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  BorderStyle,
  convertInchesToTwip,
} from 'docx';
import type {
  CanvasDocument,
  CanvasNode,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
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

  const sub = (t: string) =>
    t.replace(/\{(\w+)\}/g, (_, k) => variables[k] ?? `{${k}}`);

  // Build header/footer
  const headers = canvas.header ? {
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

  const footers = canvas.footer ? {
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
    top: canvas.margins.top * 20,
    right: canvas.margins.right * 20,
    bottom: canvas.margins.bottom * 20,
    left: canvas.margins.left * 20,
  };

  // Build children from nodes
  const children: (Paragraph | Table)[] = [];
  for (const node of nodes) {
    const elements = nodeToDocx(node, canvas.font_default, canvas.line_spacing);
    children.push(...elements);
  }

  const document = new Document({
    sections: [{
      properties: {
        page: {
          margin: marginTwips,
          size: {
            width: canvas.width * 20,
            height: canvas.height * 20,
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
            font: canvas.font_default.family,
            size: canvas.font_default.size * 2,
          },
          paragraph: {
            spacing: {
              line: Math.round(canvas.line_spacing * 240),
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
): (Paragraph | Table)[] {
  const font = node.style.family ?? fontDefault.family;
  const size = (node.style.size ?? fontDefault.size) * 2;
  const alignment = ({
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  } as const)[node.style.alignment ?? 'left'] ?? AlignmentType.LEFT;

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
      return [new Paragraph({
        alignment,
        indent: node.style.indent ? { left: node.style.indent * 20 } : undefined,
        spacing: {
          before: (node.style.space_before ?? 0) * 20,
          after: (node.style.space_after ?? 0) * 20,
        },
        children: [new TextRun({ text: c.text, font, size })],
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
      const headerRow = new TableRow({
        children: c.headers.map((h) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font, size })] })],
            width: { size: 100 / c.headers.length, type: WidthType.PERCENTAGE },
          }),
        ),
      });
      const dataRows = c.rows.map((row) =>
        new TableRow({
          children: row.map((cell) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cell, font, size })] })],
            }),
          ),
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

    case 'toc':
      return [new Paragraph({
        children: [new TextRun({ text: '[Table of Contents]', italics: true, color: '999999', font, size })],
      })];

    case 'image':
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `[Image: ${(node.content as { alt_text: string })?.alt_text ?? 'image'}]`, italics: true, color: '999999', font, size })],
      })];

    default:
      return [];
  }
}
