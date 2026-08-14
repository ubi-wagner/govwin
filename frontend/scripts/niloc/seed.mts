/**
 * Seed the NILOC Technologies gold-example library (idempotent).
 *
 * Prereq: the NILOC tenant (slug 'niloc') + Eric Wagner (eric.c.wagner@gmail.com) with a
 * tenant_admin membership must already exist — created through the product's normal onboarding
 * (comp-code purchase → tenant) or the demo provisioning. Identity/auth is the product's job;
 * this script only loads the gold content. It exits(2) with instructions if the tenant is absent.
 *
 * Loads (each step skipped if already present):
 *   1. Company foundation atoms — Eric's CEO bio + NILOC capability statement.
 *   2. The prose proposals (PROSE_DOCS: Phase I & II technical, CSO brief, NSF pitch, NASA) →
 *      tenant_documents + decompose→library.
 *   3. The cost volumes (COST_SPECS: 24-mo, base+option, single-period) → tenant_documents + library.
 *
 * Usage: cd frontend && DATABASE_URL=… node --import tsx scripts/niloc/seed.mts
 */
import { sql } from '@/lib/db';
import { createAtom } from '@/lib/atoms';
import { decomposeAndIngest } from '@/lib/library/foundation';
import type { CanvasDocument, CanvasNode, CanvasSection } from '@/lib/types/canvas-document';
import type { ArtifactForm } from '@/lib/library/artifact-canvas';
import { COST_SPECS, PROSE_DOCS, buildFilledCost, costPrice, proseDoc, proseExistsOnDisk, readProse } from './_shared.mts';

const BIO = `Eric Wagner is the Founder and Chief Executive Officer of NILOC Technologies, the parent company of RFP Pipeline. He leads NILOC's strategy of licensing federally-developed technologies and maturing them into warfighter and dual-use products, and serves as Principal Investigator and technical lead on the company's development efforts. Eric architected RFP Pipeline — an AI-native platform that turns federal solicitations (SBIR, STTR, BAA, OTA, CSO, and grants) into submission-ready, compliance-checked proposals through a multi-agent AI workforce, a unified document-canvas system, and an automated compliance spine. He brings deep, hands-on expertise in federal contracting and proposal compliance, applied artificial intelligence and large-language-model systems, and the end-to-end commercialization of emerging technology.`;
const CAP = `NILOC Technologies is a small business that licenses federally-developed innovations and matures them into fielded products. NILOC partners with DoD laboratories and the federal technology-transfer ecosystem (TechLink and lab T2 offices) to identify lab-proven technology, de-risk it under SBIR/STTR and BAA/OTA vehicles, and commercialize it for defense and dual-use markets. Core competencies: federal technology transfer & licensing to commercialization; RF/electromagnetics; computer vision & AI/ML; autonomy & systems; advanced materials; and AI-accelerated proposal development and program execution via the RFP Pipeline platform. Differentiators: a licensing-and-commercialization model that starts from lab-validated IP (lower technical risk, faster to a credible Phase II); AI-native execution; small-business agility with a research-institution and prime partnering network. Primary NAICS 541715; also 541511, 334511, 334220. CAGE 8NLC7; UEI K9NLC7X2M4Q8 (illustrative — replace with SAM values before submission).`;

async function docExists(tenantId: string, title: string): Promise<boolean> {
  const r = await sql`SELECT 1 FROM tenant_documents WHERE tenant_id = ${tenantId}::uuid AND title = ${title} LIMIT 1`;
  return r.length > 0;
}
async function atomExists(tenantId: string, title: string): Promise<boolean> {
  const r = await sql`SELECT 1 FROM library_atoms WHERE tenant_id = ${tenantId}::uuid AND title = ${title} AND archived_at IS NULL LIMIT 1`;
  return r.length > 0;
}
// wrap a workbook's flat nodes into sections (one per heading) for landing
function wrapSections(doc: CanvasDocument): CanvasSection[] {
  const nodes = (doc.nodes ?? []) as CanvasNode[];
  const sections: CanvasSection[] = []; let cur: CanvasNode[] = []; let title: string | undefined;
  const flush = () => { if (cur.length) sections.push({ id: crypto.randomUUID(), title, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes: cur }] }); };
  for (const n of nodes) { if (n.type === 'heading') { flush(); cur = [n]; title = (n.content as { text?: string })?.text; } else cur.push(n); }
  flush(); return sections;
}
async function landDoc(tenantId: string, actorId: string, doc: CanvasDocument, sections: CanvasSection[], title: string, docType: string, form: ArtifactForm, kind: string) {
  const documentId = doc.document_id;
  const flat = sections.reduce((a, s) => a + s.groups.reduce((g, grp) => g + grp.nodes.length, 0), 0);
  await sql`INSERT INTO tenant_documents (id, tenant_id, title, doc_type, canvas, node_count, version, created_by)
            VALUES (${documentId}::uuid, ${tenantId}::uuid, ${title}, ${docType}, ${sql.json(doc as never)}, ${flat}, 1, ${actorId}::uuid)`;
  const d = await decomposeAndIngest(tenantId, doc, { title, slug: documentId.slice(0, 8), form, kind, context: 'defense' }, { id: actorId });
  return { documentId, foundationId: d.foundationId, sections: sections.length, atoms: d.atomIds.length };
}

async function main() {
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'niloc' AND status = 'active' LIMIT 1`;
  const [user] = await sql`SELECT id FROM users WHERE email = 'eric.c.wagner@gmail.com' LIMIT 1`;
  if (!tenant || !user) {
    console.error('✗ NILOC tenant (slug=niloc) or Eric Wagner (eric.c.wagner@gmail.com) not found.');
    console.error('  Create them first via product onboarding, then re-run. Identity/auth is not seeded here.');
    await sql.end(); process.exit(2);
  }
  const tenantId = tenant.id as string, actorId = user.id as string;
  const actor = { id: actorId, kind: 'admin' as const };

  // 1. company atoms (idempotent)
  if (!(await atomExists(tenantId, 'NILOC Technologies — capability statement'))) {
    await createAtom(tenantId, { grain: 'foundation', title: 'Eric Wagner — Founder & CEO (bio)', content: BIO, summary: 'CEO bio / key personnel', source: 'manual', status: 'approved', tags: [{ dimension: 'kind', value: 'key_personnel', source: 'admin', confirmed: true }, { dimension: 'context', value: 'company', source: 'admin', confirmed: true }] }, actor);
    await createAtom(tenantId, { grain: 'foundation', title: 'NILOC Technologies — capability statement', content: CAP, summary: 'Company overview / capability', source: 'manual', status: 'approved', tags: [{ dimension: 'kind', value: 'narrative', source: 'admin', confirmed: true }, { dimension: 'context', value: 'company', source: 'admin', confirmed: true }] }, actor);
    console.log('  seeded company atoms (bio + capability)');
  } else console.log('  company atoms already present — skipped');

  // 2. prose proposals (all forms)
  for (const p of PROSE_DOCS) {
    if (!proseExistsOnDisk(p.file)) { console.log(`  DOC  ${p.tag.padEnd(13)} (${p.file}) missing on disk — skipped`); continue; }
    if (await docExists(tenantId, p.title)) { console.log(`  DOC  ${p.tag.padEnd(13)} already present — skipped`); continue; }
    const doc = proseDoc(readProse(p.file), p.title);
    const l = await landDoc(tenantId, actorId, doc, doc.sections!, p.title, p.docType, 'doc' as ArtifactForm, 'document');
    console.log(`  DOC  ${p.tag.padEnd(13)} → doc ${l.documentId.slice(0, 8)} · ${l.sections} sec · ${l.atoms} atoms`);
  }

  // 3. cost volumes
  for (const spec of COST_SPECS) {
    if (await docExists(tenantId, spec.title)) { console.log(`  COST ${spec.tag.padEnd(13)} already present — skipped`); continue; }
    const flat = buildFilledCost(spec);
    const secs = wrapSections(flat);
    const documentId = crypto.randomUUID();                   // workbook's own id is a slug; land under a real UUID
    const landed: CanvasDocument = { version: 2, document_id: documentId, canvas: flat.canvas, sections: secs, metadata: { ...flat.metadata, last_modified_by: actorId, status: 'ai_drafted' } };
    const l = await landDoc(tenantId, actorId, landed, secs, spec.title, 'cost_volume', 'sheet' as ArtifactForm, 'cost_volume');
    console.log(`  COST ${spec.tag.padEnd(13)} price $${Math.round(costPrice(flat, spec.periods.length)).toLocaleString()} → doc ${l.documentId.slice(0, 8)} · ${l.sections} sec`);
  }

  const [{ n }] = await sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id = ${tenantId}::uuid AND archived_at IS NULL`;
  console.log(`done — NILOC library atoms: ${n}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
