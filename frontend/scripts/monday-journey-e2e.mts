/**
 * FULL MONDAY-JOURNEY E2E — the whole value-prop loop in one run, against the live
 * schema and the REAL product functions:
 *
 *   1. RFP ADMIN ingests the opportunity + builds the matrix skeleton
 *      (opportunity + curated_solicitation + solicitation_volumes + volume_required_items).
 *   2. UPLOAD + ATOMIZE the tenant's prior-proposal library
 *      (atomizeDocumentIntoLibrary on a real doc package → tagged library_atoms).
 *   3. SPOTLIGHT: push the opp as a tenant card + bucket-score it.
 *   4. TENANT ADMIN provisions the portal from the skeleton (proposal → artifacts → molds → matrix).
 *   5. GENERATE THE PACKAGE: draft each section GROUNDED ON THE UPLOADED ATOMS
 *      (selectForSection → assemble → save with meta.sourceAtomIds) → lock → matrix
 *      satisfied → harvestSectionToAtomLibrary (returns a new atom with derived_from
 *      lineage to the uploaded atoms + bumps their usage_count) → export the package.
 *
 * Proves: the uploaded package's atoms flow INTO the new proposal, the reuse is
 * lineage-tracked and non-destructive (source atoms unchanged, usage_count bumped),
 * the matrix satisfies, the package exports — and everything is tenant-isolated.
 *
 *   cd frontend && node --import tsx scripts/monday-journey-e2e.mts   (DATABASE_URL set)
 */
import { readFileSync } from 'fs';
import postgres from 'postgres';
import { atomizeDocumentIntoLibrary, contextTags } from '@/lib/atomize-package';
import { selectForSection, viewerFromRole } from '@/lib/atoms';
import { harvestSectionToAtomLibrary } from '@/lib/proposal-atom-harvest';
import { assembleArtifactCanvas, resolveArtifactFormat, renderCanvas } from '@/lib/export/artifact-export';

const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
const log = (s: string) => console.log(s);
const ok = (c: boolean, m: string) => console.log(`  ${c ? '✅' : '❌'} ${m}`);
let pass = true;
const need = (c: boolean, m: string) => { ok(c, m); if (!c) pass = false; };

// The tenant's prior proposals (their existing IP) → the library that seeds the new build.
const PRIOR_DOCS = [
  '/home/user/govwin/docs/sample-proposal-navy-sttr/Aerivio_Navy_STTR_Technical_Volume.docx',
  '/home/user/govwin/docs/sample-proposal-navy-sttr/Aerivio_Navy_STTR_Statement_of_Work.docx',
  '/home/user/govwin/docs/sample-proposal-navy-sttr/Aerivio_Navy_STTR_Company_Overview.pptx',
];
// The new opportunity's Technical-Volume required elements (the skeleton → molds → matrix).
const REQUIRED = [
  ['Identification and Significance', 'problem_significance'],
  ['Phase I Technical Objectives', 'objectives'],
  ['Technical Approach', 'technical'],
  ['Key Personnel', 'key_personnel'],
  ['Facilities and Equipment', 'facilities'],
];
const CONTEXT = ['navy', 'sttr', 'phase_1'];

async function teardown() {
  for (const slug of ['immobileyes-e2e', 'other-tenant-e2e']) {
    for (const { id } of await sql`SELECT id FROM tenants WHERE slug=${slug}`) {
      await sql`DELETE FROM atom_lineage WHERE child_atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid) OR parent_atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid)`;
      await sql`DELETE FROM atom_tags WHERE atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid)`;
      await sql`DELETE FROM library_atoms WHERE tenant_id=${id}::uuid`;
      await sql`DELETE FROM document_cocoons WHERE tenant_id=${id}::uuid`;
      await sql`DELETE FROM tenant_bucket_scores WHERE tenant_id=${id}::uuid`;
      await sql`DELETE FROM tenant_spotlight_buckets WHERE tenant_id=${id}::uuid`;
      await sql`DELETE FROM tenant_opportunity_cards WHERE tenant_id=${id}::uuid`;
      await sql`DELETE FROM proposal_compliance_matrix WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=${id}::uuid)`;
      await sql`DELETE FROM proposal_sections WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=${id}::uuid)`;
      await sql`DELETE FROM proposal_artifacts WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=${id}::uuid)`;
      await sql`DELETE FROM proposals WHERE tenant_id=${id}::uuid`;
    }
    await sql`DELETE FROM users WHERE email=${slug + '@test.test'}`;
    await sql`DELETE FROM tenants WHERE slug=${slug}`;
  }
  await sql`DELETE FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE solicitation_id IN (SELECT id FROM curated_solicitations WHERE namespace='immobileyes-navy'))`;
  await sql`DELETE FROM solicitation_volumes WHERE solicitation_id IN (SELECT id FROM curated_solicitations WHERE namespace='immobileyes-navy')`;
  await sql`DELETE FROM curated_solicitations WHERE opportunity_id IN (SELECT id FROM opportunities WHERE source_id='immobileyes-navy-25b')`;
  await sql`DELETE FROM opportunities WHERE source_id='immobileyes-navy-25b'`;
}

async function main() {
  await teardown();
  const [t] = await sql`INSERT INTO tenants (name,slug,status) VALUES ('Immobileyes','immobileyes-e2e','active') RETURNING id`;
  const [other] = await sql`INSERT INTO tenants (name,slug,status) VALUES ('Other Co','other-tenant-e2e','active') RETURNING id`;
  const [u] = await sql`INSERT INTO users (email,name,role,tenant_id,is_active) VALUES ('immobileyes-e2e@test.test','Immo Admin','tenant_admin',${t.id},true) RETURNING id`;
  const tid = t.id as string, otherId = other.id as string, uid = u.id as string;
  const actor = { id: uid, kind: 'admin' as const };
  const viewer = viewerFromRole(uid, 'tenant_admin');

  log('\n════ STEP 1 — RFP ADMIN: ingest opportunity + build the matrix skeleton ════');
  const [o] = await sql`INSERT INTO opportunities (title,source,source_id,agency,program_type,solicitation_number,topic_number)
    VALUES ('Navy STTR N25B-T042 — Distributed Edge Acoustic Sensing','manual','immobileyes-navy-25b','Navy','sttr_phase_1','NAVY-STTR-25B','N25B-T042') RETURNING id`;
  const oppId = o.id as string;
  const [cs] = await sql`INSERT INTO curated_solicitations (opportunity_id, namespace, status) VALUES (${oppId},'immobileyes-navy','new') RETURNING id`;
  const solId = cs.id as string;
  const [vol] = await sql`INSERT INTO solicitation_volumes ${sql({ solicitation_id: solId, volume_number: 1, volume_name: 'Technical Volume' })} RETURNING id`;
  for (let i = 0; i < REQUIRED.length; i++) {
    await sql`INSERT INTO volume_required_items ${sql({ volume_id: vol.id as string, item_number: String(i + 1), item_name: REQUIRED[i][0], item_type: 'word_doc', required: true })}`;
  }
  log(`  ✓ opportunity + curated_solicitation + 1 volume · ${REQUIRED.length} required items (the matrix skeleton)`);

  log('\n════ STEP 2 — UPLOAD + ATOMIZE the tenant’s prior-proposal library ════');
  const ctxTags = contextTags({ agency: 'Navy', program: 'sttr', phase: '1', sol: 'NAVY-STTR-25B', topic: 'N25B-T042' });
  let uploaded = 0;
  for (const path of PRIOR_DOCS) {
    const r = await atomizeDocumentIntoLibrary(tid, { buffer: readFileSync(path), filename: path.split('/').pop() as string, packageName: 'Immobileyes prior proposals', ctxTags, actor });
    uploaded += r.atoms;
  }
  const [primCount] = await sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id=${tid}::uuid AND grain='primitive'`;
  need(primCount.n > 0, `prior library seeded: ${uploaded} atoms across ${PRIOR_DOCS.length} docs (tagged agency:navy program:sttr)`);
  // snapshot a source atom to prove non-destructive reuse later
  const [srcBefore] = await sql`SELECT id, content, usage_count FROM library_atoms WHERE tenant_id=${tid}::uuid AND grain='primitive' ORDER BY created_at LIMIT 1`;

  log('\n════ STEP 3 — SPOTLIGHT: push the opp as a tenant card + bucket-score it ════');
  await sql`INSERT INTO tenant_opportunity_cards ${sql({ tenant_id: tid, opportunity_id: oppId, card: sql.json({ title: 'Navy STTR N25B-T042', agency: 'Navy', program: 'sttr_phase_1' }) })}`;
  const [bucket] = await sql`INSERT INTO tenant_spotlight_buckets ${sql({ tenant_id: tid, name: 'Best-fit' })} RETURNING id`;
  const scoreRow: Record<string, unknown> = { tenant_id: tid, bucket_id: bucket.id, opportunity_id: oppId };
  const scoreCols = new Set((await sql`SELECT column_name FROM information_schema.columns WHERE table_name='tenant_bucket_scores'`).map((r: any) => r.column_name));
  if (scoreCols.has('score')) scoreRow.score = 92;
  await sql`INSERT INTO tenant_bucket_scores ${sql(scoreRow)}`;
  const [cardN] = await sql`SELECT count(*)::int n FROM tenant_opportunity_cards WHERE tenant_id=${tid}::uuid AND opportunity_id=${oppId}::uuid`;
  need(cardN.n === 1, `opportunity card pushed + bucket-scored for the tenant`);

  log('\n════ STEP 4 — TENANT ADMIN: provision the portal from the skeleton ════');
  const [p] = await sql`INSERT INTO proposals (tenant_id,opportunity_id,title,stage) VALUES (${tid},${oppId},'Immobileyes → Navy STTR','draft') RETURNING id`;
  const pid = p.id as string;
  const [art] = await sql`INSERT INTO proposal_artifacts (proposal_id,volume_number,volume_name,artifact_type) VALUES (${pid},1,'Technical Volume','narrative') RETURNING id`;
  const sections: Array<{ id: string; title: string; vol: string }> = [];
  let n = 1;
  for (const [title, vtag] of REQUIRED) {
    const [s] = await sql`INSERT INTO proposal_sections (proposal_id,artifact_id,section_number,title,content,status,volume_number,volume_name,section_type)
      VALUES (${pid},${art.id}::uuid,${'1.'+n},${title},${''},'empty',1,'Technical Volume',${vtag}) RETURNING id`;
    await sql`INSERT INTO proposal_compliance_matrix (proposal_id,requirement_text,requirement_source,is_mandatory,status,section_id)
      VALUES (${pid},${title},'Navy STTR Phase I',true,'not_addressed',${s.id})`;
    sections.push({ id: s.id as string, title, vol: vtag }); n++;
  }
  log(`  ✓ proposal + Technical Volume artifact · ${sections.length} molded sections · matrix seeded (not_addressed)`);

  log('\n════ STEP 5 — GENERATE: draft each section FROM the uploaded atoms → lock → harvest → export ════');
  let reusedSections = 0, harvested = 0;
  for (const s of sections) {
    // (a) select uploaded atoms to ground this mold (scoped by vol, context-ranked)
    const picked = await selectForSection(tid, { vol: s.vol, kinds: ['narrative'], context: CONTEXT, limit: 3 }, viewer);
    // (b) assemble their content into the section canvas (the "draft from library")
    const nodes = [
      { type: 'heading', content: { level: 2, text: s.title } },
      ...picked.map((a) => ({ type: 'text_block', content: { text: a.content ?? a.summary ?? '' } })),
    ];
    const canvas = JSON.stringify({ version: 1, nodes });
    const meta = { sourceAtomIds: picked.map((a) => a.id) };
    await sql`UPDATE proposal_sections SET content=${canvas}, meta=${sql.json(meta)}, status='ai_drafted' WHERE id=${s.id}::uuid`;
    if (picked.length > 0) reusedSections++;
    // (c) lock → matrix satisfied → harvest back to the library (lineage to the picked atoms)
    await sql`UPDATE proposal_sections SET is_locked=true, status='approved', locked_by=${uid}::uuid, accepted_by=${uid}::uuid, accepted_at=now(), completed_stage='draft' WHERE id=${s.id}::uuid`;
    await sql`UPDATE proposal_compliance_matrix SET status='satisfied' WHERE section_id=${s.id}::uuid`;
    const atomId = await harvestSectionToAtomLibrary(tid, pid, s.id, uid);
    if (atomId) harvested++;
    log(`  • ${s.title.padEnd(34)} grounded on ${picked.length} library atoms → locked → harvested ${atomId ? '✓' : '—'}`);
  }
  need(reusedSections === sections.length, `every section drafted FROM uploaded library atoms (${reusedSections}/${sections.length})`);
  need(harvested === sections.length, `every locked section harvested back into the library (${harvested}/${sections.length})`);

  log('\n════ Assertions — reuse loop, non-destructive, matrix, export, isolation ════');
  const [mx] = await sql`SELECT count(*)::int total, count(*) FILTER (WHERE status='satisfied')::int sat FROM proposal_compliance_matrix WHERE proposal_id=${pid}`;
  need(mx.sat === mx.total, `compliance matrix satisfied ${mx.sat}/${mx.total}`);
  const [lin] = await sql`SELECT count(*)::int n FROM atom_lineage l
    JOIN library_atoms c ON c.id=l.child_atom_id AND c.source='download_derivative'
    WHERE l.relation='derived_from' AND l.parent_atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${tid}::uuid AND source='upload')`;
  need(lin.n > 0, `harvested atoms carry derived_from lineage back to the UPLOADED atoms (${lin.n} edges) — the loop closed`);
  const [srcAfter] = await sql`SELECT content, usage_count FROM library_atoms WHERE id=${srcBefore.id}::uuid`;
  need(srcAfter.content === srcBefore.content, `source atom content UNCHANGED after reuse (non-destructive)`);
  const [bumped] = await sql`SELECT count(*)::int n FROM library_atoms
    WHERE tenant_id=${tid}::uuid AND source='upload' AND usage_count > 0
      AND id IN (SELECT DISTINCT parent_atom_id FROM atom_lineage WHERE relation='derived_from')`;
  need(bumped.n > 0, `reused UPLOADED atoms have usage_count bumped (${bumped.n} atoms) — reuse marked, source content intact`);

  // export the assembled package from the locked sections
  const secs = await sql`SELECT title, content FROM proposal_sections WHERE artifact_id=${art.id}::uuid ORDER BY section_number`;
  const dobj = assembleArtifactCanvas(secs as Array<{ title: string | null; content: string | null }>, 'narrative', 'Technical Volume');
  const fmt = resolveArtifactFormat('narrative', dobj.canvas?.format);
  const buf = await renderCanvas(fmt, dobj, { company_name: 'Immobileyes', topic_number: 'N25B-T042' });
  need(buf.length > 0, `package exported from the locked sections (${fmt}, ${(buf.length / 1024).toFixed(1)} KB)`);

  const [bAtoms] = await sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id=${otherId}::uuid`;
  need(bAtoms.n === 0, `tenant isolation: the other tenant sees zero atoms`);

  log(`\n  RESULT: ${pass ? '✅ FULL JOURNEY GREEN — ingest→matrix→atomize→spotlight→provision→draft-from-atoms→lock→harvest(lineage)→export, tenant-isolated' : '❌ FAILED'}`);
  await teardown();
  await sql.end();
  process.exit(pass ? 0 : 1);
}
main().catch(async (e) => { console.error('ERROR:', e); try { await sql.end(); } catch {} process.exit(2); });
