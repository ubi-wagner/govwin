/** Drive an ingested solicitation the whole way forward, as rfp_admin, over HTTP.
 *
 * Picks up where drive-ingest-scenario.mjs stops. That script proves upload → shred; this one
 * proves what an RFP admin does next, and it is not one button — it is the whole triage state
 * machine plus two tool invocations:
 *
 *   ingest-assist                         build the draft opportunity from what the shred read
 *   PATCH  spotlightSummary               the push gate requires it (mig 107)
 *   triage skip_shredder                  ai_analyzed          → curation_in_progress
 *   triage request_review                 curation_in_progress → review_requested
 *   tool   solicitation.approve           review_requested     → approved
 *   tool   solicitation.push              approved             → pushed_to_pipeline, fans the bridge
 *
 * Then it counts what landed on the FAR SIDE of the bridge — bridge rows, tenant cards, bucket
 * scores — because "pushed" is only true if a tenant can see it. The forward-only bridge means a
 * push that produced no cards is indistinguishable from a push that never happened unless you look.
 *
 *   node scripts/drive-baa-forward.mjs <solicitation-id> [<solicitation-id>…]
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SOLS = process.argv.slice(2);
if (SOLS.length === 0) {
  console.error('usage: drive-baa-forward.mjs <solicitation-id> [<solicitation-id>…]');
  process.exit(2);
}

// toCamel, matching lib/db.ts. Without it every read here is snake_case and silently undefined —
// the #1 runtime bug class in this codebase, and it bit this script on its first run
// (`meta.ingestPhase` printed "undefined" against a populated column).
const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 3,
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@rfppipeline.com');
await page.fill('input[name="password"]', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }),
  page.click('button[type="submit"]'),
]);
console.log('signed in as rfp_admin\n');

/** What a tenant would actually see — measured past the bridge, not at the push. */
async function farSide(sol) {
  const [row] = await sql`
    SELECT (SELECT count(*)::int FROM opportunities o WHERE o.solicitation_id = ${sol}::uuid
                 OR o.id IN (SELECT opportunity_id FROM curated_solicitations WHERE id = ${sol}::uuid)) AS opps,
           (SELECT count(*)::int FROM opportunity_bridge       WHERE opportunity_id IN
                (SELECT id FROM opportunities WHERE solicitation_id = ${sol}::uuid
                  UNION SELECT opportunity_id FROM curated_solicitations WHERE id = ${sol}::uuid)) AS bridge,
           (SELECT count(*)::int FROM tenant_opportunity_cards WHERE opportunity_id IN
                (SELECT id FROM opportunities WHERE solicitation_id = ${sol}::uuid
                  UNION SELECT opportunity_id FROM curated_solicitations WHERE id = ${sol}::uuid)) AS cards,
           (SELECT count(*)::int FROM tenant_bucket_scores     WHERE opportunity_id IN
                (SELECT id FROM opportunities WHERE solicitation_id = ${sol}::uuid
                  UNION SELECT opportunity_id FROM curated_solicitations WHERE id = ${sol}::uuid)) AS scores`;
  return row;
}

async function triage(sol, action) {
  const r = await page.request.post(`${BASE}/api/admin/rfp-curation/${sol}/triage`, { data: { action } });
  const j = await r.json().catch(() => ({}));
  const d = j.data ?? j;
  return `${action} ${r.status()} ${j.error ? `ERROR ${j.code}: ${j.error}` : `${d.fromState} → ${d.toState}`}`;
}

async function tool(name, input) {
  const r = await page.request.post(`${BASE}/api/tools/${name}`, { data: { input } });
  const j = await r.json().catch(() => ({}));
  return `${name} ${r.status()} ${j.error ? `ERROR ${j.code}: ${j.error}` : JSON.stringify(j.data).slice(0, 130)}`;
}

let failures = 0;
for (const SOL of SOLS) {
  // The title comes off the OPPORTUNITY, not curated_solicitations.solicitation_title — that column
  // holds the title the shredder EXTRACTS from the document, which is empty until it finds one.
  // What the curator typed on the upload form lives on the opportunity the intake created.
  const [meta] = await sql`
    SELECT cs.status, cs.ingest_phase,
           coalesce(o.title, cs.solicitation_title) AS title,
           length(coalesce(cs.full_text,'')) AS chars,
           cs.ai_extracted -> 'source_excerpt' ->> 'coverage' AS coverage
      FROM curated_solicitations cs
      LEFT JOIN opportunities o ON o.solicitation_id = cs.id
     WHERE cs.id = ${SOL}::uuid
     LIMIT 1`;
  if (!meta) { console.log(`── ${SOL}  NOT FOUND\n`); failures++; continue; }

  console.log(`── ${SOL}  ${meta.title || '(untitled)'}`);
  console.log(`   before  status=${meta.status} phase=${meta.ingestPhase} chars=${Number(meta.chars).toLocaleString()}` +
              (meta.coverage ? ` shredCoverage=${(100 * Number(meta.coverage)).toFixed(1)}%` : ' shredCoverage=whole'));
  console.log(`   before  ${JSON.stringify(await farSide(SOL))}`);

  const assist = await page.request.post(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-assist`, { data: {} });
  const aj = await assist.json().catch(() => ({}));
  const ad = aj.data ?? aj;
  console.log(`   assist  ${assist.status()} landed=${ad.landed} volumes=${ad.volumes} items=${ad.items} source=${ad.source}`);

  const summary = `${meta.title || 'Solicitation'} — umbrella BAA. Matches firms pursuing ` +
    `SBIR/STTR work with the sponsoring component; topics are released separately against this instrument.`;
  const patch = await page.request.patch(`${BASE}/api/admin/rfp-curation/${SOL}`, {
    data: { spotlightSummary: summary, expertNotes: 'Umbrella instrument — read the component instructions, which supersede the general guidelines.' },
  });
  console.log(`   summary ${patch.status()}`);

  console.log(`   triage  ${await triage(SOL, 'skip_shredder')}`);
  console.log(`   triage  ${await triage(SOL, 'request_review')}`);
  console.log(`   tool    ${await tool('solicitation.approve', { solicitationId: SOL })}`);
  console.log(`   tool    ${await tool('solicitation.push', { solicitationId: SOL })}`);

  // The bridge drains asynchronously; poll rather than assume.
  let after = await farSide(SOL);
  for (let i = 0; i < 12 && after.cards === 0; i++) {
    await page.waitForTimeout(1500);
    after = await farSide(SOL);
  }
  const [end] = await sql`SELECT status, ingest_phase FROM curated_solicitations WHERE id = ${SOL}::uuid`;
  console.log(`   after   status=${end.status} phase=${end.ingestPhase}`);
  console.log(`   after   ${JSON.stringify(after)}`);
  if (after.cards === 0) { console.log('   ✗ nothing reached a tenant card'); failures++; }
  else console.log(`   ✓ ${after.cards} tenant card(s), ${after.scores} bucket score(s)`);
  console.log('');
}

await browser.close();
await sql.end();
process.exit(failures ? 1 : 0);
