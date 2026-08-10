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
import { docNodes } from '@/lib/types/canvas-document';
import { rasterizeDataUri, resolveImageDataUri, type RasterPng } from '@/lib/export/image-raster';
import { renderChartSvg, renderShapeSvg } from '@/lib/export/canvas-html';
import type {
  CanvasDocument,
  CanvasNode,
  NodeStyle,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  TableCell as CanvasTableCell,
  CaptionContent,
  ImageContent,
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

/** exceljs wants 8-digit ARGB; canvas colors are #RRGGBB. */
function argb(hex?: string, alpha = 'FF'): string {
  return alpha + (hex ?? '000000').replace(/^#/, '').trim().toUpperCase().padStart(6, '0').slice(0, 6);
}
/** An SVG string → utf8 data URI (encoded so payload commas don't break the rasterizer split). */
function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const CALLOUT_ARGB: Record<string, { bg: string; fg: string }> = {
  info: { bg: 'FFEFF6FF', fg: 'FF1D4ED8' }, warning: { bg: 'FFFEF3C7', fg: 'FFB45309' },
  tip: { bg: 'FFECFDF5', fg: 'FF047857' }, success: { bg: 'FFECFDF5', fg: 'FF047857' }, note: { bg: 'FFF1F5F9', fg: 'FF475569' },
};

interface SheetCtx { workbook: ExcelJS.Workbook; raster: Map<CanvasNode, RasterPng | null> }

/** Apply the run styling common to every primitive (family/size/bold/italic/underline/strike/color) to a cell. */
function applyRunFont(cell: ExcelJS.Cell, style?: NodeStyle): void {
  if (!style) return;
  const f: Partial<ExcelJS.Font> = { ...(cell.font as ExcelJS.Font) };
  if (style.family) f.name = style.family;
  if (style.size) f.size = style.size;
  if (style.weight === 'bold') f.bold = true;
  if (style.style === 'italic') f.italic = true;
  if (style.underline) f.underline = true;
  if (style.strikethrough) f.strike = true;
  if (style.color) f.color = { argb: argb(style.color) };
  cell.font = f;
}

/** Place a pre-rastered PNG as a floating image over the sheet, reserving rows so
 *  following content doesn't overlap it. */
function placeImage(ws: ExcelJS.Worksheet, workbook: ExcelJS.Workbook, r: RasterPng, maxW = 460): void {
  const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : 1.6;
  const w = Math.min(r.width || maxW, maxW);
  const h = Math.round(w / aspect);
  const id = workbook.addImage({ buffer: r.buffer as unknown as ExcelJS.Buffer, extension: 'png' });
  const top = ws.rowCount;
  ws.addImage(id, { tl: { col: 0.2, row: top + 0.2 }, ext: { width: w, height: h } });
  const reserve = Math.ceil(h / 18) + 1;
  for (let i = 0; i < reserve; i++) ws.addRow([]);
}

/** Get the text value from a TableCell or string. */
function cellText(cell: string | CanvasTableCell): string {
  return typeof cell === 'string' ? cell : cell.text;
}

/** Normalize a string or TableCell to a full TableCell object. */
function resolveTableCell(cell: string | CanvasTableCell): CanvasTableCell {
  return typeof cell === 'string' ? { text: cell } : cell;
}

/** Default Excel number format for a TableCell.cell_type when none is explicit. */
function defaultNumFmt(cellType?: string): string | undefined {
  switch (cellType) {
    case 'currency': return '$#,##0.00';
    case 'percent': return '0.0%';
    case 'number': return '#,##0';
    default: return undefined;
  }
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
  // Flat node view of either shape (a v2 doc's tables live under sections).
  const nodes = docNodes(doc);

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

    // Derive sheet name: prefer sheet_name field, then caption, then default
    const sheetName = sanitizeSheetName(
      tc.sheet_name ?? findCaptionFor(nodes, node) ?? `Sheet ${tableCount}`
    );

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
    headerRow.eachCell((excelCell, colNumber) => {
      excelCell.font = { bold: true, size: 11 };
      excelCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
      excelCell.alignment = { horizontal: 'center', vertical: 'middle' };
      excelCell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };

      // Apply per-cell style overrides from the canvas data
      const resolved = resolveTableCell(tc.headers[colNumber - 1]);
      if (resolved.style?.bg) {
        excelCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF' + resolved.style.bg.replace('#', '') },
        };
      }
      if (resolved.style?.bold !== undefined || resolved.style?.fg) {
        excelCell.font = { ...excelCell.font, ...(resolved.style.bold !== undefined ? { bold: resolved.style.bold } : {}), ...(resolved.style.fg ? { color: { argb: 'FF' + resolved.style.fg.replace('#', '') } } : {}) };
      }
      if (resolved.style?.alignment) {
        excelCell.alignment = { ...excelCell.alignment, horizontal: resolved.style.alignment as 'left' | 'center' | 'right' };
      }
    });

    // Write data rows. Resolve each cell to a live value — an ExcelJS formula
    // object (with a cached result), a number, or text — so cost/budget canvases
    // export as a real spreadsheet model (formulas + currency formats), not just
    // static strings. A plain string / text-only TableCell is unchanged.
    for (const row of tc.rows) {
      const rowValues = row.map((cell) => {
        const r = resolveTableCell(cell);
        if (r.formula) {
          const f = r.formula.replace(/^=/, '');
          return (typeof r.value === 'number'
            ? { formula: f, result: r.value }
            : { formula: f }) as ExcelJS.CellFormulaValue;
        }
        if (typeof r.value === 'number') return r.value;
        return r.text;
      });
      const dataRow = ws.addRow(rowValues);

      dataRow.eachCell((excelCell, colNumber) => {
        excelCell.font = { size: 11 };
        excelCell.alignment = { vertical: 'middle', wrapText: true };
        excelCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        // Apply per-cell number format + style overrides from the canvas data.
        const resolved = resolveTableCell(row[colNumber - 1]);
        const numFmt = resolved.number_format ?? defaultNumFmt(resolved.cell_type);
        if (numFmt) excelCell.numFmt = numFmt;
        const isNumeric =
          resolved.formula != null ||
          typeof resolved.value === 'number' ||
          resolved.cell_type === 'number' ||
          resolved.cell_type === 'currency' ||
          resolved.cell_type === 'percent';
        if (isNumeric && !resolved.style?.alignment) {
          excelCell.alignment = { ...excelCell.alignment, horizontal: 'right', wrapText: false };
        }
        if (resolved.style?.bold || resolved.style?.fg) {
          excelCell.font = { ...excelCell.font, ...(resolved.style.bold ? { bold: true } : {}), ...(resolved.style.fg ? { color: { argb: 'FF' + resolved.style.fg.replace('#', '') } } : {}) };
        }
        if (resolved.style?.bg) {
          excelCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF' + resolved.style.bg.replace('#', '') },
          };
        }
        if (resolved.style?.alignment) {
          excelCell.alignment = { ...excelCell.alignment, horizontal: resolved.style.alignment as 'left' | 'center' | 'right' };
        }
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

    // Pre-rasterize the picture-backed nodes (image / chart / shape) — exceljs has
    // no vector-shape or reliable native-chart primitive, so each embeds as a PNG
    // (the SAME chart/shape SVG the HTML/PDF/docx paths use). Best-effort: a null
    // raster falls back to a text placeholder.
    const raster = new Map<CanvasNode, RasterPng | null>();
    await Promise.all(
      nonTableNodes.filter((n) => n.type === 'image' || n.type === 'chart' || n.type === 'shape').map(async (n) => {
        const uri = n.type === 'image'
          ? await resolveImageDataUri((n.content as ImageContent)?.storage_key)
          : n.type === 'chart'
            ? svgDataUri(renderChartSvg(n.content as ChartContent))
            : svgDataUri(renderShapeSvg(n));
        raster.set(n, await rasterizeDataUri(uri));
      }),
    );

    const ctx: SheetCtx = { workbook, raster };
    for (const node of nonTableNodes) {
      writeNodeToSheet(ws, node, ctx);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Write a non-table node as row(s) in a worksheet. */
function writeNodeToSheet(ws: ExcelJS.Worksheet, node: CanvasNode, ctx: SheetCtx): void {
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

    // image / chart / shape → embed the pre-rastered PNG (fallback: text stub)
    case 'image':
    case 'chart':
    case 'shape': {
      const r = ctx.raster.get(node);
      if (r) { placeImage(ws, ctx.workbook, r, node.type === 'shape' ? 340 : 460); break; }
      const label = node.type === 'chart' ? `[Chart: ${(node.content as ChartContent).chart_type}]`
        : node.type === 'shape' ? `[${(node.content as ShapeContent).shape}]`
          : `[Image: ${(node.content as ImageContent)?.alt_text ?? 'image'}]`;
      ws.addRow([label]).getCell(1).font = { italic: true, color: { argb: 'FF999999' } };
      break;
    }

    case 'text_box': {
      const c = node.content as TextBoxContent;
      const row = ws.addRow([c.text]);
      const cell = row.getCell(1);
      cell.alignment = { wrapText: true, vertical: 'top' };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if (node.style?.fill?.color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(node.style.fill.color) } };
      applyRunFont(cell, node.style);
      break;
    }

    case 'callout': {
      const c = node.content as CalloutContent;
      const pal = CALLOUT_ARGB[c.variant] ?? CALLOUT_ARGB.note;
      if (c.title) {
        const rt = ws.addRow([c.title]).getCell(1);
        rt.font = { bold: true, color: { argb: pal.fg } };
        rt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.bg } };
        rt.border = { left: { style: 'thick', color: { argb: pal.fg } } };
      }
      const rb = ws.addRow([c.text]).getCell(1);
      rb.alignment = { wrapText: true, vertical: 'top' };
      rb.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.bg } };
      rb.border = { left: { style: 'thick', color: { argb: pal.fg } } };
      break;
    }

    case 'code_block': {
      const c = node.content as CodeBlockContent;
      for (const ln of (c.code || ' ').split('\n')) {
        const cell = ws.addRow([ln || ' ']).getCell(1);
        cell.font = { name: 'Courier New', size: 10, color: { argb: 'FFE2E8F0' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      }
      break;
    }

    case 'blockquote': {
      const c = node.content as BlockquoteContent;
      const cell = ws.addRow([c.text]).getCell(1);
      cell.font = { italic: true, color: { argb: 'FF334155' } };
      cell.alignment = { wrapText: true };
      cell.border = { left: { style: 'thick', color: { argb: 'FF1F4E79' } } };
      if (c.cite) ws.addRow([`— ${c.cite}`]).getCell(1).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
      break;
    }

    case 'equation': {
      const c = node.content as EquationContent;
      ws.addRow([c.latex ?? c.mathml ?? '(equation)']).getCell(1).font = { name: 'Cambria Math', italic: true };
      break;
    }

    case 'divider': {
      const c = node.content as DividerContent;
      const cell = ws.addRow(['']).getCell(1);
      cell.border = { bottom: { style: (c.thickness ?? 1) >= 2 ? 'medium' : 'thin', color: { argb: argb(c.color ?? '#CBD5E1') } } };
      break;
    }

    case 'video': {
      const c = node.content as VideoContent;
      const label = '▶ ' + (c.caption ?? c.url ?? 'Video');
      const cell = ws.addRow([label]).getCell(1);
      if (c.url) {
        cell.value = { text: label, hyperlink: c.url } as ExcelJS.CellHyperlinkValue;
        cell.font = { color: { argb: 'FF0066CC' }, underline: true };
      }
      break;
    }

    case 'signature': {
      const c = node.content as SignatureContent;
      if (c.signed && c.signer_name) ws.addRow([c.signer_name]).getCell(1).font = { italic: true, size: 13, color: { argb: 'FF1E3A8A' } };
      ws.addRow(['']).getCell(1).border = { bottom: { style: 'medium', color: { argb: 'FF1E293B' } } };
      ws.addRow([(c.label ?? 'Signature') + (c.signed_at ? `   ·   ${c.signed_at}` : '')]).getCell(1).font = { size: 10, color: { argb: 'FF64748B' } };
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
