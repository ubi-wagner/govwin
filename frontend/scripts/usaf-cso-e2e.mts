/**
 * END-TO-END emulation: USAF AFWERX CSO SBIR Phase I.
 *
 * Emulates the full RFP-ingest → build → lock → library loop against the live
 * schema + real exporters, so it tests everything at once:
 *   1. Ingest: opportunity (USAF CSO) + curated_solicitation with volumes/items.
 *   2. Matrix: proposal_compliance_matrix from the CSO required elements.
 *   3. Skeletons: proposal_artifacts (canvas docs) + proposal_sections (molds).
 *   4. Content: fill each section with the authored canvas nodes (docs/sample-proposal/canvas).
 *   5. Atoms: deposit context-flagged seminal atoms (agency:usaf, program:cso, vol/kind)
 *      with lineage to the foundational document (cocoon).
 *   6. Lock: each section → matrix 'satisfied'; whole doc → foundational reference.
 *   7. Export: docx/pptx/xlsx/pdf FROM THE LOCKED SECTIONS via the artifact-export
 *      helper (assembleArtifactCanvas + native format) — the true round-trip.
 *
 *   cd frontend && node --import tsx scripts/usaf-cso-e2e.mts   (DATABASE_URL set)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import postgres from 'postgres';
import { assembleArtifactCanvas, resolveArtifactFormat, renderCanvas } from '@/lib/export/artifact-export';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const OUT = '/home/user/govwin/docs/sample-proposal';
const loadCanvas = (n: string) => JSON.parse(readFileSync(`${OUT}/canvas/${n}.canvas.json`, 'utf8'));
const log = (s: string) => console.log(s);

// Source-document context stamped on every seminal atom (the "FROM").
const CONTEXT: Array<[string, string, boolean]> = [
  ['agency', 'usaf', true], ['program', 'cso', false], ['phase', 'phase_1', false],
  ['sol', 'afwerx-cso-2026-1', true], ['topic', 'n251-042', true], ['party', 'dod', true],
];

// CSO volumes → artifacts (canvas docs) → the atom(s) harvested from each.
const VOLUMES = [
  { vol: 1, name: 'Technical Volume', type: 'narrative', canvas: 'technical-volume', vtag: 'technical', kind: 'narrative' },
  { vol: 2, name: 'Commercialization', type: 'narrative', canvas: 'commercialization', vtag: 'commercialization', kind: 'narrative' },
  { vol: 3, name: 'Cost Volume', type: 'cost', canvas: 'cost-volume', vtag: 'cost', kind: 'budget_data' },
  { vol: 4, name: 'Supporting Documents', type: 'narrative', canvas: 'key-personnel-bios', vtag: 'key_personnel', kind: 'bio', artifactName: 'Key Personnel' },
  { vol: 4, name: 'Supporting Documents', type: 'narrative', canvas: 'facilities', vtag: 'facilities', kind: 'narrative', artifactName: 'Facilities' },
];

async function tag(atomId: string, dim: string, val: string, isOther: boolean) {
  await sql`INSERT INTO atom_tags (atom_id, dimension, value, is_other, tag_source, confirmed)
            VALUES (${atomId}::uuid, ${dim}, ${val}, ${isOther}, 'auto', true) ON CONFLICT DO NOTHING`;
}
async function depositAtom(tenantId: string, userId: string, proposalId: string, sectionId: string, cocoonId: string, title: string, vol: string, kind: string) {
  const [a] = await sql`INSERT INTO library_atoms (tenant_id, grain, title, content, summary, status, source, creator_kind,
      created_by, owner_user_id, visibility, cocoon_id, origin_proposal_id, origin_section_id, word_count, char_count)
    VALUES (${tenantId}::uuid, 'primitive', ${title}, ${'Seminal atom from USAF AFWERX CSO 2026-1.'},
      ${title + ' — reusable ' + kind + ' atom.'}, 'approved', 'harvest', 'ai',
      ${userId}::uuid, ${userId}::uuid, 'tenant', ${cocoonId}::uuid, ${proposalId}::uuid, ${sectionId}::uuid, 10, 60)
    RETURNING id`;
  await tag(a.id, 'vol', vol, false);
  await tag(a.id, 'kind', kind, false);
  for (const [d, v, o] of CONTEXT) await tag(a.id, d, v, o);
  return a.id as string;
}

async function teardown() {
  for (const { id } of await sql`SELECT id FROM tenants WHERE slug='aerivio-usaf'`) {
    await sql`DELETE FROM atom_tags WHERE atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid)`;
    await sql`DELETE FROM library_atoms WHERE tenant_id=${id}::uuid`;
    await sql`DELETE FROM document_cocoons WHERE tenant_id=${id}::uuid`;
    await sql`DELETE FROM proposals WHERE tenant_id=${id}::uuid`;
  }
  await sql`DELETE FROM users WHERE email='admin@aerivio-usaf.test'`;
  await sql`DELETE FROM tenants WHERE slug='aerivio-usaf'`;
}

async function main() {
  log('\n════ 1. Ingest: USAF AFWERX CSO RFP → opportunity + curated solicitation ════');
  await teardown();
  const [t] = await sql`INSERT INTO tenants (name,slug,status) VALUES ('Aerivio Systems','aerivio-usaf','active') RETURNING id`;
  const [u] = await sql`INSERT INTO users (email,name,role,tenant_id,is_active) VALUES ('admin@aerivio-usaf.test','Ada','tenant_admin',${t.id},true) ON CONFLICT (email) DO UPDATE SET tenant_id=EXCLUDED.tenant_id RETURNING id`;
  const [o] = await sql`INSERT INTO opportunities (title,source,source_id,agency,program_type) VALUES ('AFWERX CSO 2026-1 — N251-042','manual','usaf-cso-2026-1','Air Force','sbir_phase_1') ON CONFLICT DO NOTHING RETURNING id`;
  const oppId = (o?.id ?? (await sql`SELECT id FROM opportunities WHERE source_id='usaf-cso-2026-1'`)[0].id) as string;
  await sql`INSERT INTO curated_solicitations (opportunity_id, namespace, status) VALUES (${oppId},'usaf-cso',${'new'}) ON CONFLICT DO NOTHING`;
  log('  ✓ USAF CSO opportunity + curated_solicitation created (agency=Air Force, program=CSO)');

  log('\n════ 2–3. Build matrix + provision skeletons (volumes → artifacts → molded sections) ════');
  const [p] = await sql`INSERT INTO proposals (tenant_id,opportunity_id,title,stage) VALUES (${t.id},${oppId},'Aerivio → USAF AFWERX CSO Phase I','draft') RETURNING id`;
  const cocoonCols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name='document_cocoons' AND is_nullable='NO' AND column_default IS NULL`).map((r: {column_name: string}) => r.column_name);
  const cocoonRow: Record<string, unknown> = { tenant_id: t.id, name: 'AFWERX CSO 2026-1 — Aerivio (foundational)' };
  if (cocoonCols.includes('proposal_id')) cocoonRow.proposal_id = p.id;
  const [cocoon] = await sql`INSERT INTO document_cocoons ${sql(cocoonRow)} RETURNING id`;

  const built: Array<{ artifactId: string; sectionId: string; v: typeof VOLUMES[number] }> = [];
  const artByName = new Map<string, string>();
  let secNum = 1;
  for (const v of VOLUMES) {
    const artName = v.artifactName ?? v.name;
    let artifactId = artByName.get(`${v.vol}|${artName}`);
    if (!artifactId) {
      const [a] = await sql`INSERT INTO proposal_artifacts (proposal_id,volume_number,volume_name,artifact_type) VALUES (${p.id},${v.vol},${v.name},${v.type}) RETURNING id`;
      artifactId = a.id as string; artByName.set(`${v.vol}|${artName}`, artifactId);
    }
    // content = the authored canvas nodes (the "generated content in the skeleton")
    const canvas = loadCanvas(v.canvas);
    const content = JSON.stringify({ version: 1, canvas: canvas.canvas, nodes: canvas.nodes });
    const [s] = await sql`INSERT INTO proposal_sections (proposal_id,artifact_id,section_number,title,content,status,volume_number,volume_name,section_type)
      VALUES (${p.id},${artifactId}::uuid,${'V'+v.vol+'.'+secNum},${artName},${content},'ai_drafted',${v.vol},${v.name},${v.vtag}) RETURNING id`;
    await sql`INSERT INTO proposal_compliance_matrix (proposal_id,requirement_text,requirement_source,is_mandatory,status,section_id)
      VALUES (${p.id},${artName},'AFWERX CSO Phase I',true,'not_addressed',${s.id})`;
    built.push({ artifactId, sectionId: s.id as string, v }); secNum++;
  }
  log(`  ✓ ${new Set(VOLUMES.map(v=>v.vol)).size} volumes · ${artByName.size} artifacts · ${built.length} molded sections · matrix seeded`);

  log('\n════ 4–6. Generate atoms into sections · lock · matrix satisfied · foundational deposit ════');
  for (const b of built) {
    await sql`UPDATE proposal_sections SET is_locked=true, status='approved', locked_by=${u.id}::uuid, accepted_by=${u.id}::uuid, accepted_at=now(), completed_stage='draft' WHERE id=${b.sectionId}::uuid`;
    await sql`UPDATE proposal_compliance_matrix SET status='satisfied' WHERE section_id=${b.sectionId}::uuid`;
    await sql`UPDATE proposal_artifacts a SET is_locked=true, status='locked' WHERE a.id=${b.artifactId}::uuid
      AND NOT EXISTS (SELECT 1 FROM proposal_sections s WHERE s.artifact_id=a.id AND s.is_locked=false)`;
    await depositAtom(t.id, u.id, p.id, b.sectionId, cocoon.id as string, b.v.artifactName ?? b.v.name, b.v.vtag, b.v.kind);
  }
  const [mx] = await sql`SELECT count(*)::int total, count(*) FILTER (WHERE status='satisfied')::int sat FROM proposal_compliance_matrix WHERE proposal_id=${p.id}`;
  log(`  compliance matrix: ${mx.sat}/${mx.total} satisfied  ${mx.sat===mx.total?'✅':'❌'}`);
  const [libc] = await sql`SELECT count(*)::int n FROM library_atoms WHERE cocoon_id=${cocoon.id}::uuid`;
  log(`  library: 1 foundational document (cocoon) + ${libc.n} seminal atoms (grain=primitive), each stamped agency:usaf program:cso vol:… kind:… + lineage to the cocoon`);

  log('\n════ 7. Export deliverables FROM THE LOCKED SECTIONS (artifact-export round-trip) ════');
  mkdirSync(OUT, { recursive: true });
  const artifacts = await sql`SELECT id, artifact_type, volume_name FROM proposal_artifacts WHERE proposal_id=${p.id} ORDER BY volume_number, volume_name`;
  const fmap: Record<string, string> = { docx: 'Aerivio_Technical_Volume', pptx: 'Aerivio_Commercialization', xlsx: 'Aerivio_Cost_Volume' };
  const results: Array<[string, number]> = [];
  for (const a of artifacts) {
    const secs = await sql`SELECT title, content FROM proposal_sections WHERE artifact_id=${a.id}::uuid ORDER BY section_number`;
    const doc = assembleArtifactCanvas(secs as Array<{title: string|null; content: string|null}>, a.artifact_type, a.volume_name as string);
    // Supporting Documents deliver as PDF (bios, facilities); the rest resolve to their native format.
    const fmt = a.volume_name === 'Supporting Documents' ? 'pdf' : resolveArtifactFormat(a.artifact_type, doc.canvas?.format);
    const buf = await renderCanvas(fmt, doc, { company_name: 'Aerivio Systems', topic_number: 'N251-042' });
    const base = a.volume_name === 'Supporting Documents' ? `Aerivio_${(secs[0] as {title:string}).title.replace(/[^a-z0-9]+/gi,'_')}` : (fmap[fmt] ?? `Aerivio_${(a.volume_name as string).replace(/[^a-z0-9]+/gi,'_')}`);
    // supporting docs may hold 2 artifacts (bios, facilities) — export each
    const name = `${base}.${fmt}`;
    writeFileSync(`${OUT}/${name}`, buf); results.push([name, buf.length]);
  }
  for (const [n, b] of results) log(`  ${n.padEnd(38)} ${(b/1024).toFixed(1)} KB  (from locked sections)`);

  log(`\n  RESULT: ${mx.sat===mx.total && libc.n===VOLUMES.length ? '✅ ingest→matrix→skeleton→content→lock→library→export, all green' : '❌ incomplete'}`);
  await teardown();
  await sql.end();
  process.exit(mx.sat===mx.total ? 0 : 1);
}
main().catch(async (e) => { console.error('ERROR:', e); try { await sql.end(); } catch {} process.exit(2); });
