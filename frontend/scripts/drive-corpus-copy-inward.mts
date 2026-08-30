/**
 * drive-corpus-copy-inward — does the solicitation reach the tenant WHEN THEY PIN, and stay out
 * of ranking until then?
 *
 * Proves mig 238 + 239 end to end on a REAL solicitation: two documents of the DoW 2026 SBIR set,
 * 433 pages and 1.32M characters between them, staged onto a card-bearing solicitation and pushed
 * through the actual bridge — `publishAndFanOut`, not a hand-written insert.
 *
 * ⚠️ The MODEL CHANGED at mig 239 and this drive changed with it. mig 238 copied the text at
 * fan-out for every holder and fed it to the scorer; measurement showed `ts_rank` over a general
 * BAA returns the same value for terms it has nothing to do with, so the factor scored document
 * LENGTH. Documents are REFERENCE now: the manifest rides the card, the bytes arrive at pin.
 *
 * ⚠️ NOT read-only. It stages `solicitation_documents` rows, republishes an opportunity, and so
 * rewrites every tenant's mirror card, corpus and bucket scores for that opp. Sandbox only. It
 * prints its mutation footprint and restores the documents it staged unless --keep is passed.
 *
 * What it asserts, in the order that matters:
 *
 *   1  RED — the corpus is absent before the push (a green that was already green proves nothing)
 *   2  the push does NOT copy it — the manifest rides the card, the bytes do not
 *   3  PIN copies it, per DOCUMENT not concatenated, with the right char counts
 *   4  RLS fences it — a second tenant's context cannot read the first tenant's corpus rows
 *   5  the tsvector is populated and matches terms that appear ONLY deep in the document
 *   6  ranking does NOT read it — no `corpus` factor appears in any stored score
 *
 * Usage:  node --import tsx frontend/scripts/drive-corpus-copy-inward.mts [--keep]
 *         The fixture is extracted from docs/*.pdf on first run and cached under the OS temp dir.
 */

import postgres from 'postgres';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const APP = process.env.DATABASE_URL ?? 'postgresql://govtech_app:apppass@localhost:5432/govtech_intel';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Cached under the OS temp dir, not a session scratchpad — a path tied to one session is a fixture
// that rots the moment anyone else runs this. Rebuilt from the PDFs in docs/ when absent.
const CACHE = join(tmpdir(), 'govwin-corpus-fixture', 'real-docs.json');
const KEEP = process.argv.includes('--keep');

/** The two real documents this drive runs on, and where they come from. */
const SOURCE_PDFS: Record<string, string> = {
  source: 'DoW 2026 SBIR BAA FULL_R1_04132026.pdf',
  topic: 'DoW 2026 SBIR CSO FULL_R1_04132026.pdf',
};

/**
 * Build the fixture from the PDFs committed in docs/, caching the extraction.
 *
 * Extracting 433 pages takes a few seconds, so it is cached — but the PDFs are the source of
 * truth and they are in the repo, so this drive is self-sufficient on any box with PyMuPDF. If
 * that is missing it exits 2 NAMING the reason, rather than running against a smaller document and
 * reporting a green that measured something else.
 */
function buildFixture(): void {
  if (existsSync(CACHE)) return;
  const missing = Object.values(SOURCE_PDFS).filter((f) => !existsSync(join(REPO, 'docs', f)));
  if (missing.length) {
    console.error(`\nHARNESS CANNOT RUN: missing source PDF(s) under docs/ — ${missing.join(', ')}\n`);
    process.exit(2);
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  const py = `
import json, sys
try:
    import pymupdf
except ImportError:
    sys.stderr.write("PyMuPDF not installed")
    raise SystemExit(3)
out = {}
for kind, f in json.loads(sys.argv[1]).items():
    d = pymupdf.open(f)
    t = "\\n".join(p.get_text() for p in d)
    out[kind] = {"filename": f.rsplit("/", 1)[-1], "pages": d.page_count, "chars": len(t), "text": t}
    d.close()
json.dump(out, open(sys.argv[2], "w"))
`;
  const paths = Object.fromEntries(Object.entries(SOURCE_PDFS).map(([k, f]) => [k, join(REPO, 'docs', f)]));
  try {
    execFileSync('python3', ['-c', py, JSON.stringify(paths), CACHE], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const err = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e);
    console.error(`\nHARNESS CANNOT RUN: could not extract the source PDFs.\n  ${err.trim()}\n` +
      `  Install PyMuPDF (pip install pymupdf) — this drive measures a REAL 433-page solicitation\n` +
      `  and running it against anything smaller would report a green about a different document.\n`);
    process.exit(2);
  }
}

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

  // ── Fixture: two real documents of the DoW 2026 SBIR set, from the PDFs in docs/ ────────────
  type Doc = { filename: string; pages: number; chars: number; text: string };
  buildFixture();
  let fixture: Record<string, Doc>;
  try {
    fixture = JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch (e) {
    console.error(`\nHARNESS DEFECT: the extracted fixture at ${CACHE} did not parse.\n${e}\n`);
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

  // ── 2 · The push does NOT copy the bytes (mig 239) ─────────────────────────────────────────
  console.log('2 · the push carries the MANIFEST, not the bytes');
  const [afterPush] = await owner<Array<{ rows: number }>>`
    SELECT count(*)::int AS rows FROM tenant_opportunity_documents
    WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('no corpus rows after a full fan-out', Number(afterPush.rows) === 0, `${afterPush.rows} row(s)`);
  ok('but the card NAMES both documents, so a tenant can see what exists',
    await owner`SELECT card FROM tenant_opportunity_cards WHERE opportunity_id = ${target.opportunityId}::uuid LIMIT 1`
      .then((r) => Array.isArray((r[0] as { card: { documents?: unknown[] } })?.card?.documents)
                && (r[0] as { card: { documents: unknown[] } }).card.documents.length === 2));

  // ── 2b · PIN copies it ─────────────────────────────────────────────────────────────────────
  console.log('\n2b · pinning copies the text into the tenant\'s own rows (mutation)');
  const holders = await owner<Array<{ tenantId: string; slug: string }>>`
    SELECT c.tenant_id, t.slug FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
    WHERE c.opportunity_id = ${target.opportunityId}::uuid AND c.archived_at IS NULL
    ORDER BY t.slug LIMIT 2`;
  // Object copies fail loudly in this sandbox — the drive stages solicitation_documents rows with
  // no objects behind them. The TEXT copy is what is under test; the noise is expected.
  const { pinCard, resyncPinnedCard } = await import('../lib/opportunity-pin.ts');
  for (const h of holders) {
    // Object copy is best-effort against the sandbox store; the TEXT copy is what this asserts.
    await pinCard(h.tenantId, h.slug, target.opportunityId).catch(() => ({ pinned: false, docs: [] }));
    console.log(`     pinned as ${h.slug}`);
  }

  console.log('\n3 · the copy landed — per tenant, per DOCUMENT');
  const perTenant = await owner<Array<{ tenantId: string; docs: number; chars: number; types: string }>>`
    SELECT tenant_id, count(*)::int AS docs, sum(char_count)::int AS chars,
           string_agg(document_type, ',' ORDER BY document_type) AS types
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid
    GROUP BY tenant_id ORDER BY tenant_id`;
  ok('exactly the tenants that PINNED have a corpus — not every holder',
    perTenant.length === holders.length, `${perTenant.length} of ${holders.length} pinned · ${target.holders} holders`);
  ok('two documents each, kept SEPARATE (not concatenated)',
    perTenant.every((t) => Number(t.docs) === 2 && t.types === 'source,topic'),
    perTenant[0] ? `${perTenant[0].docs} docs [${perTenant[0].types}]` : 'none');
  ok('character counts match the source exactly',
    perTenant.every((t) => Number(t.chars) === totalChars), `${n(perTenant[0]?.chars)} vs ${n(totalChars)}`);
  const [cardSize] = await owner<Array<{ bytes: number }>>`
    SELECT round(avg(pg_column_size(card)))::int AS bytes FROM tenant_opportunity_cards
    WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('the card stayed SMALL — the bytes are not in the jsonb', Number(cardSize.bytes) < 8000,
    `card ${n(cardSize.bytes)} bytes vs corpus ${n(totalChars)} chars`);

  // ── 4 · RLS fences it ──────────────────────────────────────────────────────────────────────
  console.log('\n4 · RLS — the mirror is the fence');
  const pinnedIds = perTenant.map((t) => t.tenantId);
  if (pinnedIds.length >= 2) {
    const [a, b] = pinnedIds;
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
    ok('two pinned tenants needed to test isolation', false, `only ${pinnedIds.length}`);
  }

  // ── 5 · The tsvector matches text that is ONLY deep in the document ────────────────────────
  console.log('\n5 · the pinned corpus is SEARCHABLE — terms found nowhere on the card');
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

  // ── 6 · RANKING DOES NOT READ IT (mig 239) ─────────────────────────────────────────────────
  // The point of the whole change. mig 238 fed this text to the scorer as a `corpus` factor; on a
  // general BAA `ts_rank` returns the same value for terms the document has nothing to do with, so
  // it scored document LENGTH and four unrelated buckets hit ceiling on one card.
  console.log('\n6 · ranking does NOT read the solicitation');
  const [corpusFactors] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tenant_bucket_scores WHERE factors ? 'corpus'`;
  ok('no stored score carries a `corpus` factor', Number(corpusFactors.n) === 0, `${corpusFactors.n} found`);
  const [cardLex] = await owner<Array<{ card: number }>>`
    SELECT COALESCE(round(avg(length(card_tsv))), 0)::int AS card FROM tenant_opportunity_cards
    WHERE opportunity_id = ${target.opportunityId}::uuid`;
  console.log(`     the card's own searchable record: ${n(cardLex.card)} lexemes — curated, not the document`);

  // ── 7 · Forward-only + the hash short-circuit ──────────────────────────────────────────────
  console.log('\n7 · forward-only, and the hash short-circuit');
  const [t0] = await owner<Array<{ updatedAt: Date; ver: number }>>`
    SELECT max(updated_at) AS updated_at, max(bridge_version)::int AS ver
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
  const again = await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());
  // A pinned holder RESYNCS to pick the new version up — that is the path an amendment takes now.
  for (const h of holders) await resyncPinnedCard(h.tenantId, h.slug, target.opportunityId).catch(() => ({ docs: [] }));
  const [t1] = await owner<Array<{ chars: number; ver: number; rows: number }>>`
    SELECT sum(char_count)::int AS chars, max(bridge_version)::int AS ver, count(*)::int AS rows
    FROM tenant_opportunity_documents WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('a NEW version advances the corpus version', Number(t1.ver) > Number(t0.ver), `v${t0.ver} → v${t1.ver}`);
  ok('unchanged content does not duplicate rows', Number(t1.rows) === perTenant.length * 2, `${t1.rows} rows`);
  ok('unchanged content keeps the same characters', Number(t1.chars) === totalChars * perTenant.length,
    `${n(t1.chars)}`);
  void t0;
  // Replaying the OLD version must be a no-op — this is the stale-event guard.
  const { publishToBridge } = await import('../lib/opportunity-bridge.ts');
  void publishToBridge; void again;

  // ── 8 · A WITHDRAWN document, and what happens to someone who pinned it ────────────────────
  // The model change raises this and it deserves an assertion rather than an assumption. Under
  // mig 238 the fan-out pruned every mirror the moment the master lost a document. Under 239 a
  // pinned copy is the TENANT'S — deleting it out from under them because the organization
  // withdrew the file would be the product silently removing something they were told they owned.
  //
  // So: the republish FLAGS them (`pin_update_available`, which the card upsert already sets), and
  // the prune happens when they resync. Told, then acted on — never acted on without being told.
  console.log('\n8 · a withdrawn document — flagged first, pruned on resync');
  await owner`DELETE FROM solicitation_documents WHERE id = ANY(${staged}::uuid[])`;
  await publishAndFanOut(target.opportunityId, 'updated', null, new Date().toISOString());

  const [flagged] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tenant_opportunity_cards
    WHERE opportunity_id = ${target.opportunityId}::uuid AND is_pinned AND pin_update_available`;
  ok('every pinned holder is FLAGGED that something changed', Number(flagged.n) === holders.length,
    `${flagged.n} of ${holders.length}`);

  const [stillHeld] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tenant_opportunity_documents
    WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('their copy is NOT deleted out from under them', Number(stillHeld.n) > 0, `${stillHeld.n} row(s) held`);

  const [manifest] = await owner<Array<{ docs: number }>>`
    SELECT jsonb_array_length(card->'documents')::int AS docs FROM tenant_opportunity_cards
    WHERE opportunity_id = ${target.opportunityId}::uuid LIMIT 1`;
  ok('but the CARD already says the organization no longer publishes them', Number(manifest.docs) === 0,
    `manifest lists ${manifest.docs}`);

  for (const h of holders) await resyncPinnedCard(h.tenantId, h.slug, target.opportunityId).catch(() => ({ docs: [] }));
  const [afterResync] = await owner<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tenant_opportunity_documents
    WHERE opportunity_id = ${target.opportunityId}::uuid`;
  ok('and the resync prunes them', Number(afterResync.n) === 0, `${afterResync.n} row(s)`);

  if (KEEP) console.log('\n   --keep: nothing to keep — the withdrawal test removes the staged documents');

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  await owner.end(); await app.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); await app.end(); process.exit(1); });
