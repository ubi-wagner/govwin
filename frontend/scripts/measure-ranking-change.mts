/**
 * measure-ranking-change — what did mig 238 actually do to the numbers?
 *
 * Snapshots every stored `tenant_bucket_scores` row, re-ranks every active bucket through the
 * SHIPPING `rankBucket`, and reports the before/after distribution alongside the four figures that
 * motivated this work.
 *
 * ⚠️ NOT read-only: it rewrites tenant_bucket_scores (which is the point — stored scores are
 * derived data and go stale on any scoring change). Sandbox only. `--dry` snapshots and measures
 * without re-ranking.
 *
 * Why a script rather than "wait for events": the plan's step 1 says the abstention fix CHANGES
 * EVERY STORED SCORE, and a change nobody measured is a change nobody can defend. Scores that move
 * for a reason you can state are a fix; scores that move mysteriously are an incident.
 *
 * Usage:  node --import tsx frontend/scripts/measure-ranking-change.mts [--dry]
 */

import postgres from 'postgres';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const DRY = process.argv.includes('--dry');
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`);
const bar = (v: number, max: number, w = 24) => '█'.repeat(Math.max(0, Math.round((v / Math.max(1, max)) * w)));

type Row = { tenantId: string; bucketId: string; opportunityId: string; score: number; factors: Record<string, number> };

async function snapshot(): Promise<Map<string, Row>> {
  const rows = await owner<Row[]>`
    SELECT tenant_id, bucket_id, opportunity_id, score, factors FROM tenant_bucket_scores`;
  return new Map(rows.map((r) => [`${r.bucketId}:${r.opportunityId}`, r]));
}

async function main() {
  console.log('\nmeasure-ranking-change — mig 238\n');

  const before = await snapshot();
  console.log(`  ${before.size} stored score(s) before\n`);

  // ── The corpus, as it stands ───────────────────────────────────────────────────────────────
  const [corpus] = await owner<Array<{ docs: number; opps: number; tenants: number; chars: number; lexemes: number }>>`
    SELECT count(*)::int AS docs, count(DISTINCT opportunity_id)::int AS opps,
           count(DISTINCT tenant_id)::int AS tenants, COALESCE(sum(char_count),0)::bigint AS chars,
           COALESCE(sum(length(text_tsv)),0)::bigint AS lexemes
    FROM tenant_opportunity_documents`;
  const [cards] = await owner<Array<{ n: number; opps: number }>>`
    SELECT count(*)::int AS n, count(DISTINCT opportunity_id)::int AS opps
    FROM tenant_opportunity_cards WHERE archived_at IS NULL`;
  console.log('CORPUS');
  console.log(`  documents copied inward        ${corpus.docs} across ${corpus.opps} opportunity(ies), ${corpus.tenants} tenant(s)`);
  console.log(`  characters                     ${Number(corpus.chars).toLocaleString()}`);
  console.log(`  opportunities WITH a corpus    ${corpus.opps} of ${cards.opps}   ${pct(Number(corpus.opps), Number(cards.opps))}`);
  console.log(`  cards                          ${cards.n}\n`);

  // ── Motivating figure 1: how much text does ranking actually read? ─────────────────────────
  const [reach] = await owner<Array<{ cardChars: number; corpusChars: number }>>`
    SELECT round(avg(length(concat_ws(' ', card->>'title', card->>'spotlightSummary',
                                           card->>'description', card->>'office'))))::int AS card_chars,
           (SELECT COALESCE(round(avg(char_count)),0)::int FROM tenant_opportunity_documents) AS corpus_chars
    FROM tenant_opportunity_cards WHERE archived_at IS NULL`;
  console.log('WHAT RANKING READS, per opportunity');
  console.log(`  card fields (the old corpus)   ${Number(reach.cardChars).toLocaleString()} chars`);
  console.log(`  a copied document, mean        ${Number(reach.corpusChars).toLocaleString()} chars`);
  if (Number(reach.corpusChars) > 0) {
    console.log(`  ratio                          ${Math.round(Number(reach.corpusChars) / Math.max(1, Number(reach.cardChars))).toLocaleString()}×\n`);
  } else { console.log(); }

  // ── Re-rank ────────────────────────────────────────────────────────────────────────────────
  const buckets = await owner<Array<{ id: string; tenantId: string; name: string }>>`
    SELECT id, tenant_id, name FROM tenant_spotlight_buckets WHERE is_active ORDER BY tenant_id, name`;
  if (!DRY) {
    const { rankBucket } = await import('../lib/bucket-ranking.ts');
    const now = Date.now();
    console.log(`RE-RANKING ${buckets.length} active bucket(s) through the shipping rankBucket (mutation)`);
    for (const b of buckets) {
      const { ranked } = await rankBucket(b.tenantId, b.id, now);
      console.log(`  ${b.name.slice(0, 46).padEnd(48)} ${String(ranked).padStart(4)} card(s)`);
    }
    console.log();
  } else {
    console.log('  --dry: not re-ranking\n');
  }

  const after = await snapshot();

  // ── Movement ───────────────────────────────────────────────────────────────────────────────
  let up = 0, down = 0, same = 0, appeared = 0, vanished = 0;
  let biggestUp = { k: '', d: 0 }, biggestDown = { k: '', d: 0 };
  const deltas: number[] = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b) { appeared++; continue; }
    const d = a.score - b.score;
    deltas.push(d);
    if (d > 0) { up++; if (d > biggestUp.d) biggestUp = { k, d }; }
    else if (d < 0) { down++; if (d < biggestDown.d) biggestDown = { k, d }; }
    else same++;
  }
  for (const k of before.keys()) if (!after.has(k)) vanished++;

  console.log('MOVEMENT');
  console.log(`  unchanged                      ${same}`);
  console.log(`  moved up                       ${up}${up ? `   (largest +${biggestUp.d})` : ''}`);
  console.log(`  moved down                     ${down}${down ? `   (largest ${biggestDown.d})` : ''}`);
  console.log(`  newly scored                   ${appeared}`);
  console.log(`  no longer scored               ${vanished}`);
  if (deltas.length) {
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    console.log(`  mean delta                     ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} points\n`);
  } else { console.log(); }

  // ── Distribution, before and after ─────────────────────────────────────────────────────────
  const bands = [[0, 0], [1, 24], [25, 49], [50, 74], [75, 99], [100, 100]] as const;
  const hist = (m: Map<string, Row>) => bands.map(([lo, hi]) =>
    [...m.values()].filter((r) => r.score >= lo && r.score <= hi).length);
  const hb = hist(before), ha = hist(after);
  const max = Math.max(...hb, ...ha);
  console.log('SCORE DISTRIBUTION');
  console.log(`  ${'band'.padEnd(10)} ${'before'.padStart(6)}  ${'after'.padStart(6)}   after`);
  bands.forEach(([lo, hi], i) => {
    const label = lo === hi ? `${lo}` : `${lo}–${hi}`;
    console.log(`  ${label.padEnd(10)} ${String(hb[i]).padStart(6)}  ${String(ha[i]).padStart(6)}   ${bar(ha[i], max)}`);
  });
  console.log();

  // ── Motivating figure 2: which factors carry the score now? ────────────────────────────────
  const share = new Map<string, number>();
  for (const r of after.values()) for (const k of Object.keys(r.factors ?? {})) share.set(k, (share.get(k) ?? 0) + 1);
  const shareBefore = new Map<string, number>();
  for (const r of before.values()) for (const k of Object.keys(r.factors ?? {})) shareBefore.set(k, (shareBefore.get(k) ?? 0) + 1);
  console.log('FACTORS PRESENT (a factor that abstains is absent, not zero)');
  const keys = [...new Set([...share.keys(), ...shareBefore.keys()])].sort();
  for (const k of keys) {
    const b = shareBefore.get(k) ?? 0, a = share.get(k) ?? 0;
    console.log(`  ${k.padEnd(16)} before ${String(b).padStart(5)}   after ${String(a).padStart(5)}   ${a > b ? `+${a - b}` : a < b ? `${a - b}` : '—'}`);
  }
  console.log();

  // ── Motivating figure 3: did the corpus reach any card the card text could not? ────────────
  const corpusCarried = [...after.values()].filter((r) => (r.factors?.corpus ?? 0) > 0 && (r.factors?.keyword ?? 0) === 0);
  console.log('THE CASE THIS WAS BUILT FOR');
  console.log(`  scored ONLY because the solicitation matched (card text did not): ${corpusCarried.length}`);
  if (corpusCarried.length) {
    for (const r of corpusCarried.slice(0, 5)) {
      const [b] = await owner<Array<{ name: string }>>`SELECT name FROM tenant_spotlight_buckets WHERE id = ${r.bucketId}::uuid`;
      console.log(`    ${(b?.name ?? '?').slice(0, 44).padEnd(46)} score ${String(r.score).padStart(3)}  corpus ${r.factors.corpus}`);
    }
  }
  console.log();

  await owner.end();
}

main().catch(async (e) => { console.error(e); await owner.end(); process.exit(1); });
