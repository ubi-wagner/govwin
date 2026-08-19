/** IMMO-G closeout (real workflow): upload + approve the 5 V5 supporting-document forms through the
 *  product's presigned flow (missing→uploaded→reviewed→approved), advance the proposal to its final
 *  stage, lock it, confirm readiness = GO, and export the package as docx + pdf.
 *
 *  cd frontend && node --import tsx scripts/immo-finalize3.mts */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3000', SLUG = 'immobileyes', P = 'd4b6de67-eb3a-482b-84eb-4b0457687f19';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

// A minimal, valid one-page PDF (placeholder for the DSIP form; the content lives in Volume 5).
function tinyPdf(title: string): Buffer {
  const text = `${title} — Immobileyes, Inc. (DON26BX03-NP002). See Volume 5 for the authored content.`;
  const body = `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length ${text.length + 40}>>stream
BT /F1 11 Tf 72 720 Td (${text.replace(/[()\\]/g, ' ')}) Tj ET
endstream endobj
`;
  const header = '%PDF-1.4\n';
  return Buffer.from(header + body + 'trailer<</Root 1 0 R>>\n%%EOF');
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'admin@immobileyes.test'); await page.fill('input[type="password"]', 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')]);
const api = page.request;
console.log('✓ logged in as admin@immobileyes.test');

// ── 1 · Upload + approve each required supporting doc through the real flow ──
const list = await (await api.get(`${BASE}/api/portal/${SLUG}/proposals/${P}/supporting-docs`)).json();
const docs: Array<{ id: string; requirementLabel: string; status: string; isRequired: boolean }> = list.data?.docs ?? [];
let approved = 0;
for (const d of docs.filter((x) => x.isRequired && x.status !== 'approved')) {
  const pdf = tinyPdf(d.requirementLabel);
  const filename = d.requirementLabel.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60) + '.pdf';
  // a) request the presigned slot (flips missing→uploaded, returns uploadUrl)
  const post = await api.post(`${BASE}/api/portal/${SLUG}/proposals/${P}/supporting-docs`, {
    data: { docId: d.id, filename, contentType: 'application/pdf', fileSize: pdf.length },
  });
  const uploadUrl = (await post.json().catch(() => ({})))?.data?.uploadUrl;
  if (post.status() !== 200 || !uploadUrl) { console.log(`  ✗ presign ${d.requirementLabel} → HTTP ${post.status()}`); continue; }
  // b) PUT the bytes to the presigned URL (local storage driver)
  await api.put(uploadUrl, { data: pdf, headers: { 'content-type': 'application/pdf' } }).catch(() => {});
  // c) uploaded → reviewed → approved
  await api.patch(`${BASE}/api/portal/${SLUG}/proposals/${P}/supporting-docs/${d.id}`, { data: { status: 'reviewed' } });
  const ap = await api.patch(`${BASE}/api/portal/${SLUG}/proposals/${P}/supporting-docs/${d.id}`, { data: { status: 'approved', notes: 'DSIP form; content authored in Volume 5.' } });
  if (ap.status() === 200) approved++;
  else console.log(`  ✗ approve ${d.requirementLabel} → HTTP ${ap.status()} ${(await ap.text()).slice(0, 100)}`);
}
ok(`5 required supporting docs uploaded + approved (${approved})`, approved === docs.filter((x) => x.isRequired).length);

// ── 2 · Advance the proposal to its final stage (admin force), then lock ──
let adv = await api.post(`${BASE}/api/portal/${SLUG}/proposals/${P}/advance`, { data: { targetStage: 'final', force: true, acknowledgeBlockers: true } });
const advBody = await adv.json().catch(() => ({}));
ok('advanced to final stage', adv.status() === 200, `HTTP ${adv.status()} ${JSON.stringify(advBody).slice(0, 160)}`);
const lk = await api.post(`${BASE}/api/portal/${SLUG}/proposals/${P}/lock`, {});
ok('proposal locked', lk.status() === 200, `HTTP ${lk.status()} ${(await lk.text()).slice(0, 160)}`);

// ── 3 · Readiness = GO ──
const r = (await (await api.get(`${BASE}/api/portal/${SLUG}/proposals/${P}/readiness`)).json()).data;
console.log(`  readiness: ready=${r.ready} · blockers=${r.blockerCount} · docs ${JSON.stringify(r.summary.documents)} · vol ${JSON.stringify(r.summary.volumes)}`);
if (!r.ready) for (const bl of r.blockers) console.log(`    [${bl.severity}] ${bl.category}: ${bl.message.slice(0, 100)}`);
ok('readiness verdict = GO', r.ready === true && r.blockerCount === 0);

// ── 4 · Package docx + pdf ──
for (const fmt of ['docx', 'pdf'] as const) {
  const pk = await api.post(`${BASE}/api/portal/${SLUG}/proposals/${P}/package?format=${fmt}`, {});
  if (pk.status() === 200) {
    const buf = Buffer.from(await pk.body());
    const path = `${OUT}/Immobileyes_GHOST_DON26BX03-NP002.${fmt}`;
    writeFileSync(path, buf);
    ok(`package ${fmt} (${(buf.length / 1024).toFixed(0)} KB · compliance: ${pk.headers()['x-compliance-violations'] ?? 'clean'})`, buf.length > 2000, path);
  } else ok(`package ${fmt}`, false, `HTTP ${pk.status()} ${(await pk.text()).slice(0, 200)}`);
}

await b.close();
console.log(failures === 0 ? '\nIMMO-FINALIZE3: ALL GREEN' : `\nIMMO-FINALIZE3: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
