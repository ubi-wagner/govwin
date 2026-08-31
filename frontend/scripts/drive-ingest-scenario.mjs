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

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const REPO = path.resolve(process.cwd(), '..');

// Scenario from the command line, so one driver stands up every solicitation in the matrix:
//   node scripts/drive-ingest-scenario.mjs "<title>" <programType> <closeDate> <pdf> [pdf…]
// Every PDF path is repo-relative, because the whole point is that the fixture lives in the
// repository and survives a clean checkout.
const [, , TITLE, PROGRAM, CLOSE, ...PDFS] = process.argv;
if (!TITLE || !PROGRAM || !CLOSE || PDFS.length === 0) {
  console.error('usage: drive-ingest-scenario.mjs "<title>" <programType> <YYYY-MM-DD> <pdf> [pdf…]');
  process.exit(2);
}
const FILES = PDFS.map((f) => (path.isAbsolute(f) ? f : path.join(REPO, f)));
for (const f of FILES) {
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
await page.fill('input[name="title"]', TITLE);
await page.fill('input[name="agency"]', process.env.SCENARIO_AGENCY || 'Department of Defense');
// Check the value against the form's OWN option list before selecting. Playwright's failure for an
// absent option is a 30s timeout ending in "did not find some options" — which names neither the
// value you passed nor the ones that exist, so it reads like the form failed to render. The list
// lives in the component (PROGRAM_TYPES in upload-form.tsx) and is not exported, so ask the page.
const PROGRAM_OPTIONS = await page.$$eval('select[name="programType"] option',
  (os) => os.map((o) => o.value).filter(Boolean));
if (!PROGRAM_OPTIONS.includes(PROGRAM)) {
  console.error(`programType "${PROGRAM}" is not one the form offers.\n  valid: ${PROGRAM_OPTIONS.join(' | ')}`);
  process.exit(2);
}
await page.selectOption('select[name="programType"]', PROGRAM);
await page.fill('input[name="closeDate"]', CLOSE);

const fileInputs = page.locator('input[type="file"]');
await fileInputs.nth(0).setInputFiles(FILES);
await page.waitForTimeout(600);

// Tell the form which of the two is component-level instructions, if it offers the choice.
const instrSelects = page.locator('select').filter({ hasText: 'Component instructions' });
const nSel = await instrSelects.count();
if (nSel > 1) { await instrSelects.nth(1).selectOption('instructions'); console.log('marked file 2 as component instructions'); }
else console.log(`(no per-file role select surfaced — ${nSel} found)`);

console.log('submitting — the form waits for the async shred…');
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

const [oppRow] = await sql`SELECT id FROM opportunities WHERE solicitation_id = ${SOL}::uuid LIMIT 1`;
console.log(`\nSCENARIO SOL=${SOL} OPP=${oppRow?.id ?? ''}`);
await browser.close();
await sql.end();
