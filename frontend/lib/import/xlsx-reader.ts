import ExcelJS from 'exceljs';
import { createNode, type CanvasNode } from '@/lib/types/canvas-document';
import type { ImportResult, ImportedAtom } from './types';
import { inferCategoryFromFilename } from './types';

const SYSTEM_ACTOR = { id: 'system:import', name: 'Document Import' };

/** Best-effort text of an exceljs cell value (handles formulas, rich text, links). */
function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return o.result == null ? '' : String(o.result);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    if ('text' in o) return String(o.text ?? '');
    return '';
  }
  return String(v);
}

/**
 * Parse a .xlsx buffer → one ImportedAtom per non-empty worksheet, each a heading
 * (sheet name) + a table node (row 1 = headers, remainder = rows). Lets a proposal
 * package's cost volume atomize instead of silently returning nothing.
 */
export async function readXlsx(buffer: Buffer, filename: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs types want the older Buffer shape; our Node Buffer is structurally fine.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const atoms: ImportedAtom[] = [];
  let charOffset = 0;
  let totalChars = 0;
  const cat = inferCategoryFromFilename(filename);
  const suggestedCategory = cat.confidence > 0.4 ? cat.category : 'cost_volume';

  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const vals = (Array.isArray(row.values) ? row.values.slice(1) : []).map(cellText);
      if (vals.some((c) => c.trim())) rows.push(vals);
    });
    if (rows.length === 0) continue;

    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => r.concat(Array(Math.max(0, width - r.length)).fill(''));
    const headers = pad(rows[0] ?? []);
    const body = rows.slice(1).map(pad);

    const nodes: CanvasNode[] = [
      createNode({ type: 'heading', content: { level: 2, text: ws.name }, source: 'imported', actorId: SYSTEM_ACTOR.id, actorName: SYSTEM_ACTOR.name }),
      createNode({ type: 'table', content: { headers, rows: body }, source: 'imported', actorId: SYSTEM_ACTOR.id, actorName: SYSTEM_ACTOR.name }),
    ];
    const text = [ws.name, ...rows.map((r) => r.join(' '))].join('\n');
    totalChars += text.length;
    atoms.push({
      nodes,
      suggestedCategory,
      suggestedTags: [`sheet:${ws.name}`, `source:${filename}`],
      headingText: ws.name,
      charOffset,
      charLength: text.length,
      confidence: 0.6,
    });
    charOffset += text.length + 1;
  }

  return { atoms, sourceFilename: filename, sourceFormat: 'xlsx', totalChars, metadata: {} };
}
