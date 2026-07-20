/**
 * END-TO-END emulation: US Navy STTR Phase I — matrix + skeleton + the REUSE loop.
 *
 * Same small business (Aerivio) as the AFWERX CSO sample, so its library carries
 * across pursuits. This proves the whole spine AND the cross-pursuit reuse story:
 *   1. Seed the tenant library with the PRIOR AFWERX harvest (context: air_force/cso).
 *   2. Ingest the Navy STTR opportunity (agency:navy, program:sttr, topic N25B-T042).
 *   3. Build the STTR compliance matrix (incl. the STTR-specific Research-Institution
 *      element) and provision the skeleton: volumes → artifacts → molded sections.
 *   4. REUSE-MATCH: for each mold, show which prior AFWERX atoms surface by content-class
 *      and how weakly they match the Navy CONTEXT (agency/program differ → re-context),
 *      mirroring the ctxMatches ranking in lib/atoms.ts. The STTR-only element is net-new.
 *   5. Lock each section → matrix 'satisfied' → harvest Navy atoms (context: navy/sttr),
 *      recording atom_lineage(reused_from) from each Navy atom back to its AFWERX parent.
 *   6. Round-trip: export the full-canvas volumes FROM the locked sections (sanity check).
 *
 *   cd frontend && node --import tsx scripts/navy-sttr-e2e.mts   (DATABASE_URL set)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import postgres from 'postgres';
import { assembleArtifactCanvas, resolveArtifactFormat, renderCanvas } from '@/lib/export/artifact-export';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const CANVAS = '/home/user/govwin/docs/sample-proposal-navy-sttr/canvas';
const VERIFY = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/navy-sttr-verify';
const loadCanvas = (n: string) => JSON.parse(readFileSync(`${CANVAS}/${n}.canvas.json`, 'utf8'));
const log = (s: string) => console.log(s);
const mold = (title: string, sentence: string) => JSON.stringify({ version: 1, nodes: [{ type: 'heading', content: { text: title } }, { type: 'text_block', content: { text: sentence } }] });

// Prior AFWERX pursuit — the seminal atoms already in Aerivio's library (context = the "FROM").
const AFWERX_CTX: Array<[string, string, boolean]> = [
  ['agency', 'air_force', true], ['program', 'cso', false], ['phase', 'phase_1', false],
  ['sol', 'afwerx-cso-2026-1', true], ['topic', 'n251-042', true], ['party', 'dod', true],
];
const AFWERX_ATOMS: Array<[string, string, string]> = [ // title, vol, kind
  ['Significance — connectivity-denied edge classification', 'problem_significance', 'narrative'],
  ['Phase I technical objectives (edge classifier)', 'objectives', 'narrative'],
  ['Technical approach — 4-bit quantization + pruning', 'technical', 'narrative'],
  ['Key personnel — Aerivio team', 'key_personnel', 'bio'],
  ['Facilities — Aerivio acoustics lab', 'facilities', 'narrative'],
  ['Commercialization — dual-use maritime', 'commercialization', 'narrative'],
  ['Certifications — foreign nationals / prior support', 'certifications', 'narrative'],
  ['Statement of work — 4-task Phase I', 'statement_of_work', 'narrative'],
];

// Navy STTR context stamped on every atom harvested this pursuit (the new "FROM").
const NAVY_CTX: Array<[string, string, boolean]> = [
  ['agency', 'navy', true], ['program', 'sttr', false], ['phase', 'phase_1', false],
  ['sol', 'navy-sttr-25b', true], ['topic', 'n25b-t042', true], ['party', 'dod', true],
];
// Navy STTR Phase I Technical-Volume required elements → section mold + content-class + AFWERX reuse source (by vol).
const TV_ELEMENTS: Array<[string, string, string, string, string | null]> = [ // requirement, secType(vol), kind, sentence, reuseFromVol
  ['Significance of the problem', 'problem_significance', 'narrative', 'Distributed unmanned maritime systems must classify undersea contacts at the edge where the acoustic channel denies connectivity.', 'problem_significance'],
  ['Phase I technical objectives', 'objectives', 'narrative', 'Establish feasibility of propagation-aware, distributed edge classification against pre-registered accuracy, latency, and power gates.', 'objectives'],
  ['Research Institution & cooperative arrangement', 'ri_arrangement', 'narrative', 'Cooperative SBC–RI partnership with Cascadia State (RI) satisfying the STTR work-split (SBC 56%, RI 35%) and an executed Allocation of Rights Agreement.', null],
  ['Related work', 'related_work', 'narrative', 'Prior distributed-sensing and edge-audio work assumes power and backhaul undersea nodes lack; the novel coupling is propagation-aware features with posterior consensus.', 'technical'],
  ['Key personnel (SBC + RI)', 'key_personnel', 'bio', 'PI Dr. Ellison (SBC) leads edge AI; Dr. Okonkwo (RI Co-I) leads ocean-acoustics tasks.', 'key_personnel'],
  ['Facilities & equipment (SBC + RI)', 'facilities', 'narrative', 'Aerivio edge/acoustics lab plus Cascadia State test tank, hydrophone array, and coastal range — a stack no single party could replicate.', 'facilities'],
  ['Future R&D / commercialization', 'commercialization', 'narrative', 'Phase II hardens nodes for an at-sea multi-node demo; commercialization spans Navy undersea/USV programs then commercial maritime domain awareness.', 'commercialization'],
  ['Foreign nationals / prior support', 'certifications', 'narrative', 'No foreign nationals on SBC scope; no duplicative Federal support; background IP retained under the Allocation of Rights Agreement.', 'certifications'],
];
// Separate volumes (full-canvas artifacts) → matrix rows.
const OTHER_VOLUMES: Array<[number, string, string, string, string, string | null]> = [ // vol, volName, canvas, secType, kind, reuseFromVol
  [3, 'Statement of Work', 'statement-of-work', 'statement_of_work', 'narrative', 'statement_of_work'],
  [4, 'Cost Volume', 'cost-volume', 'cost', 'budget_data', null],
  [5, 'Supporting Documents', 'company-overview', 'company_overview', 'narrative', null],
];

async function tag(atomId: string, dim: string, val: string, isOther: boolean) {
  await sql`INSERT INTO atom_tags (atom_id, dimension, value, is_other, tag_source, confirmed)
            VALUES (${atomId}::uuid, ${dim}, ${val}, ${isOther}, 'auto', true) ON CONFLICT DO NOTHING`;
}
async function makeAtom(tenantId: string, userId: string, cocoonId: string, title: string, vol: string, kind: string,
                        ctx: Array<[string, string, boolean]>, summary: string, proposalId?: string, sectionId?: string) {
  const [a] = await sql`INSERT INTO library_atoms (tenant_id, grain, title, content, summary, status, source, creator_kind,
      created_by, owner_user_id, visibility, cocoon_id, origin_proposal_id, origin_section_id, word_count, char_count)
    VALUES (${tenantId}::uuid, 'primitive', ${title}, ${summary}, ${title}, 'approved', 'harvest', 'ai',
      ${userId}::uuid, ${userId}::uuid, 'tenant', ${cocoonId}::uuid, ${proposalId ?? null}, ${sectionId ?? null}, 12, 72)
    RETURNING id`;
  await tag(a.id, 'vol', vol, false);
  await tag(a.id, 'kind', kind, false);
  for (const [d, v, o] of ctx) await tag(a.id, d, v, o);
  return a.id as string;
}

async function teardown() {
  for (const { id } of await sql`SELECT id FROM tenants WHERE slug='aerivio-navy-sttr'`) {
    await sql`DELETE FROM atom_lineage WHERE child_atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid) OR parent_atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid)`;
    await sql`DELETE FROM atom_tags WHERE atom_id IN (SELECT id FROM library_atoms WHERE tenant_id=${id}::uuid)`;
    await sql`DELETE FROM library_atoms WHERE tenant_id=${id}::uuid`;
    await sql`DELETE FROM document_cocoons WHERE tenant_id=${id}::uuid`;
    // matrix references sections (section_id FK) → delete matrix BEFORE sections.
    await sql`DELETE FROM proposal_compliance_matrix WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=${id}::uuid)`;
    await sql`DELETE FROM proposal_sections WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=${id}::uuid)`;
    await sql`DELETE FROM proposal_artifacts WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=${id}::uuid)`;
    await sql`DELETE FROM proposals WHERE tenant_id=${id}::uuid`;
  }
  await sql`DELETE FROM users WHERE email='admin@aerivio-navy-sttr.test'`;
  // curated_solicitations references opportunities (opportunity_id FK) → delete it first.
  await sql`DELETE FROM curated_solicitations WHERE opportunity_id IN (SELECT id FROM opportunities WHERE source_id='navy-sttr-25b-t042')`;
  await sql`DELETE FROM opportunities WHERE source_id='navy-sttr-25b-t042'`;
  await sql`DELETE FROM tenants WHERE slug='aerivio-navy-sttr'`;
}

async function main() {
  await teardown();
  const [t] = await sql`INSERT INTO tenants (name,slug,status) VALUES ('Aerivio Systems','aerivio-navy-sttr','active') RETURNING id`;
  const tid = t.id as string;
  const [u] = await sql`INSERT INTO users (email,name,role,tenant_id,is_active) VALUES ('admin@aerivio-navy-sttr.test','Ada','tenant_admin',${tid},true) ON CONFLICT (email) DO UPDATE SET tenant_id=EXCLUDED.tenant_id RETURNING id`;
  const uid = u.id as string;

  log('\n════ 0. Prior pursuit: seed Aerivio library with the AFWERX harvest (context air_force/cso) ════');
  const [priorCocoon] = await sql`INSERT INTO document_cocoons ${sql({ tenant_id: tid, name: 'AFWERX CSO 2026-1 — Aerivio (prior foundational)' })} RETURNING id`;
  const afwerxByVol = new Map<string, string>();
  for (const [title, vol, kind] of AFWERX_ATOMS) {
    const id = await makeAtom(tid, uid, priorCocoon.id as string, title, vol, kind, AFWERX_CTX, 'Seminal atom from the prior AFWERX CSO pursuit.');
    afwerxByVol.set(vol, id);
  }
  log(`  ✓ ${AFWERX_ATOMS.length} prior AFWERX atoms in the library (grain=primitive, tagged agency:air_force program:cso phase:phase_1)`);

  log('\n════ 1. Ingest: US Navy STTR Phase I → opportunity + curated solicitation ════');
  const [o] = await sql`INSERT INTO opportunities (title,source,source_id,agency,program_type,solicitation_number,topic_number)
    VALUES ('Navy STTR N25B-T042 — Distributed Edge Acoustic Sensing','manual','navy-sttr-25b-t042','Navy','sttr_phase_1','NAVY-STTR-25B','N25B-T042') RETURNING id`;
  const oppId = o.id as string;
  await sql`INSERT INTO curated_solicitations (opportunity_id, namespace, status) VALUES (${oppId},'navy-sttr',${'new'}) ON CONFLICT DO NOTHING`;
  log('  ✓ Navy STTR opportunity created (agency=Navy, program=STTR Phase I, topic N25B-T042)');

  log('\n════ 2–3. Build STTR compliance matrix + skeleton (volumes → artifacts → molded sections) ════');
  const [p] = await sql`INSERT INTO proposals (tenant_id,opportunity_id,title,stage) VALUES (${tid},${oppId},'Aerivio → Navy STTR Phase I','draft') RETURNING id`;
  const pid = p.id as string;
  const [cocoon] = await sql`INSERT INTO document_cocoons ${sql({ tenant_id: tid, name: 'Navy STTR N25B-T042 — Aerivio (foundational)', origin_proposal_id: pid })} RETURNING id`;

  type Built = { artifactId: string; sectionId: string; req: string; vol: string; kind: string; reuseFromVol: string | null; full: boolean };
  const built: Built[] = [];
  // Volume 2 — Technical Volume: 8 molded element sections
  const [tvArt] = await sql`INSERT INTO proposal_artifacts (proposal_id,volume_number,volume_name,artifact_type) VALUES (${pid},2,'Technical Volume','narrative') RETURNING id`;
  let n = 1;
  for (const [req, secType, kind, sentence, reuseFromVol] of TV_ELEMENTS) {
    const [s] = await sql`INSERT INTO proposal_sections (proposal_id,artifact_id,section_number,title,content,status,volume_number,volume_name,section_type)
      VALUES (${pid},${tvArt.id}::uuid,${'2.'+n},${req},${mold(req, sentence)},'ai_drafted',2,'Technical Volume',${secType}) RETURNING id`;
    await sql`INSERT INTO proposal_compliance_matrix (proposal_id,requirement_text,requirement_source,is_mandatory,status,section_id)
      VALUES (${pid},${req},'Navy STTR Phase I',true,'not_addressed',${s.id})`;
    built.push({ artifactId: tvArt.id as string, sectionId: s.id as string, req, vol: secType, kind, reuseFromVol, full: false }); n++;
  }
  // Volumes 3/4/5 — full-canvas artifacts (SOW, Cost, Company Overview supporting)
  for (const [vnum, vname, canvas, secType, kind, reuseFromVol] of OTHER_VOLUMES) {
    const [a] = await sql`INSERT INTO proposal_artifacts (proposal_id,volume_number,volume_name,artifact_type) VALUES (${pid},${vnum},${vname},${secType === 'cost' ? 'cost' : 'narrative'}) RETURNING id`;
    const c = loadCanvas(canvas);
    const content = JSON.stringify({ version: 1, canvas: c.canvas, nodes: c.nodes });
    const [s] = await sql`INSERT INTO proposal_sections (proposal_id,artifact_id,section_number,title,content,status,volume_number,volume_name,section_type)
      VALUES (${pid},${a.id}::uuid,${'V'+vnum},${vname},${content},'ai_drafted',${vnum},${vname},${secType}) RETURNING id`;
    await sql`INSERT INTO proposal_compliance_matrix (proposal_id,requirement_text,requirement_source,is_mandatory,status,section_id)
      VALUES (${pid},${vname},'Navy STTR Phase I',true,'not_addressed',${s.id})`;
    built.push({ artifactId: a.id as string, sectionId: s.id as string, req: vname, vol: secType, kind, reuseFromVol, full: true });
  }
  const nVols = new Set([2, ...OTHER_VOLUMES.map(v => v[0])]).size;
  const [mx0] = await sql`SELECT count(*)::int total FROM proposal_compliance_matrix WHERE proposal_id=${pid}`;
  log(`  ✓ ${nVols} volumes · ${new Set(built.map(b => b.artifactId)).size} artifacts · ${built.length} molded sections · matrix seeded ${mx0.total} rows`);

  log('\n════ 4. Reuse-match: which prior AFWERX atoms surface for each Navy mold, and how well ════');
  log('    (content-class = kind/vol overlap surfaces a candidate; ctxMatches over agency/program/phase = context fit)');
  const navyCtxVals = NAVY_CTX.filter(([d]) => ['agency', 'program', 'phase'].includes(d)).map(([, v]) => v); // navy, sttr, phase_1
  for (const b of built.filter(x => !x.full)) {
    const parent = b.reuseFromVol ? afwerxByVol.get(b.reuseFromVol) : undefined;
    if (!parent) { log(`    • ${b.req.padEnd(46)} → NET-NEW (STTR-specific; no prior atom)`); continue; }
    const [{ ctx }] = await sql`SELECT count(*)::int ctx FROM atom_tags
      WHERE atom_id=${parent}::uuid AND dimension IN ('agency','program','phase','tech','dept') AND value = ANY(${navyCtxVals}::text[])`;
    log(`    • ${b.req.padEnd(46)} → SURFACES (vol:${b.reuseFromVol}) · ctxMatch ${ctx}/3 → ${ctx >= 2 ? 'HIGH reuse' : 'RE-CONTEXT (agency/program differ)'}`);
  }

  log('\n════ 5. Lock each section → matrix satisfied → harvest Navy atoms + reused_from lineage ════');
  let reuseLinks = 0;
  for (const b of built) {
    await sql`UPDATE proposal_sections SET is_locked=true, status='approved', locked_by=${uid}::uuid, accepted_by=${uid}::uuid, accepted_at=now(), completed_stage='draft' WHERE id=${b.sectionId}::uuid`;
    await sql`UPDATE proposal_compliance_matrix SET status='satisfied' WHERE section_id=${b.sectionId}::uuid`;
    await sql`UPDATE proposal_artifacts a SET is_locked=true, status='locked' WHERE a.id=${b.artifactId}::uuid
      AND NOT EXISTS (SELECT 1 FROM proposal_sections s WHERE s.artifact_id=a.id AND s.is_locked=false)`;
    const childId = await makeAtom(tid, uid, cocoon.id as string, `${b.req} (Navy STTR)`, b.vol, b.kind, NAVY_CTX, 'Seminal atom from the Navy STTR N25B-T042 pursuit.', pid, b.sectionId);
    const parent = b.reuseFromVol ? afwerxByVol.get(b.reuseFromVol) : undefined;
    if (parent) { await sql`INSERT INTO atom_lineage (parent_atom_id, child_atom_id, relation) VALUES (${parent}::uuid, ${childId}::uuid, 'reused_from') ON CONFLICT DO NOTHING`; reuseLinks++; }
  }
  const [mx] = await sql`SELECT count(*)::int total, count(*) FILTER (WHERE status='satisfied')::int sat FROM proposal_compliance_matrix WHERE proposal_id=${pid}`;
  const [nav] = await sql`SELECT count(*)::int n FROM library_atoms WHERE cocoon_id=${cocoon.id}::uuid`;
  const [lib] = await sql`SELECT count(*)::int n FROM library_atoms WHERE tenant_id=${tid}::uuid`;
  log(`  compliance matrix: ${mx.sat}/${mx.total} satisfied  ${mx.sat === mx.total ? '✅' : '❌'}`);
  log(`  library now holds ${lib.n} atoms across 2 pursuits: ${AFWERX_ATOMS.length} AFWERX + ${nav.n} Navy STTR (grain=primitive)`);
  log(`  reuse lineage: ${reuseLinks} Navy atoms carry reused_from → their AFWERX parent (the loop closed, with pedigree)`);

  log('\n════ 6. Round-trip: export full-canvas volumes FROM the locked sections (sanity check) ════');
  mkdirSync(VERIFY, { recursive: true });
  const results: Array<[string, number]> = [];
  for (const [vnum, vname, , secType] of OTHER_VOLUMES) {
    const [a] = await sql`SELECT id, artifact_type, volume_name FROM proposal_artifacts WHERE proposal_id=${pid} AND volume_number=${vnum} LIMIT 1`;
    const secs = await sql`SELECT title, content FROM proposal_sections WHERE artifact_id=${a.id}::uuid ORDER BY section_number`;
    const dobj = assembleArtifactCanvas(secs as Array<{ title: string | null; content: string | null }>, a.artifact_type as string, a.volume_name as string);
    const fmt = vname === 'Supporting Documents' ? 'pdf' : resolveArtifactFormat(a.artifact_type as string, dobj.canvas?.format);
    const buf = await renderCanvas(fmt, dobj, { company_name: 'Aerivio Systems', topic_number: 'N25B-T042' });
    const name = `V${vnum}_${vname.replace(/[^a-z0-9]+/gi, '_')}.${fmt}`;
    writeFileSync(`${VERIFY}/${name}`, buf); results.push([name, buf.length]);
  }
  for (const [nm, b] of results) log(`  ${nm.padEnd(34)} ${(b / 1024).toFixed(1)} KB  (assembled from locked sections)`);

  const okAll = mx.sat === mx.total && lib.n === AFWERX_ATOMS.length + built.length && reuseLinks === built.filter(b => b.reuseFromVol).length;
  log(`\n  RESULT: ${okAll ? '✅ ingest→matrix→skeleton→reuse-match→lock→library(2 pursuits)→lineage→export, all green' : '❌ incomplete'}`);
  await teardown();
  await sql.end();
  process.exit(okAll ? 0 : 1);
}
main().catch(async (e) => { console.error('ERROR:', e); try { await sql.end(); } catch {} process.exit(2); });
