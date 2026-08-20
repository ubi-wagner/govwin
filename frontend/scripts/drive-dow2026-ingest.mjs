/** Build a NEW curated solicitation from a PDF the repository actually owns.
 *
 * The nine blocked specs feed a DoW 2026 SBIR BAA plus OSW T3CP component instructions and a topic
 * call. The two T3CP documents arrived as chat uploads and are not in the repo, and the specs assert
 * on their content (OSW26BZ04DP013, "Patent Holiday", 26BZ), so no substitute satisfies them as
 * written. Rather than chase files that may not exist any more, stand up a fresh scenario on
 * documents that are checked in — docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf, with the 2026 CSO as
 * the component-level companion — and let the specs be repointed at it.
 *
 * This drives the PRODUCT'S OWN path (the /admin/rfp-curation/upload form, its async shred, its
 * auto-assist), not a SQL seed, because the whole point of those specs is that ingest works on a
 * real government document nobody wrote for the test. It reports what came out rather than
 * asserting, so the first run tells us what the new scenario's assertions should actually say.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import path from 'node:path';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const REPO = path.resolve(process.cwd(), '..');
const BAA = path.join(REPO, 'docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf');
const CSO = path.join(REPO, 'docs/DoW 2026 SBIR CSO FULL_R1_04132026.pdf');

for (const f of [BAA, CSO]) {
  if (!fs.existsSync(f)) { console.error(`missing ${f}`); process.exit(2); }
  console.log(`  source: ${path.basename(f)}  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
}

const sql = postgres(process.env.DATABASE_URL_OWNER, { max: 3 });
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext()).newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@rfppipeline.com');
await page.fill('input[name="password"]', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('button[type="submit"]')]);
console.log('\nsigned in as rfp_admin');

// ── upload through the real form, both documents, CSO marked as instructions ──
await page.goto(`${BASE}/admin/rfp-curation/upload`, { waitUntil: 'networkidle' });
await page.fill('input[name="title"]', 'DoW 2026 SBIR — Annual BAA (repo fixture)');
await page.fill('input[name="agency"]', 'Department of War');
await page.selectOption('select[name="programType"]', 'sbir_phase_1');
await page.fill('input[name="closeDate"]', '2026-12-15');

const fileInputs = page.locator('input[type="file"]');
await fileInputs.nth(0).setInputFiles([BAA, CSO]);
await page.waitForTimeout(600);

// Tell the form which of the two is component-level instructions, if it offers the choice.
const instrSelects = page.locator('select').filter({ hasText: 'Component instructions' });
const nSel = await instrSelects.count();
if (nSel > 1) { await instrSelects.nth(1).selectOption('instructions'); console.log('marked the CSO as component instructions'); }
else console.log(`(no per-file role select surfaced — ${nSel} found)`);

console.log('submitting — the form waits for the async shred, this takes minutes on a 3 MB BAA…');
const t0 = Date.now();
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin\/rfp-curation\/[0-9a-f-]{36}/, { timeout: 15 * 60 * 1000 });
const SOL = page.url().split('/').pop().split('?')[0];
console.log(`\nsolicitation ${SOL}  (shred + land took ${Math.round((Date.now() - t0) / 1000)}s)`);

// ── what did the product actually produce? ──────────────────────────────────
const readiness = await (await page.request.get(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-assist`)).json().catch(() => ({}));
console.log(`\nreadiness : ${JSON.stringify(readiness.data ?? readiness).slice(0, 300)}`);

const phase = await (await page.request.get(`${BASE}/api/admin/rfp-curation/${SOL}/ingest-phase`)).json().catch(() => ({}));
console.log(`phase     : ${phase.data?.phase ?? '?'}   draft status: ${phase.data?.draft?.status ?? '—'}`);
const findings = phase.data?.draft?.audit?.findings ?? [];
console.log(`findings  : ${findings.length} (${findings.filter((f) => f.severity === 'blocker').length} blocker)`);
for (const f of findings.slice(0, 6)) console.log(`   [${f.severity}] ${String(f.issue).slice(0, 110)}`);

const [docs] = await sql`SELECT count(*)::int AS n, sum(length(coalesce(extracted_text,'')))::int AS chars
                         FROM solicitation_documents WHERE solicitation_id = ${SOL}::uuid`;
console.log(`documents : ${docs?.n ?? 0} shredded, ${docs?.chars ?? 0} chars of text`);

const [mx] = await sql`SELECT count(*)::int AS n FROM solicitation_compliance WHERE solicitation_id = ${SOL}::uuid`;
console.log(`compliance: ${mx?.n ?? 0} row(s)`);

console.log(`\nnew scenario id: ${SOL}`);
await browser.close();
await sql.end();
