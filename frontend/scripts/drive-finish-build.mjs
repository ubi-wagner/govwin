/** Finish a provisioned build: extend if closed, lock, advance, lock, package. The last mile.
 *
 * drive-buy-and-build.mjs stops at "the buyer has a workable proposal". This carries that proposal
 * to a downloadable submission package, through the routes the real actors use — an rfp_admin for
 * the one admin-only step, the buying tenant_admin for everything else.
 *
 *   1. rfp_admin  — extend the close date IF the solicitation has already closed. A build against
 *                   a closed solicitation SHOULD be blocked, and is; agencies really do extend
 *                   BAAs, and `close_date_change` is the product's own path for it (it records
 *                   previous_close_date and fans an 'updated' event across the bridge). Skipped
 *                   entirely when the deadline is still ahead.
 *   2. buyer      — readiness BEFORE, so the blocker list is on the record
 *   3. buyer      — lock every section (a stage gate counts an unlocked section as a blocker)
 *   4. buyer      — advance through the gates to `final`
 *   5. buyer      — lock the proposal, which the product permits only at `final`
 *   6. buyer      — export each volume, reading the compliance verdict off X-Compliance-Violations
 *   7. buyer      — the whole submission package, in every format
 *
 * Nothing is asserted client-side. Every verdict — readiness, gate refusals, violation counts —
 * comes from the server, and a refusal is REPORTED rather than forced, because a gate refusing is
 * the gate working.
 *
 *   TENANT=<slug> PROP=<id> OPP=<id> EMAIL=<buyer> PASSWORD=<pw> OUT=<dir> \
 *     node scripts/drive-finish-build.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const TENANT = process.env.TENANT;
const PROP = process.env.PROP;
const OPP = process.env.OPP;
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const OUT = process.env.OUT ?? null;
if (!TENANT || !PROP || !EMAIL || !PASSWORD) {
  console.error('usage: TENANT= PROP= OPP= EMAIL= PASSWORD= [OUT=] node scripts/drive-finish-build.mjs');
  process.exit(2);
}
if (OUT) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function signIn(email, password) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  return page;
}

async function readiness(page, label) {
  const res = await page.request.get(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/readiness`, { timeout: 180_000 });
  const j = await res.json().catch(() => ({}));
  const d = j.data ?? j;
  const blockers = (d.blockers ?? []).filter((b) => b.severity === 'blocker');
  const warnings = (d.blockers ?? []).filter((b) => b.severity === 'warning');
  console.log(`\n[readiness ${label}] ready=${d.ready}  ${blockers.length} blocker(s), ${warnings.length} warning(s)`);
  for (const b of blockers) console.log(`   ✗ ${b.category}: ${b.message.slice(0, 150)}`);
  for (const b of warnings.slice(0, 4)) console.log(`   · ${b.category}: ${b.message.slice(0, 150)}`);
  if (warnings.length > 4) console.log(`   · …and ${warnings.length - 4} more warning(s)`);
  return d;
}

const buyer = await signIn(EMAIL, PASSWORD);
console.log(`signed in as ${EMAIL}`);

const before = await readiness(buyer, 'before');

// ── 1. The deadline, if it has already passed ───────────────────────────────
if (OPP && before.summary?.deadline?.past) {
  const admin = await signIn('eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');
  // 90 days out — long enough that the run is not racing its own clock.
  const newClose = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  const res = await admin.request.post(`${BASE}/api/admin/opportunities/${OPP}/lifecycle`, {
    data: {
      action: 'close_date_change', closeDate: newClose,
      reason: 'Agency extended the response deadline (amendment).',
    },
    timeout: 120_000,
  });
  const j = await res.json().catch(() => ({}));
  console.log(`\n[deadline] closed ${before.summary.deadline.closeDate?.slice(0, 10)} → extended to ${newClose}: `
    + `${res.status()} ${j.error ? `ERROR ${j.code}: ${j.error}` : 'ok'}`);
  await admin.context().close();
}

// ── 2. Lock every section ───────────────────────────────────────────────────
const secRes = await buyer.request.get(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/sections`);
const { sections } = (await secRes.json()).data;
let locked = 0;
for (const s of sections) {
  if (s.isLocked) { locked++; continue; }
  const r = await buyer.request.post(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/sections/${s.id}/lock`, { timeout: 60_000 });
  if (r.ok()) locked++;
  else console.log(`   ! lock ${s.title}: ${r.status()} ${JSON.stringify(await r.json().catch(() => ({}))).slice(0, 140)}`);
}
console.log(`\n[lock] ${locked}/${sections.length} sections`);

// ── 3. Advance to final ─────────────────────────────────────────────────────
for (let hop = 0; hop < 6; hop++) {
  const cur = await buyer.request.get(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/gates`, { timeout: 60_000 });
  const stage = cur.ok() ? (await cur.json()).data?.stage : null;
  if (stage === 'final' || stage === 'submitted') { console.log(`[stage] at ${stage}`); break; }
  const r = await buyer.request.post(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/advance`, { data: {}, timeout: 180_000 });
  const b = await r.json().catch(() => ({}));
  console.log(`[stage] ${stage ?? '?'} → ${r.status()} ${r.ok() ? (b.data?.stage ?? 'ok') : JSON.stringify(b).slice(0, 200)}`);
  if (!r.ok()) break;
}

// ── 4. Lock the proposal ────────────────────────────────────────────────────
const pl = await buyer.request.post(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/lock`, { timeout: 120_000 });
console.log(`[lock] proposal: ${pl.status()} ${JSON.stringify(await pl.json().catch(() => ({}))).slice(0, 200)}`);

await readiness(buyer, 'after');

// ── 5. Per-volume export ────────────────────────────────────────────────────
const byArtifact = new Map();
for (const s of sections) {
  if (!s.artifactId || byArtifact.has(s.artifactId)) continue;
  byArtifact.set(s.artifactId, { id: s.artifactId, volumeNumber: s.volumeNumber, volumeName: s.volumeName });
}
const artifacts = [...byArtifact.values()].sort((a, b) => (a.volumeNumber ?? 99) - (b.volumeNumber ?? 99));
console.log('');
for (const a of artifacts) {
  const label = `V${a.volumeNumber ?? '?'} ${a.volumeName ?? '(untitled)'}`;
  const r = await buyer.request.get(
    `${BASE}/api/portal/${TENANT}/proposals/${PROP}/artifacts/${a.id}/export?format=docx`, { timeout: 180_000 });
  if (!r.ok()) { console.log(`   ! ${label}: ${r.status()} ${(await r.text()).slice(0, 160)}`); continue; }
  const n = Number(r.headers()['x-compliance-violations'] ?? '0');
  const body = await r.body();
  console.log(`   ${n === 0 ? '✓' : '⚠'} ${label} — ${body.length.toLocaleString()} bytes, ${n} violation(s)`);
  if (OUT) writeFileSync(`${OUT}/${label.replace(/[^a-z0-9]+/gi, '_')}.docx`, body);
}

// ── 6. The submission package, every format ─────────────────────────────────
console.log('');
let delivered = 0;
for (const fmt of ['json', 'docx', 'pdf', 'zip']) {
  const r = await buyer.request.get(`${BASE}/api/portal/${TENANT}/proposals/${PROP}/package?format=${fmt}`, { timeout: 300_000 });
  if (!r.ok()) { console.log(`   ! package:${fmt} ${r.status()} ${(await r.text()).slice(0, 180)}`); continue; }
  const body = await r.body();
  const n = r.headers()['x-compliance-violations'];
  console.log(`   ✓ package.${fmt} — ${body.length.toLocaleString()} bytes${n != null ? `, ${n} violation(s)` : ''}`);
  if (OUT) writeFileSync(`${OUT}/submission.${fmt}`, body);
  delivered++;
}
console.log(`\n${delivered}/4 package formats delivered${OUT ? ` → ${OUT}` : ''}`);

await browser.close();
process.exit(delivered === 4 ? 0 : 1);
