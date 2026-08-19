/**
 * Attach the proposal's required supporting documents through the product's OWN presigned-upload
 * flow, as the buying tenant_admin.
 *
 * The submission-readiness gate treats a required `proposal_supporting_docs` row still in status
 * 'missing' as a hard blocker — a submission missing a required form is rejected without being
 * evaluated. That is correct and it is not something the drafter can clear: a DD Form 2345 needs a
 * signature, a letter of support comes from a third party. The company supplies the file.
 *
 * So this does what the company does: export the volume the product has already authored for that
 * requirement, and attach it against the matching slot. Where a slot has no authored counterpart,
 * it is reported rather than filled with something invented.
 *
 *   POST …/supporting-docs { docId, filename, contentType, fileSize } → presigned PUT
 *   PUT  <uploadUrl>                                                  → the bytes
 *
 * Run: PROP=<proposalId> node scripts/t3cp-attach-docs.mjs [format]
 */
import { chromium } from '@playwright/test';

const TENANT = process.env.TENANT ?? 'immobileyes';
const PROP = process.env.PROP;
const FORMAT = process.argv[2] ?? 'docx';
if (!PROP) { console.error('PROP=<proposalId> required'); process.exit(1); }

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/**
 * Match a requirement label to the section that answers it.
 *
 * Substring containment is not enough: "CMMC Reps & Certs" and "Reps & Certifications" are the
 * same requirement and neither contains the other. Score on shared word STEMS instead — "certs"
 * and "certifications" agree on the first four characters — and take the best-scoring section, so
 * the match is a ranking rather than a yes/no that silently drops a real pair.
 */
const STOP = new Set(['the', 'and', 'for', 'of', 'a', 'an', 'to']);
const tokens = (s) => (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
const stemHit = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));
const score = (label, title) => {
  const [ls, ts] = [tokens(label), tokens(title)];
  if (!ls.length || !ts.length) return 0;
  return ls.filter((l) => ts.some((t) => stemHit(l, t))).length;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', process.env.EMAIL ?? 'admin@immobileyes.test');
await page.fill('input[type="password"]', process.env.PASSWORD ?? 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

const docsRes = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/supporting-docs`);
if (!docsRes.ok()) { console.error('[docs]', docsRes.status(), (await docsRes.text()).slice(0, 300)); process.exit(1); }
const docsBody = (await docsRes.json()).data;
const docs = (docsBody.docs ?? docsBody.documents ?? []).filter((d) => d.status === 'missing' && d.isRequired);
console.log(`[attach] ${docs.length} required documents still missing\n`);

const secRes = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/sections`);
const { sections } = (await secRes.json()).data;

let attached = 0;
for (const d of docs) {
  const label = d.requirementLabel ?? d.label ?? d.category ?? '(unnamed)';
  // The section the product authored for this requirement — its content IS the document.
  const ranked = sections.map((s) => ({ s, n: score(label, s.title) })).sort((a, b) => b.n - a.n);
  const sec = ranked[0]?.n > 0 ? ranked[0].s : null;
  if (!sec) {
    console.log(`  – ${label}: no authored section to attach; the company must supply this file`);
    continue;
  }

  // Export the SECTION, not its volume. Four of these requirements share one Supporting Documents
  // artifact, so exporting by artifactId attached the whole volume four times — four identical
  // files, none of which is the document the requirement names.
  //
  // The section export route takes the CanvasDocument in the body (it renders what the editor has,
  // not what is stored), so read the current canvas from the section's version history first.
  const hist = await page.request.get(
    `/api/portal/${TENANT}/proposals/${PROP}/sections/${sec.id}/versions?limit=1`);
  const latest = (await hist.json().catch(() => ({})))?.data?.versions?.[0]?.version_number;
  if (latest == null) { console.log(`  ! ${label}: no version to export`); continue; }
  const full = await page.request.get(
    `/api/portal/${TENANT}/proposals/${PROP}/sections/${sec.id}/versions?version=${latest}`);
  const canvas = (await full.json().catch(() => ({})))?.data?.content;
  if (!Array.isArray(canvas?.nodes)) { console.log(`  ! ${label}: version ${latest} has no nodes`); continue; }

  const exp = await page.request.post(
    `/api/portal/${TENANT}/proposals/${PROP}/sections/${sec.id}/export`,
    { data: { document: canvas, format: FORMAT }, timeout: 180_000 });
  if (!exp.ok()) { console.log(`  ! ${label}: export ${exp.status()}`); continue; }
  const bytes = await exp.body();

  const filename = `${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.${FORMAT}`;
  const presign = await page.request.post(`/api/portal/${TENANT}/proposals/${PROP}/supporting-docs`, {
    data: { docId: d.id, filename, contentType: MIME[FORMAT] ?? 'application/octet-stream', fileSize: bytes.length },
    timeout: 60_000,
  });
  const pj = await presign.json().catch(() => ({}));
  if (!presign.ok() || !pj?.data?.uploadUrl) {
    console.log(`  ! ${label}: presign ${presign.status()} ${JSON.stringify(pj).slice(0, 180)}`);
    continue;
  }

  const put = await page.request.put(pj.data.uploadUrl, {
    data: bytes, headers: { 'Content-Type': MIME[FORMAT] ?? 'application/octet-stream' }, timeout: 180_000,
  });
  if (!put.ok()) { console.log(`  ! ${label}: PUT ${put.status()}`); continue; }
  attached++;
  console.log(`  ✓ ${label} ← ${sec.title} (${bytes.length.toLocaleString()} bytes)`);
}

const after = await page.request.get(`/api/portal/${TENANT}/proposals/${PROP}/supporting-docs`);
const sum = (await after.json()).data;
console.log(`\n[attach] ${attached} attached · missing now: ${sum.missing ?? sum.summary?.missing ?? '?'}`);
await browser.close();
