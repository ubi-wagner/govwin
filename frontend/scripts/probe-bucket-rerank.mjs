/** Why does hitl-bucket-rls see non-zero scores after a PATCH to a keyword that matches nothing?
 *
 * The TS path reads correct by inspection: PATCH shallow-merges the sanitized partial over the
 * stored criteria (so useTimeline:false survives), then calls rankBucket synchronously, which
 * upserts a score for EVERY card — including zeros. So either the merge is not what I think it is,
 * or something writes over the result afterwards.
 *
 * The obvious suspect for "afterwards" is the `capture:buckets.updated` event the route emits: the
 * pipeline's OnBucketsUpdated rescores every card against every active bucket using the PYTHON
 * scorer. If that scorer disagrees with lib/bucket-ranking.ts about a false `useTimeline`, it wins
 * the race and the timeline signal re-inflates the score — a cross-service parity break, not a
 * test artifact.
 *
 * So: drive the real routes exactly as the spec does, then read the row back at three points and
 * print the stored criteria, the scores, and the per-signal factors. The factors are the tell —
 * a `timeline` key in there after a useTimeline:false merge names the writer.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 2, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
await page.fill('input[name="password"]', PW);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

const API = '/api/portal/foundation/buckets';
const dump = async (label, id) => {
  const [row] = await sql`SELECT criteria FROM tenant_spotlight_buckets WHERE id = ${id}::uuid`;
  const scores = await sql`
    SELECT score, factors FROM tenant_bucket_scores WHERE bucket_id = ${id}::uuid ORDER BY score DESC`;
  console.log(`\n── ${label} ──`);
  console.log('  criteria :', JSON.stringify(row?.criteria));
  console.log(`  scores   : ${scores.map((s) => s.score).join(', ')}`);
  console.log('  factors  :', JSON.stringify(scores[0]?.factors));
};

const create = await page.request.post(BASE + API, {
  data: { name: 'Probe Rerank', criteria: { keywords: ['additive', 'concrete'], useTimeline: false, weights: { keyword: 1 } } },
});
const id = (await create.json()).data.id;
console.log(`created bucket ${id}`);
await dump('after CREATE (keywords additive/concrete, useTimeline:false)', id);

const patch = await page.request.patch(`${BASE}${API}/${id}`, { data: { criteria: { keywords: ['zzznotarealkeyword'] } } });
console.log(`\nPATCH → ${patch.status()}`);
await dump('immediately after PATCH', id);

// Give the async OnBucketsUpdated path time to land, then look again. If the scores move HERE,
// the pipeline scorer is the writer that disagrees.
await page.waitForTimeout(12000);
await dump('12s later (async OnBucketsUpdated window)', id);

await page.request.delete(`${BASE}${API}/${id}`);
await browser.close();
await sql.end();
