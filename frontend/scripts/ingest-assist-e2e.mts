/** Drive-test the Ingest Assist materializer (default + multi-topic) vs the sandbox. */
import { sql, sqlBypass } from '@/lib/db';
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
  /**
   * `sqlBypass` FOR THE CARDS, and that is not a style choice — it is the difference between this
   * cleanup working and silently doing nothing.
   *
   * `tenant_opportunity_cards` is FORCE-RLS. This script holds no tenant context, so under
   * `govtech_app` the tenant-equality policy matches NOTHING and the DELETE removes zero rows
   * WITHOUT ERROR. `opportunities` and `opportunity_bridge` carry no RLS, so those two lines worked
   * — which is the worst possible combination: the opportunity and its bridge rows went, the cards
   * did not, and every future run of `bridge-buckets` failed on
   *
   *     ✗ no product-made card exists without a bridge event behind it
   *
   * Seven orphaned cards across four tenants, pointing at an opportunity that no longer exists.
   * Deleting across tenants is exactly what the bypass connection is for.
   *
   * Matched by SOURCE PATTERN rather than only by the ids collected in `opps`: a run that throws
   * before line 31 never collects the topic ids, so an id-only cleanup leaves residue behind
   * precisely when the drive failed — the moment cleanup matters most.
   */
  await sqlBypass`
    DELETE FROM tenant_opportunity_cards
     WHERE opportunity_id IN (SELECT id FROM opportunities
                               WHERE source = 'ingest' AND source_id LIKE 'TEST-INGEST-%')`;

  /**
   * AND THE CARDS WHOSE PARENT IS ALREADY GONE — which neither delete above can see.
   *
   * Both paths reach a card THROUGH `opportunities`: the subquery just above, and the by-id loop
   * just below. So the moment an earlier run deleted the opportunity while leaving its cards
   * (which is exactly what happened before the `sqlBypass` fix — the card DELETE matched zero rows
   * under RLS and raised nothing), those cards became permanently unreachable by this cleanup. The
   * fix stopped NEW debris and could not touch the old, so `bridge-buckets` kept failing on 21
   * cards dated days earlier, and would have gone on failing forever on every environment that had
   * ever run the broken version.
   *
   * Source-fixed-data-left, in the cleanup whose whole job is to leave nothing behind.
   *
   * Matched on the ORPHAN property rather than the fixture name: a card pointing at an opportunity
   * that does not exist is unreachable by every product path — it can never be re-scored, updated
   * or re-pushed — so removing it is safe regardless of which run created it. Restricted to
   * `bridge_version > 0` for the same reason the drive's own assertion is: a directly-seeded
   * fixture card declaring 0 is not claiming a bridge event and is not debris.
   */
  const stranded = await sqlBypass`
    DELETE FROM tenant_opportunity_cards c
     WHERE c.bridge_version > 0
       AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = c.opportunity_id)
     RETURNING c.id`;
  if (stranded.length) console.log(`  · swept ${stranded.length} stranded card(s) from an earlier run`);
  for (const id of opps) { await sqlBypass`DELETE FROM tenant_opportunity_cards WHERE opportunity_id=${id}::uuid`; await sql`DELETE FROM opportunity_bridge WHERE opportunity_id=${id}::uuid`; }
  for (const s of sols) { await sql`DELETE FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE solicitation_id=${s}::uuid)`; await sql`DELETE FROM solicitation_volumes WHERE solicitation_id=${s}::uuid`; await sql`DELETE FROM solicitation_compliance WHERE solicitation_id=${s}::uuid`; await sql`DELETE FROM curated_solicitations WHERE id=${s}::uuid`; }
  for (const id of opps) { await sql`DELETE FROM opportunities WHERE id=${id}::uuid`; }

  /**
   * SCORES LAST — because the line above is what strands them.
   *
   * The card sweep near the top of this cleanup catches cards orphaned by an EARLIER run. Scores
   * are different: `tenant_bucket_scores` rows for THIS run's fixtures are perfectly valid right
   * up until the statement above removes their opportunity, so a sweep placed with the card sweep
   * sees nothing and the drive then creates the very orphans it just checked for. Measured, not
   * reasoned: that ordering left 15 stranded scores behind a card sweep reporting success.
   *
   * Unconditional, and after every delete that can strand one.
   */
  const strandedScores = await sqlBypass`
    DELETE FROM tenant_bucket_scores s
     WHERE NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.id = s.opportunity_id)
     RETURNING s.id`;
  if (strandedScores.length) console.log(`  · swept ${strandedScores.length} stranded score(s)`);
  await sql.end();
}
console.log(`\n${fail === 0 ? '✅ INGEST-ASSIST MATERIALIZER VERIFIED (default + multi-topic)' : '❌ ' + fail + ' failed'}`);
process.exit(fail ? 1 : 0);
