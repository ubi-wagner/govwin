/**
 * Canvas JSON → Excel (.xlsx) export engine.
 *
 * Walks the CanvasDocument node list and produces an .xlsx workbook.
 * Each table node becomes its own worksheet. Text and heading nodes
 * are also written as labeled sections on a summary sheet.
 *
 * Uses `exceljs` for Open XML Spreadsheet generation.
 */

import ExcelJS from 'exceljs';
import type {
  CanvasDocument,
  CanvasNode,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell as CanvasTableCell,
  CaptionContent,
} from '@/lib/types/canvas-document';

/** Get the text value from a TableCell or string. */
function cellText(cell: string | CanvasTableCell): string {
  return typeof cell === 'string' ? cell : cell.text;
}

/**
 * Convert a CanvasDocument to an .xlsx Buffer suitable for download.
 *
 * @param doc — the canvas document to export
 * @param variables — template variable substitutions (unused for xlsx, kept for API parity)
 * @returns Buffer containing the .xlsx file bytes
 */
export async function exportToXlsx(
  doc: CanvasDocument,
  variables: Record<string, string> = {},
): Promise<Buffer> {
  const { nodes } = doc;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = variables.company_name ?? 'GovWin';
  workbook.created = new Date();
  workbook.modified = new Date();

  const tableNodes = nodes.filter((n) => n.type === 'table');
  const nonTableNodes = nodes.filter((n) => n.type !== 'table' && n.type !== 'page_break' && n.type !== 'spacer');

  let tableCount = 0;

  // ─── Create a worksheet for each table ────────────────────────────

  for (const node of tableNodes) {
    tableCount++;
    const tc = node.content as TableContent;

    // Derive sheet name from surrounding caption or default
    const caption = findCaptionFor(nodes, node);
    const sheetName = sanitizeSheetName(caption ?? `Sheet ${tableCount}`);

    const ws = workbook.addWorksheet(sheetName);

    const headerTexts = tc.headers.map((h) => cellText(h));
    const colCount = headerTexts.length;

    // Set up columns with auto-width estimation
    ws.columns = headerTexts.map((headerText) => ({
      header: headerText,
      width: Math.max(12, Math.min(40, headerText.length + 4)),
    }));

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Write data rows
    for (const row of tc.rows) {
      const rowValues = row.map((cell) => cellText(cell));
      const dataRow = ws.addRow(rowValues);

      dataRow.eachCell((cell) => {
        cell.font = { size: 11 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    }

    // Auto-fit column widths based on content
    ws.columns.forEach((col) => {
      let maxLen = (col.header as string)?.length ?? 10;
      if (col.eachCell) {
        col.eachCell({ includeEmpty: false }, (cell) => {
          const len = cell.text?.length ?? 0;
          if (len > maxLen) maxLen = len;
        });
      }
      col.width = Math.max(12, Math.min(50, maxLen + 2));
    });

    // Set print area
    const lastCol = numberToColumnLetter(colCount);
    const lastRow = 1 + tc.rows.length;
    ws.pageSetup = {
      ...ws.pageSetup,
      printArea: `A1:${lastCol}${lastRow}`,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  }

  // ─── Create a "Content" sheet for non-table text ──────────────────

  if (nonTableNodes.length > 0) {
    const ws = workbook.addWorksheet('Content');

    // Single wide column
    ws.columns = [{ header: 'Content', width: 80 }];

    // Style header
    const header = ws.getRow(1);
    header.getCell(1).font = { bold: true, size: 12 };
    header.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    for (const node of nonTableNodes) {
      writeNodeToSheet(ws, node);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Write a non-table node as row(s) in a worksheet. */
function writeNodeToSheet(ws: ExcelJS.Worksheet, node: CanvasNode): void {
  switch (node.type) {
    case 'heading': {
      const c = node.content as HeadingContent;
      const text = (c.numbering ? `${c.numbering} ` : '') + c.text;
      const row = ws.addRow([text]);
      row.getCell(1).font = {
        bold: true,
        size: headingSize(c.level),
      };
      // Add a blank row after heading for spacing
      ws.addRow([]);
      break;
    }

    case 'text_block': {
      const c = node.content as TextBlockContent;
      if (c.text) {
        const row = ws.addRow([c.text]);
        row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      }
      break;
    }

    case 'bulleted_list':
    case 'numbered_list': {
      const c = node.content as ListContent;
      c.items.forEach((item, idx) => {
        const prefix = node.type === 'bulleted_list'
          ? `${'  '.repeat(item.indent_level ?? 0)}• `
          : `${'  '.repeat(item.indent_level ?? 0)}${idx + 1}. `;
        ws.addRow([prefix + item.text]);
      });
      break;
    }

    case 'caption': {
      const c = node.content as CaptionContent;
      const row = ws.addRow([`${c.prefix} ${c.number}: ${c.text}`]);
      row.getCell(1).font = { italic: true };
      break;
    }

    case 'footnote': {
      const c = node.content as { marker: string; text: string };
      ws.addRow([`[${c.marker}] ${c.text}`]);
      break;
    }

    case 'url': {
      const c = node.content as { href: string; display_text: string };
      const row = ws.addRow([c.display_text]);
      row.getCell(1).value = {
        text: c.display_text,
        hyperlink: c.href,
      } as ExcelJS.CellHyperlinkValue;
      row.getCell(1).font = { color: { argb: 'FF0066CC' }, underline: true };
      break;
    }

    case 'image': {
      const alt = (node.content as { alt_text?: string })?.alt_text ?? 'image';
      const row = ws.addRow([`[Image: ${alt}]`]);
      row.getCell(1).font = { italic: true, color: { argb: 'FF999999' } };
      break;
    }

    case 'toc': {
      const row = ws.addRow(['[Table of Contents]']);
      row.getCell(1).font = { italic: true, color: { argb: 'FF999999' } };
      break;
    }

    default:
      break;
  }
}

/** Map heading level to Excel font size. */
function headingSize(level: 1 | 2 | 3): number {
  switch (level) {
    case 1: return 16;
    case 2: return 14;
    case 3: return 12;
    default: return 14;
  }
}

/**
 * Try to find a caption node immediately before or after a table node.
 * Returns the caption text if found, or null.
 */
function findCaptionFor(nodes: CanvasNode[], tableNode: CanvasNode): string | null {
  const idx = nodes.indexOf(tableNode);
  if (idx > 0 && nodes[idx - 1].type === 'caption') {
    const c = nodes[idx - 1].content as CaptionContent;
    return `${c.prefix} ${c.number} - ${c.text}`;
  }
  if (idx < nodes.length - 1 && nodes[idx + 1].type === 'caption') {
    const c = nodes[idx + 1].content as CaptionContent;
    return `${c.prefix} ${c.number} - ${c.text}`;
  }
  return null;
}

/**
 * Sanitize a string for use as an Excel worksheet name.
 * Removes invalid chars and truncates to 31 chars.
 */
function sanitizeSheetName(name: string): string {
  return name
    .replace(/[[\]*?/\\:]/g, '_')
    .substring(0, 31)
    .trim() || 'Sheet';
}

/** Convert 1-based column number to Excel column letter (1 → A, 26 → Z, 27 → AA). */
function numberToColumnLetter(num: number): string {
  let result = '';
  let n = num;
  while (n > 0) {
    n--;
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
