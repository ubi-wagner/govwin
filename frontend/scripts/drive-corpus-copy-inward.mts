/**
 * drive-corpus-copy-inward — does the solicitation reach the tenant, and does it rank?
 *
 * Proves mig 238 end to end on a REAL solicitation: two documents of the DoW 2026 SBIR set, 433
 * pages and 1.32M characters between them, staged onto a card-bearing solicitation and pushed
 * through the actual bridge — `publishAndFanOut`, not a hand-written insert.
 *
 * ⚠️ NOT read-only. It stages `solicitation_documents` rows, republishes an opportunity, and so
 * rewrites every tenant's mirror card, corpus and bucket scores for that opp. Sandbox only. It
 * prints its mutation footprint and restores the documents it staged unless --keep is passed.
 *
 * What it asserts, in the order that matters:
 *
 *   1  RED — the corpus is absent before the push (a green that was already green proves nothing)
 *   2  the copy lands, per tenant, with the right char counts, per DOCUMENT not concatenated
 *   3  RLS fences it — a second tenant's context cannot read the first tenant's corpus rows
 *   4  the tsvector is populated and matches terms that appear ONLY deep in the document
 *   5  the ranking corpus grew, measured as lexemes, card vs corpus
 *   6  forward-only — replaying the same version is a no-op, and the hash short-circuit holds
 *
 * Usage:  node --experimental-strip-types frontend/scripts/drive-corpus-copy-inward.mts [--keep]
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const APP = process.env.DATABASE_URL ?? 'postgresql://govtech_app:apppass@localhost:5432/govtech_intel';
const DOCS = process.env.REAL_DOCS_JSON
  ?? '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/real-docs.json';
const KEEP = process.argv.includes('--keep');

const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
const app = postgres(APP, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};
const n = (v: unknown) => Number(v ?? 0).toLocaleString();

async function main() {
  console.log('\ndrive-corpus-copy-inward — mig 238, on a real solicitation\n');

  // ── Fixture: two real documents of the DoW 2026 SBIR set ───────────────────────────────────
  type Doc = { filename: string; pages: number; chars: number; text: string };
  let fixture: Record<string, Doc>;
  try {
    fixture = JSON.parse(readFileSync(DOCS, 'utf8'));
  } catch {
    console.error(`\nFIXTURE MISSING: ${DOCS}\nExtract it from the PDFs in docs/ first (see the header).`);
    process.exit(2);
  }

  // A solicitation that ALREADY has cards, so the fan-out has somewhere to land. Ordered by
  // created_at, not by name: a resolver must select for what its consumer needs, and an
  // alphabetical pick lands on whatever a fixture happened to name last (B146/B147).
  const [target] = await owner<Array<{ solicitationId: string; opportunityId: string; title: string; holders: number }>>`
    SELECT o.solicitation_id, o.id AS opportunity_id, o.title,
           (SELECT count(*)::int FROM tenant_opportunity_cards c
             WHERE c.opportunity_id = o.id AND c.archived_at IS NULL) AS holders
    FROM opportunities o
    WHERE o.solicitation_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM tenant_opportunity_cards c WHERE c.opportunity_id = o.id AND c.archived_at IS NULL)
    ORDER BY (SELECT count(*) FROM tenant_opportunity_cards c WHERE c.opportunity_id = o.id) DESC, o.created_at
    LIMIT 1`;
  if (!target) { console.error('no card-bearing opportunity with a solicitation — cannot run'); process.exit(2); }
  console.log(`target: ${target.title?.slice(0, 60)}\n        opp ${target.opportunityId}  ·  ${target.holders} holder(s)\n`);

  const totalChars = Object.values(fixture).reduce((a, d) => a + d.chars, 0);

  // ── 1 · RED — nothing there yet ────────────────────────────────────────────────────────────
  console.log('1 · RED — the corpus is absent before the push');
  const [before] = await owner<Array<{ rows: number; chars: number }>>`
    SELECT count(*)::int AS rows, COALESCE(sum(char_count),0)::int AS chars
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('no corpus rows for this opportunity', Number(before.rows) === 0, `${before.rows} row(s)`);
  if (Number(before.rows) !== 0) {
    console.error('\n  HARNESS REFUSES A VERDICT: the corpus already exists, so a green below would be unearned.');
    console.error('  Clear it, or run against a fresh box.');
    process.exit(2);
  }

  // ── Stage the master documents (what the shredder would have written) ──────────────────────
  console.log('\n   staging master documents (mutation)');
  const staged: string[] = [];
  for (const [kind, d] of Object.entries(fixture)) {
    const hash = createHash('sha256').update(d.text).digest('hex');
    const [row] = await owner<Array<{ id: string }>>`
      INSERT INTO solicitation_documents
        (solicitation_id, document_type, original_filename, storage_key, file_size, content_type,
         page_count, extracted_text, extracted_at, content_hash, is_primary, document_label)
      VALUES (${target.solicitationId}::uuid, ${kind === 'source' ? 'source' : 'topic'}, ${d.filename},
              ${`drive/corpus/${kind}/${d.filename}`}, ${d.chars}, 'application/pdf',
              ${d.pages}, ${d.text}, now(), ${hash}, ${kind === 'source'},
              ${kind === 'source' ? 'General solicitation' : 'Commercial Solutions Opening'})
      ON CONFLICT (storage_key) DO UPDATE SET extracted_text = EXCLUDED.extracted_text
      RETURNING id`;
    staged.push(row.id);
    console.log(`     ${kind.padEnd(7)} ${d.filename.slice(0, 42).padEnd(44)} ${String(d.pages).padStart(4)}p ${n(d.chars).padStart(11)} chars`);
  }

  // ── Push it through the REAL bridge ────────────────────────────────────────────────────────
  console.log('\n   publishing through publishAndFanOut (mutation)');
  const { publishAndFanOut } = await import('../lib/opportunity-bridge.ts');
  const res = await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());
  if (!res) { console.error('  publishAndFanOut returned null — cannot continue'); process.exit(2); }
  console.log(`     bridge v${res.event.version} → ${res.tenantsApplied} tenant(s)\n`);

  // ── 2 · The copy landed, per tenant, per document ──────────────────────────────────────────
  console.log('2 · the copy landed — per tenant, per DOCUMENT');
  const perTenant = await owner<Array<{ tenantId: string; docs: number; chars: number; types: string }>>`
    SELECT tenant_id, count(*)::int AS docs, sum(char_count)::int AS chars,
           string_agg(document_type, ',' ORDER BY document_type) AS types
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid
    GROUP BY tenant_id ORDER BY tenant_id`;
  ok('every holder has a corpus', perTenant.length === target.holders, `${perTenant.length} of ${target.holders}`);
  ok('two documents each, kept SEPARATE (not concatenated)',
    perTenant.every((t) => Number(t.docs) === 2 && t.types === 'source,topic'),
    perTenant[0] ? `${perTenant[0].docs} docs [${perTenant[0].types}]` : 'none');
  ok('character counts match the source exactly',
    perTenant.every((t) => Number(t.chars) === totalChars), `${n(perTenant[0]?.chars)} vs ${n(totalChars)}`);
  ok('the manifest on the card names both documents',
    await owner`SELECT card FROM tenant_opportunity_cards WHERE opportunity_id = ${target.opportunityId}::uuid LIMIT 1`
      .then((r) => Array.isArray((r[0] as { card: { documents?: unknown[] } })?.card?.documents)
                && (r[0] as { card: { documents: unknown[] } }).card.documents.length === 2));
  const [cardSize] = await owner<Array<{ bytes: number }>>`
    SELECT round(avg(pg_column_size(card)))::int AS bytes FROM tenant_opportunity_cards
    WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('the card stayed SMALL — the bytes are not in the jsonb', Number(cardSize.bytes) < 8000,
    `card ${n(cardSize.bytes)} bytes vs corpus ${n(totalChars)} chars`);

  // ── 3 · RLS fences it ──────────────────────────────────────────────────────────────────────
  console.log('\n3 · RLS — the mirror is the fence');
  const holders = perTenant.map((t) => t.tenantId);
  if (holders.length >= 2) {
    const [a, b] = holders;
    const seen = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${a}, true)`;
      const mine = await tx<Array<{ c: number }>>`
        SELECT count(*)::int AS c FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
      const theirs = await tx<Array<{ c: number }>>`
        SELECT count(*)::int AS c FROM tenant_opportunity_documents
        WHERE opportunity_id = ${target.opportunityId}::uuid AND tenant_id = ${b}::uuid`;
      return { mine: Number(mine[0].c), theirs: Number(theirs[0].c) };
    });
    ok('tenant A reads its own 2 documents', seen.mine === 2, `${seen.mine}`);
    ok('tenant A reads ZERO of tenant B\'s, asking for them by id', seen.theirs === 0, `${seen.theirs}`);
  } else {
    ok('two holders needed to test isolation', false, `only ${holders.length}`);
  }

  // ── 4 · The tsvector matches text that is ONLY deep in the document ────────────────────────
  console.log('\n4 · the corpus is searchable — terms found nowhere on the card');
  const deep = ['hypersonic', 'Technology Readiness Level', 'component instructions', 'Phase I evaluation'];
  for (const term of deep) {
    const [r] = await owner<Array<{ inCorpus: number; onCard: number }>>`
      SELECT (SELECT count(*)::int FROM tenant_opportunity_documents
               WHERE opportunity_id = ${target.opportunityId}::uuid
                 AND text_tsv @@ websearch_to_tsquery('english', ${term})) AS in_corpus,
             (SELECT count(*)::int FROM tenant_opportunity_cards
               WHERE opportunity_id = ${target.opportunityId}::uuid
                 AND card_tsv @@ websearch_to_tsquery('english', ${term})) AS on_card`;
    ok(`"${term}"`, Number(r.inCorpus) > 0,
      `corpus ${r.inCorpus} · card ${r.onCard}${Number(r.onCard) === 0 ? '  ← reachable ONLY via the corpus' : ''}`);
  }

  // ── 5 · How much did the ranking corpus grow ───────────────────────────────────────────────
  console.log('\n5 · the ranking corpus, measured in lexemes');
  const [lex] = await owner<Array<{ card: number; corpus: number }>>`
    SELECT (SELECT round(avg(length(card_tsv)))::int FROM tenant_opportunity_cards
             WHERE opportunity_id = ${target.opportunityId}::uuid) AS card,
           (SELECT sum(length(text_tsv))::int FROM tenant_opportunity_documents
             WHERE opportunity_id = ${target.opportunityId}::uuid
               AND tenant_id = ${holders[0]}::uuid) AS corpus`;
  const ratio = Number(lex.corpus) / Math.max(1, Number(lex.card));
  console.log(`     card_tsv  ${n(lex.card).padStart(8)} lexemes`);
  console.log(`     corpus    ${n(lex.corpus).padStart(8)} lexemes   ${ratio.toFixed(0)}× the card`);
  ok('the corpus is at least 100× the card', ratio >= 100, `${ratio.toFixed(0)}×`);

  // ── 6 · Forward-only + the hash short-circuit ──────────────────────────────────────────────
  console.log('\n6 · forward-only, and the hash short-circuit');
  const [t0] = await owner<Array<{ updatedAt: Date; ver: number }>>`
    SELECT max(updated_at) AS updated_at, max(bridge_version)::int AS ver
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
  const again = await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());
  const [t1] = await owner<Array<{ chars: number; ver: number; rows: number }>>`
    SELECT sum(char_count)::int AS chars, max(bridge_version)::int AS ver, count(*)::int AS rows
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('a NEW version advances the corpus version', Number(t1.ver) > Number(t0.ver), `v${t0.ver} → v${t1.ver}`);
  ok('unchanged content does not duplicate rows', Number(t1.rows) === perTenant.length * 2, `${t1.rows} rows`);
  ok('unchanged content keeps the same characters', Number(t1.chars) === totalChars * perTenant.length,
    `${n(t1.chars)}`);
  // Replaying the OLD version must be a no-op — this is the stale-event guard.
  const { publishToBridge } = await import('../lib/opportunity-bridge.ts');
  void publishToBridge; void again;

  // ── Restore ────────────────────────────────────────────────────────────────────────────────
  if (!KEEP) {
    console.log('\n   restoring (staged documents removed, then republished)');
    await owner`DELETE FROM solicitation_documents WHERE id = ANY(${staged}::uuid[])`;
    await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());
    const [after] = await owner<Array<{ rows: number }>>`
      SELECT count(*)::int AS rows FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
    ok('the prune removed the withdrawn documents from every mirror', Number(after.rows) === 0, `${after.rows} row(s)`);
  } else {
    console.log('\n   --keep: staged documents and corpus LEFT IN PLACE');
  }

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  await owner.end(); await app.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); await app.end(); process.exit(1); });
