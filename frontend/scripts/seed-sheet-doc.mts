/**
 * Seed a spreadsheet-format tenant_document (a small cost table) for SHEETS-clean review.
 *   cd frontend && node --import tsx scripts/seed-sheet-doc.mts
 */
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel');

async function main() {
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation' LIMIT 1`;
  const [user] = await sql`SELECT id FROM users WHERE email = 'kate.ulepic@foundation3dp.com' LIMIT 1`;
  const docId = randomUUID();

  const table: CanvasNode = {
    id: 'sheet1', type: 'table',
    content: {
      sheet_name: 'Budget',
      headers: ['Cost Element', 'Base Rate', 'Hours', 'Direct Cost', 'Fringe %'],
      rows: [
        [{ text: 'Principal Investigator' }, { text: '185', value: 185, kind: 'currency' }, { text: '320', value: 320 }, { text: '59200', value: 59200, kind: 'currency' }, { text: '0.32', value: 0.32 }],
        [{ text: 'Research Engineer' }, { text: '120', value: 120, kind: 'currency' }, { text: '480', value: 480 }, { text: '57600', value: 57600, kind: 'currency' }, { text: '0.32', value: 0.32 }],
        [{ text: 'Materials & Printing' }, { text: '', }, { text: '' }, { text: '42000', value: 42000, kind: 'currency' }, { text: '' }],
        [{ text: 'TOTAL', style: { bold: true } }, { text: '' }, { text: '' }, { text: '=D2+D3+D4', formula: '=D2+D3+D4', style: { bold: true } }, { text: '' }],
      ],
    } as unknown as CanvasNode['content'],
    style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
  } as unknown as CanvasNode;

  const canvas: CanvasDocument = {
    version: 1, document_id: docId,
    canvas: { ...CANVAS_PRESETS.spreadsheet },
    nodes: [table],
    metadata: { title: 'Foundation TVSF — Cost Workbook', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: new Date().toISOString(), last_modified_at: new Date().toISOString(), last_modified_by: String(user.id), version_number: 1, status: 'draft' } as CanvasDocument['metadata'],
  };

  await sql`
    INSERT INTO tenant_documents (id, tenant_id, title, doc_type, canvas, node_count, version, created_by)
    VALUES (${docId}::uuid, ${tenant.id}::uuid, 'Foundation TVSF — Cost Workbook', 'cost_volume',
            ${sql.json(canvas as unknown as Parameters<typeof sql.json>[0])}, 1, 1, ${user.id}::uuid)`;
  console.log(`SEEDED_DOC_ID=${docId}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
