/**
 * drive-curated-ranking — an admin marks a passage, and a tenant's lens finds the opportunity.
 *
 * The whole model in one pass, on real machinery:
 *
 *     rfp_admin highlights a sentence in the solicitation
 *       → the annotation stores the EXCERPT, not just an anchor
 *       → the push fans it onto every tenant's mirror card
 *       → the generated tsvector indexes it
 *       → a bucket whose keyword appears ONLY in that highlight scores the card above zero
 *
 * This is the claim that replaced "rank the whole solicitation". It is worth driving rather than
 * asserting, because every hop in it was connected by code review and none of it had ever carried a
 * real highlight — `solicitation_annotations` has been empty since migration 009.
 *
 * ── AND IT IS RED FIRST, IN THE ONLY WAY THAT COUNTS HERE ────────────────────────────────────
 * Step 1 scores the bucket BEFORE the highlight exists and requires a ZERO. A drive that only
 * showed the green would not distinguish "the highlight did it" from "the card already matched".
 *
 * ⚠️ NOT read-only: creates one annotation, republishes the opportunity, creates and deletes one
 * bucket. Sandbox only; it removes what it made.
 *
 * Usage:  node --import tsx frontend/scripts/drive-curated-ranking.mts
 */

import postgres from 'postgres';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

// A term that appears in NO card on this box, so a hit can only have come from the highlight.
const NEEDLE = 'hydrostatic';
const PASSAGE =
  'Offerors shall describe the hydrostatic test regime used to qualify each pressure vessel, '
  + 'including the acceptance criteria applied at Phase II transition.';

async function main() {
  console.log('\ndrive-curated-ranking — a curator marks a passage, a lens finds the opportunity\n');

  const { publishAndFanOut } = await import('../lib/opportunity-bridge.ts');
  const { rankBucket } = await import('../lib/bucket-ranking.ts');

  const [target] = await owner<Array<{ solId: string; opportunityId: string; title: string; tenantId: string; slug: string }>>`
    SELECT o.solicitation_id AS sol_id, o.id AS opportunity_id, o.title, c.tenant_id, t.slug
    FROM opportunities o
    JOIN tenant_opportunity_cards c ON c.opportunity_id = o.id AND c.archived_at IS NULL
    JOIN tenants t ON t.id = c.tenant_id
    WHERE o.solicitation_id IS NOT NULL
    ORDER BY o.created_at LIMIT 1`;
  if (!target) { console.error('HARNESS CANNOT RUN: no card-bearing opportunity'); process.exit(2); }
  const [actor] = await owner<Array<{ id: string }>>`
    SELECT id FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active ORDER BY created_at LIMIT 1`;
  if (!actor) { console.error('HARNESS CANNOT RUN: no platform admin'); process.exit(2); }

  console.log(`  opportunity: ${target.title?.slice(0, 56)}`);
  console.log(`  tenant     : ${target.slug}`);
  console.log(`  needle     : "${NEEDLE}" — chosen because no card on this box contains it\n`);

  let bucketId: string | null = null;
  let annotationId: string | null = null;
  try {
    // ── 0 · The needle really is absent ──────────────────────────────────────────────────────
    const [pre] = await owner<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards
      WHERE archived_at IS NULL AND card_tsv @@ websearch_to_tsquery('english', ${NEEDLE})`;
    ok(`no existing card matches "${NEEDLE}"`, Number(pre.n) === 0, `${pre.n} card(s)`);
    if (Number(pre.n) !== 0) {
      console.error('\n  HARNESS REFUSES A VERDICT: the needle already matches, so a green below is unearned.');
      process.exit(2);
    }

    // ── 1 · RED — a lens for it finds nothing ────────────────────────────────────────────────
    console.log('\n1 · RED — a lens for that term, before the curator marks anything');
    const [b] = await owner<Array<{ id: string }>>`
      INSERT INTO tenant_spotlight_buckets (tenant_id, name, criteria, is_active)
      VALUES (${target.tenantId}::uuid, ${'drive: hydrostatic qualification'},
              ${owner.json({ keywords: [NEEDLE], useTimeline: false } as never)}, true)
      RETURNING id`;
    bucketId = b.id;
    await rankBucket(target.tenantId, bucketId, Date.now());
    const scoreNow = async () => {
      const [r] = await owner<Array<{ score: number; factors: string }>>`
        SELECT score, factors::text FROM tenant_bucket_scores
        WHERE bucket_id = ${bucketId}::uuid AND opportunity_id = ${target.opportunityId}::uuid`;
      return r;
    };
    const before = await scoreNow();
    ok('the opportunity scores ZERO', Number(before?.score ?? -1) === 0, `score ${before?.score} · ${before?.factors}`);

    // ── 2 · The curator marks the passage ────────────────────────────────────────────────────
    console.log('\n2 · the curator highlights a sentence (through the real tool)');
    const { solicitationSaveAnnotationTool } = await import('../lib/tools/solicitation-save-annotation.ts');
    // Called the way the curation workspace calls it: the excerpt rides INSIDE the anchor, and no
    // top-level `text` — the shape that made the first implementation write NULL for every real
    // annotation while its own tests passed.
    const res = await solicitationSaveAnnotationTool.handler(
      {
        solicitationId: target.solId,
        kind: 'compliance_tag',
        sourceLocation: { page: 31, offset: 1200, length: PASSAGE.length, excerpt: PASSAGE, method: 'manual_selection' },
        payload: {},
      } as never,
      { actor: { id: actor.id, role: 'rfp_admin', email: 'drive@local' } } as never,
    );
    annotationId = (res as { id: string }).id;
    const [stored] = await owner<Array<{ excerpt: string | null }>>`
      SELECT excerpt FROM solicitation_annotations WHERE id = ${annotationId}::uuid`;
    ok('the annotation stored the EXCERPT, not just the anchor',
      (stored?.excerpt ?? '').includes(NEEDLE), stored?.excerpt ? `${stored.excerpt.slice(0, 44)}…` : 'NULL');

    // ── 3 · It crosses the bridge ────────────────────────────────────────────────────────────
    console.log('\n3 · the push carries it to every tenant mirror');
    const pushed = await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());
    ok('published and fanned out', !!pushed, pushed ? `v${pushed.event.version} → ${pushed.tenantsApplied} tenant(s)` : 'null');
    const [carried] = await owner<Array<{ n: number; sample: string | null }>>`
      SELECT count(*)::int AS n, min(card->'highlights'->0->>'text') AS sample
      FROM tenant_opportunity_cards
      WHERE opportunity_id = ${target.opportunityId}::uuid
        AND jsonb_array_length(COALESCE(card->'highlights','[]'::jsonb)) > 0`;
    ok('every holder\'s card carries the highlight', Number(carried.n) > 0, `${carried.n} card(s)`);
    ok('with the passage itself, readable without the document',
      (carried.sample ?? '').includes(NEEDLE), carried.sample ? `${carried.sample.slice(0, 44)}…` : 'absent');

    // ── 4 · The index picks it up ────────────────────────────────────────────────────────────
    console.log('\n4 · the generated index picks it up');
    const [indexed] = await owner<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards
      WHERE archived_at IS NULL AND card_tsv @@ websearch_to_tsquery('english', ${NEEDLE})`;
    ok(`card_tsv now matches "${NEEDLE}"`, Number(indexed.n) > 0, `${indexed.n} card(s)`);

    // ── 5 · GREEN — the lens finds it ────────────────────────────────────────────────────────
    console.log('\n5 · GREEN — the same lens, unchanged, now finds the opportunity');
    await rankBucket(target.tenantId, bucketId, Date.now());
    const after = await scoreNow();
    ok('the opportunity now scores above zero', Number(after?.score ?? 0) > 0,
      `score ${before?.score} → ${after?.score} · ${after?.factors}`);
    ok('and it scored on the KEYWORD factor — the curated text, not a new signal',
      (after?.factors ?? '').includes('"keyword"'), after?.factors);
    ok('with no corpus factor anywhere', !(after?.factors ?? '').includes('corpus'));
  } finally {
    console.log('\n   cleaning up');
    if (bucketId) await owner`DELETE FROM tenant_bucket_scores WHERE bucket_id = ${bucketId}::uuid`;
    if (bucketId) await owner`DELETE FROM tenant_spotlight_buckets WHERE id = ${bucketId}::uuid`;
    if (annotationId) await owner`DELETE FROM solicitation_annotations WHERE id = ${annotationId}::uuid`;
    await owner`DELETE FROM curation_revisions WHERE solicitation_id = ${target.solId}::uuid AND revision_type = 'annotation_added'`;
    // Republish so the mirrors stop carrying a highlight that no longer exists.
    await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());
    const [left] = await owner<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards
      WHERE archived_at IS NULL AND card_tsv @@ websearch_to_tsquery('english', ${NEEDLE})`;
    ok('the needle is gone again after cleanup', Number(left.n) === 0, `${left.n} card(s)`);
  }

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  await owner.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); process.exit(1); });
