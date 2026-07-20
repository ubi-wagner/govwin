/**
 * TIER 2 DRIVE-TEST — standalone documents (#3/#4), against the live sandbox schema
 * and the REAL product functions (starterFromTemplate / starterFromPreset /
 * exportToDocx) + the EXACT SQL the routes run.
 *
 * Self-seeds two template fixtures (a body-carrying tenant template + an
 * outline-only "system" template) so it is hermetic. Proves: the templates LIST
 * query returns them; create-from-template resolves BOTH the body path and the
 * outline-scaffold path; create-blank works; the optimistic-locked save advances
 * the version and a stale save conflicts; export yields a real .docx; and a
 * second tenant sees zero (tenant isolation).
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/tier2-documents-e2e.mts
 */
import { sql } from '@/lib/db';
import { starterFromTemplate, starterFromPreset, countNodes, type TemplateRow } from '@/lib/documents/starter';
import { exportToDocx } from '@/lib/export/docx-exporter';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';

let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const createdDocs: string[] = [];
const createdTpls: string[] = [];

const LETTER_PRESET = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 10 },
  line_spacing: 1.0, max_pages: 15, max_slides: null,
};

try {
  // ── Fixtures: a tenant, a member user, a second tenant for isolation ──
  const tenants = await sql<{ id: string; slug: string; name: string }[]>`
    SELECT id, slug, name FROM tenants WHERE status != 'suspended' ORDER BY created_at LIMIT 2`;
  ok('found at least one tenant', tenants.length >= 1, `${tenants.length} tenant(s)`);
  if (tenants.length === 0) throw new Error('no tenants seeded');
  const tenant = tenants[0];
  const otherTenant = tenants[1] ?? null;

  const [user] = await sql<{ id: string }[]>`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  ok('found a user for created_by', !!user);

  // ── Seed two template fixtures ──────────────────────────────────────
  // A: a tenant-EXTRACTED template carrying a real body (nodes).
  const bodyCanvas = {
    version: 1, document_id: 'tpl-body', canvas: LETTER_PRESET,
    nodes: [
      { id: 'n1', type: 'heading', content: { level: 2, text: 'Technical Approach' }, style: {}, provenance: { source: 'template' }, history: [], library_eligible: true },
      { id: 'n2', type: 'text_block', content: { text: 'Our approach delivers the capability with low technical risk.' }, style: {}, provenance: { source: 'template' }, history: [], library_eligible: true },
    ],
    metadata: { title: 'Body tpl', status: 'empty' },
  };
  const [tplA] = await sql<{ id: string }[]>`
    INSERT INTO document_templates (name, description, template_type, canvas_preset, canvas_document, node_count, is_system, tenant_id, created_by, metadata)
    VALUES ('E2E Body Template', 'body', 'technical_volume',
            ${sql.json(LETTER_PRESET)}, ${sql.json(bodyCanvas)}, 2, false, ${tenant.id}::uuid, ${user.id}::uuid, '{}'::jsonb)
    RETURNING id`;
  createdTpls.push(tplA.id);

  // B: an outline-only "system" template (metadata.sections names, empty body).
  const [tplB] = await sql<{ id: string }[]>`
    INSERT INTO document_templates (name, description, template_type, canvas_preset, canvas_document, node_count, is_system, created_by, metadata)
    VALUES ('E2E Outline Template', 'outline', 'technical_volume',
            ${sql.json(LETTER_PRESET)}, '{}'::jsonb, 0, true, ${user.id}::uuid,
            ${sql.json({ sections: ['Cover Page', 'Technical Approach', 'Key Personnel', 'Cost Summary'] })})
    RETURNING id`;
  createdTpls.push(tplB.id);
  ok('seeded 2 template fixtures', createdTpls.length === 2);

  // ── #4: the templates LIST query the GET route runs ──────────────────
  const list = await sql`
    SELECT id, name, template_type, is_system,
           (tenant_id = ${tenant.id}::uuid) AS is_mine,
           (
             COALESCE(jsonb_array_length(canvas_document->'nodes'), 0) > 0
             OR COALESCE(jsonb_array_length(canvas_document->'sections'), 0) > 0
           ) AS has_body,
           CASE WHEN jsonb_typeof(metadata->'sections') = 'array' THEN metadata->'sections' ELSE '[]'::jsonb END AS sections
    FROM document_templates
    WHERE (tenant_id = ${tenant.id}::uuid OR is_system = true)
    ORDER BY is_mine DESC, is_system DESC, name ASC`;
  ok('templates LIST returns the fixtures', list.length >= 2, `${list.length} templates`);
  // rows arrive camelCase (@/lib/db transform): is_mine→isMine, has_body→hasBody
  const rowA = list.find((t: Record<string, unknown>) => t.id === tplA.id) as Record<string, unknown>;
  const rowB = list.find((t: Record<string, unknown>) => t.id === tplB.id) as Record<string, unknown>;
  ok('body template flagged hasBody + isMine', rowA?.hasBody === true && rowA?.isMine === true);
  ok('outline template flagged NOT hasBody, sections previewed', rowB?.hasBody === false && Array.isArray(rowB?.sections) && (rowB.sections as unknown[]).length === 4);

  // ── #3a: create FROM the body template (route logic + exact INSERT) ──
  const [tplFull] = await sql<TemplateRow[]>`
    SELECT id, name, template_type, canvas_preset, canvas_document, metadata
    FROM document_templates WHERE id = ${tplA.id}::uuid LIMIT 1`;
  const docId = randomUUID();
  const starter = starterFromTemplate(tplFull, { documentId: docId, actorId: user.id });
  const nodeCount = countNodes(starter.canvas);
  ok('starterFromTemplate (body) flattened to editable nodes', nodeCount === 2, `format=${starter.canvas.canvas.format}, nodes=${nodeCount}, type=${starter.docType}`);
  ok('starter canvas is v1 flat (no section layer)', starter.canvas.sections === undefined && starter.canvas.document_id === docId);

  const [insDoc] = await sql<{ id: string; version: number; nodeCount: number }[]>`
    INSERT INTO tenant_documents (id, tenant_id, title, doc_type, canvas, source_template_id, node_count, version, created_by)
    VALUES (${docId}::uuid, ${tenant.id}::uuid, ${starter.title}, ${starter.docType},
            ${sql.json(starter.canvas as unknown as Parameters<typeof sql.json>[0])},
            ${tplFull.id}::uuid, ${nodeCount}, 1, ${user.id}::uuid)
    RETURNING id, version, node_count`;
  createdDocs.push(insDoc.id);
  ok('INSERT from template succeeded', insDoc?.nodeCount === 2, `version=${insDoc.version}, node_count=${insDoc.nodeCount}`);

  // read-back (the editor page's load query), tenant-scoped
  const [readBack] = await sql<{ canvas: CanvasDocument; status: string }[]>`
    SELECT canvas, status FROM tenant_documents WHERE id = ${docId}::uuid AND tenant_id = ${tenant.id}::uuid LIMIT 1`;
  ok('read-back tenant-scoped returns the doc', !!readBack, `status=${readBack?.status}`);
  ok('read-back canvas is an object (not a char-iterated string)', typeof readBack.canvas === 'object' && !!readBack.canvas.canvas && Array.isArray(readBack.canvas.nodes));
  // lineage: source_template_id must actually persist (was silently NULL with a
  // conditional-fragment cast — switched to an unconditional `${id}::uuid`).
  const [lineage] = await sql<{ stid: string | null }[]>`SELECT source_template_id::text AS stid FROM tenant_documents WHERE id = ${docId}::uuid`;
  ok('source_template_id lineage persisted', lineage.stid === tplA.id, `stored=${lineage.stid}`);

  // ── #3b: create FROM the outline template → heading scaffold ──
  const outDocId = randomUUID();
  const [tplBFull] = await sql<TemplateRow[]>`
    SELECT id, name, template_type, canvas_preset, canvas_document, metadata FROM document_templates WHERE id = ${tplB.id}::uuid LIMIT 1`;
  const outStarter = starterFromTemplate(tplBFull, { documentId: outDocId, actorId: user.id });
  ok('starterFromTemplate (outline) scaffolds one heading per section', countNodes(outStarter.canvas) === 4 && outStarter.canvas.nodes.every((n) => n.type === 'heading'),
    `nodes=${countNodes(outStarter.canvas)}`);

  // ── save: optimistic lock advances version; a stale base conflicts ──
  const edited = { ...readBack.canvas, metadata: { ...readBack.canvas.metadata, title: 'Renamed via save' } };
  const save1 = await sql`
    UPDATE tenant_documents SET canvas = ${sql.json(edited as unknown as Parameters<typeof sql.json>[0])},
      title = 'Renamed via save', node_count = ${countNodes(edited)}, version = 2, updated_at = now()
    WHERE id = ${docId}::uuid AND version = 1`;
  ok('save with baseVersion=1 advances to v2', save1.count === 1);
  const staleSave = await sql`
    UPDATE tenant_documents SET title = 'should not apply', version = 2 WHERE id = ${docId}::uuid AND version = 1`;
  ok('stale save (baseVersion=1 again) conflicts (0 rows)', staleSave.count === 0);
  const [afterTitle] = await sql<{ title: string; version: number }[]>`SELECT title, version FROM tenant_documents WHERE id = ${docId}::uuid`;
  ok('title reflects the winning save', afterTitle.title === 'Renamed via save', `title="${afterTitle.title}", v=${afterTitle.version}`);

  // ── export: real .docx from the stored canvas ──
  const docxBuf = await exportToDocx(readBack.canvas, { company_name: tenant.name ?? 'Your Company', topic_number: 'TBD' });
  const isZip = docxBuf.length > 2000 && docxBuf[0] === 0x50 && docxBuf[1] === 0x4b; // 'PK'
  ok('exportToDocx produced a real .docx (PK zip)', isZip, `${docxBuf.length} bytes`);
  writeFileSync('/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/tier2-from-template.docx', docxBuf);

  // ── #3c: create BLANK (flier preset) ──
  const flierId = randomUUID();
  const flier = starterFromPreset('flier', { documentId: flierId, actorId: user.id });
  const [insFlier] = await sql<{ id: string }[]>`
    INSERT INTO tenant_documents (id, tenant_id, title, doc_type, canvas, node_count, version, created_by)
    VALUES (${flierId}::uuid, ${tenant.id}::uuid, ${flier.title}, ${flier.docType},
            ${sql.json(flier.canvas as unknown as Parameters<typeof sql.json>[0])}, 0, 1, ${user.id}::uuid)
    RETURNING id`;
  createdDocs.push(insFlier.id);
  ok('INSERT blank flier (single-page letter)', flier.canvas.canvas.format === 'letter' && flier.canvas.canvas.max_pages === 1);

  // ── tenant isolation: the other tenant sees zero of our docs ──
  if (otherTenant) {
    const [leak] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tenant_documents WHERE id = ${docId}::uuid AND tenant_id = ${otherTenant.id}::uuid`;
    ok('second tenant cannot see the document (isolation)', leak.n === 0);
  } else {
    console.log('… only one tenant present — isolation asserted structurally by the tenant_id predicate');
  }

  // ── the documents-page listing query ──
  const pageList = await sql`
    SELECT id FROM tenant_documents WHERE tenant_id = ${tenant.id}::uuid ORDER BY updated_at DESC LIMIT 100`;
  ok('documents-page listing returns our docs', pageList.length >= 2, `${pageList.length} docs`);
} finally {
  if (createdDocs.length) await sql`DELETE FROM tenant_documents WHERE id = ANY(${createdDocs}::uuid[])`;
  if (createdTpls.length) await sql`DELETE FROM document_templates WHERE id = ANY(${createdTpls}::uuid[])`;
  console.log(`\ncleaned up ${createdDocs.length} document(s) + ${createdTpls.length} template fixture(s)`);
  await sql.end();
}

console.log(`\n${failures === 0 ? '✅ ALL TIER-2 DRIVE-TEST CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
