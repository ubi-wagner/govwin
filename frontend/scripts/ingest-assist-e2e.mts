/** Drive-test the Ingest Assist materializer (default + multi-topic) vs the sandbox. */
import { sql } from '@/lib/db';
import { parseSolicitation } from '@/lib/ingest/parse-solicitation';
import { materializeSkeleton } from '@/lib/ingest/materialize';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
let fail = 0; const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) fail++; };
const NOW = new Date().toISOString();
const opps: string[] = []; const sols: string[] = [];
try {
  const [o] = await sql<{ id: string }[]>`INSERT INTO opportunities (source, source_id, title, agency, program_type, is_active) VALUES ('ingest','TEST-INGEST-UMBRELLA','Test Ingest Solicitation','Navy','sbir_phase_1', true) RETURNING id`;
  opps.push(o.id);
  const [cs] = await sql<{ id: string }[]>`INSERT INTO curated_solicitations (opportunity_id, namespace, status, full_text) VALUES (${o.id}::uuid,'test-ingest','new','') RETURNING id`;
  sols.push(cs.id);

  const parsed = await parseSolicitation('', { agency: 'Navy' });
  ok('parse → default skeleton (no key)', parsed.source === 'default' && parsed.volumes.length === 6);

  const r1 = await materializeSkeleton(cs.id, parsed, { publish: true, nowIso: NOW });
  ok('materialize single-topic (umbrella)', r1.volumes === 6 && r1.items === 22 && r1.cards >= 1, `${r1.volumes}v ${r1.items}i ${r1.cards}c`);

  const res = await resolveTopicCompliance(o.id);
  const items = res.volumes.reduce((s, v) => s + (v.items?.length ?? 0), 0);
  ok('resolves for provision', res.volumes.length === 6 && items === 22, `${res.volumes.length}v ${items}i, cap ${(res.compliance as { pageLimitTechnical?: number }).pageLimitTechnical}`);

  const multi = { ...parsed, topics: [
    { code: 'TEST-INGEST-T1', title: 'Topic One', agency: 'Navy', programType: 'sbir_phase_1', techFocusAreas: ['A'] },
    { code: 'TEST-INGEST-T2', title: 'Topic Two', agency: 'Navy', programType: 'sbir_phase_1', techFocusAreas: ['B'] },
  ]};
  const r2 = await materializeSkeleton(cs.id, multi, { publish: true, nowIso: NOW });
  ok('materialize multi-topic → suite of cards', r2.topics === 2 && r2.cards >= 2, `${r2.topics} topics, ${r2.cards} cards`);
  (await sql<{ id: string }[]>`SELECT id FROM opportunities WHERE source='ingest' AND source_id IN ('TEST-INGEST-T1','TEST-INGEST-T2')`).forEach((x) => opps.push(x.id));
} finally {
  for (const id of opps) { await sql`DELETE FROM tenant_opportunity_cards WHERE opportunity_id=${id}::uuid`; await sql`DELETE FROM opportunity_bridge WHERE opportunity_id=${id}::uuid`; }
  for (const s of sols) { await sql`DELETE FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE solicitation_id=${s}::uuid)`; await sql`DELETE FROM solicitation_volumes WHERE solicitation_id=${s}::uuid`; await sql`DELETE FROM solicitation_compliance WHERE solicitation_id=${s}::uuid`; await sql`DELETE FROM curated_solicitations WHERE id=${s}::uuid`; }
  for (const id of opps) { await sql`DELETE FROM opportunities WHERE id=${id}::uuid`; }
  await sql.end();
}
console.log(`\n${fail === 0 ? '✅ INGEST-ASSIST MATERIALIZER VERIFIED (default + multi-topic)' : '❌ ' + fail + ' failed'}`);
process.exit(fail ? 1 : 0);
