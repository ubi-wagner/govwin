/**
 * Seed a small slide-format tenant_document (for SLIDES-clean live verification).
 * Creates a 3-slide 16:9 deck owned by the Foundation tenant + prints its edit URL.
 *
 *   cd frontend && node --import tsx scripts/seed-slide-deck.mts
 */
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel');

const node = (id: string, type: CanvasNode['type'], content: Record<string, unknown>, style: Record<string, unknown> = {}): CanvasNode =>
  ({ id, type, content, style, provenance: { source: 'manual' }, history: [], library_eligible: false } as unknown as CanvasNode);

async function main() {
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation' LIMIT 1`;
  const [user] = await sql`SELECT id FROM users WHERE email = 'kate.ulepic@foundation3dp.com' LIMIT 1`;
  if (!tenant || !user) throw new Error('tenant/user not found');

  const docId = randomUUID();
  const slide = (n: number, title: string, body: string): CanvasNode[] => [
    node(`h${n}`, 'heading', { level: 1, text: title }, { color: '1F4E79' }),
    node(`t${n}`, 'text_block', { text: body }),
  ];
  const nodes: CanvasNode[] = [
    ...slide(1, 'Foundation 3DP — Company Overview', 'On-site 3D concrete printing for residential foundations. TRL 6–7, Ohio (Dayton region).'),
    node('pb1', 'page_break', {}),
    ...slide(2, 'The Problem', 'Temporary formwork costs $20k–$25k and ~336 labor hours per home — a chronic source of schedule slip.'),
    node('pb2', 'page_break', {}),
    ...slide(3, 'Our Approach', 'Print the foundation-wall shape directly from a downloaded plan — ~47% cost reduction, eleven days faster per home.'),
  ];

  const canvas: CanvasDocument = {
    version: 1,
    document_id: docId,
    canvas: { ...CANVAS_PRESETS.slide_cso },
    nodes,
    metadata: {
      title: 'Foundation 3DP — Overview Deck', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: new Date().toISOString(), last_modified_at: new Date().toISOString(), last_modified_by: String(user.id),
      version_number: 1, status: 'draft',
    } as CanvasDocument['metadata'],
  };

  await sql`
    INSERT INTO tenant_documents (id, tenant_id, title, doc_type, canvas, node_count, version, created_by)
    VALUES (${docId}::uuid, ${tenant.id}::uuid, 'Foundation 3DP — Overview Deck', 'slide_deck',
            ${sql.json(canvas as unknown as Parameters<typeof sql.json>[0])}, ${nodes.length}, 1, ${user.id}::uuid)
    ON CONFLICT (id) DO UPDATE SET canvas = EXCLUDED.canvas`;

  console.log(`SEEDED_DOC_ID=${docId}`);
  console.log(`URL=/portal/foundation/documents/${docId}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
