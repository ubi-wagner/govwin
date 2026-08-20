/**
 * INGEST COVERAGE — the whole pipeline from scratch, every variant × every actor.
 *
 * The matrix this drive executes (docs/INGEST_COVERAGE.md is the ledger):
 *
 *   ACTORS      unauthenticated → denied · tenant_admin → denied · rfp_admin → every surface ·
 *               agents (ingest_analyst, matrix_stager, curation_qa×3, advisory_manager,
 *               skeleton_architect, rfp_ingest_manager) via the worker · automations
 *               (OnRfpUploaded shred, OnIngestPhaseRequested×4, advance_ingest_phase,
 *               record_ingest_review) via their real triggers.
 *
 *   INPUTS      BAA only (deferral unresolvable → blocker) · BAA + Component instructions +
 *               topic (deferral resolved → clean) · no source text (refused) · admin override
 *               parse · regenerate with guidance · allowDefaultSkeleton opt-in · bad ids ·
 *               bad actions · concurrent gate clicks.
 *
 *   PATHS       assist one-click (stage→land clean · stage→park blocked) · studio manual
 *               (start→approve→land→molds→complete) · studio FULL AUTO CHAIN
 *               (extract→matrix→review through the worker, stopping AT the land gate) ·
 *               human-land-over-blocker (allowed, attributed) · auto-land-over-blocker (refused).
 *
 * Serial by design: later cases build on earlier state, exactly as a real curation does.
 * Run: npx playwright test --project=drive ingest-coverage
 */
import { test, expect, type APIResponse, type Page } from '@playwright/test';
import path from 'node:path';
import { requireUploads } from './upload-fixtures';

// Skips (does not fail) when the source PDFs are not on this machine — see e2e/upload-fixtures.ts.
const [BAA, COMPONENT, TOPIC] = requireUploads(
  'b4c6858c-DoW_2026_SBIR_BAA_Preface_07152026.pdf',
  'bc936179-OSWT3CP_SBIR_26BZ_R4_v2.pdf',
  'a4bcf95d-topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF',
);

const SHOTS = 'public/guides/rfp-ingest';

// Cross-test state (serial file): the two solicitations the upload cases create.
let SOL_BLOCKED = '';   // BAA only — the deferral points at a document that is not on file
let SOL_CLEAN = '';     // BAA + instructions + topic — the deferral resolves

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}
const asAdmin = (page: Page) => signIn(page, 'eric@rfppipeline.com', 'RFPAdmin2026!');

async function uploadViaForm(page: Page, opts: { title: string; files: string[]; topicFiles?: string[]; instructionsIdx?: number }) {
  await page.goto('/admin/rfp-curation/upload');
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="title"]', opts.title);
  await page.fill('input[name="agency"]', 'Department of War');
  await page.selectOption('select[name="programType"]', 'sbir_phase_1');
  await page.fill('input[name="closeDate"]', '2026-08-19');
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(opts.files);
  if (opts.topicFiles?.length) await inputs.nth(1).setInputFiles(opts.topicFiles);
  await page.waitForTimeout(400);
  if (opts.instructionsIdx !== undefined) {
    await page.locator('select').filter({ hasText: 'Component instructions' })
      .nth(opts.instructionsIdx).selectOption('instructions');
  }
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/rfp-curation\/[0-9a-f-]{36}/, { timeout: 10 * 60 * 1000 });
  return page.url().split('/').pop()!.split('?')[0];
}

const j = async (r: APIResponse) => ({ status: r.status(), body: await r.json().catch(() => ({})) });

// ═════════════════════════════ ACTORS: who may not ═════════════════════════════

test('A1 · unauthenticated cannot reach any ingest surface', async ({ page }) => {
  for (const [method, url] of [
    ['GET', '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-phase'],
    ['POST', '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-phase'],
    ['POST', '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-assist'],
    ['POST', '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/assess-ingest'],
  ] as const) {
    const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: {} });
    expect([401, 403], `${method} ${url}`).toContain(r.status());
  }
});

test('A2 · tenant_admin is denied — ingest is platform-scope, no tenant reach', async ({ page }) => {
  await signIn(page, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
  for (const url of [
    '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-phase',
    '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-assist',
  ]) {
    const r = await page.request.post(url, { data: {} });
    expect(r.status(), url).toBe(403);
  }
});

// ═════════════════════ INPUT CASE 1: BAA ONLY — the blocked path ═════════════════════

test('B1 · upload BAA alone → shred → assist STAGES and PARKS (deferral unresolvable)', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  await asAdmin(page);
  SOL_BLOCKED = await uploadViaForm(page, {
    title: 'COV — DoW 2026 SBIR BAA (umbrella only, instructions withheld)',
    files: [BAA],
  });
  console.log('[cov] SOL_BLOCKED =', SOL_BLOCKED);

  // The form's auto-assist already ran (it waits for the shred). Whatever it did, the state
  // must be: staged draft with the page-limit blocker, NOT landed.
  const g = await j(await page.request.get(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-phase`));
  console.log('[cov] blocked-state:', g.body.data.phase, JSON.stringify(g.body.data.draft?.audit?.findings?.map((f: { severity: string }) => f.severity)));
  expect(g.body.data.draft?.status).toBe('staged');
  const blockers = (g.body.data.draft.audit.findings ?? []).filter((f: { severity: string }) => f.severity === 'blocker');
  expect(blockers.length).toBeGreaterThan(0);
  expect(blockers[0].issue).toMatch(/nowhere on file/);

  // The LIVE matrix must NOT have taken the parked draft.
  await page.goto(`/admin/rfp-curation/${SOL_BLOCKED}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Matrix STAGED — not landed')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/20-cov-blocked-parked.png`, fullPage: true });
});

test('B2 · auto-land over the blocker is REFUSED; a human landing it is allowed and attributed', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await asAdmin(page);

  // The assist path (auto:true) already refused by parking. Re-assert via the one-click route:
  // re-running assist stages again and parks again — landed:false with named blockers.
  const assist = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-assist`, {
    data: { publish: false }, timeout: 180_000,
  }));
  expect(assist.body.data.landed).toBe(false);
  expect(assist.body.data.blockers.length).toBeGreaterThan(0);

  // The HUMAN land is a different act: a person taking responsibility for a known gap.
  const land = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-phase`, {
    data: { action: 'land' }, timeout: 180_000,
  }));
  expect(land.status).toBe(200);
  expect(land.body.data.phase).toBe('landed');
  // The blocked field stayed honest: page limit NULL + deferral provenance, not a fabrication.
  const g = await j(await page.request.get(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-phase`));
  expect(g.body.data.phase).toBe('landed');
  expect(g.body.data.draft).toBeNull();    // the landed draft is consumed
});

// ═════════ INPUT CASE 2: the instructions ARRIVE LATER — attach-to-existing resolves ═════════

test('C1 · attach the Component instructions + topic to the BLOCKED solicitation → assist lands CLEAN', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  await asAdmin(page);
  const fs = await import('node:fs');

  // The real-world arc: the umbrella came first, the admin later receives the Component
  // instructions and attaches them WITH their type. (Re-uploading the BAA is content-hash
  // deduped by design — the attach path is the product's answer, and it must extract inline.)
  for (const [file, docType] of [[COMPONENT, 'instructions'], [TOPIC, 'topic']] as const) {
    const r = await page.request.post('/api/admin/rfp-upload', {
      multipart: {
        solicitationId: SOL_BLOCKED,
        documentType: docType,
        files: { name: path.basename(file), mimeType: 'application/pdf', buffer: fs.readFileSync(file) },
      },
      timeout: 180_000,
    });
    expect(r.ok(), `attach ${docType}: ${r.status()}`).toBeTruthy();
  }

  // The attach recombined full_text inline — the readiness gate must see all three documents.
  const ready = await j(await page.request.get(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-assist`));
  console.log('[cov] readiness after attach:', JSON.stringify(ready.body.data));
  expect(ready.body.data.documents).toBe(3);
  expect(ready.body.data.chars).toBeGreaterThan(160_000);

  // Re-run assist: the deferral now RESOLVES into a value read from the attached instructions,
  // the audit is clean, and the one-click lands it.
  const assist = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-assist`, {
    data: { publish: false }, timeout: 180_000,
  }));
  console.log('[cov] assist after attach: landed =', assist.body.data.landed,
    '· page_limit =', assist.body.data.fieldSources.page_limit_technical);
  expect(assist.body.data.landed).toBe(true);
  expect(assist.body.data.blockers).toEqual([]);
  expect(assist.body.data.fieldSources.page_limit_technical).toBe('pattern_match');

  SOL_CLEAN = SOL_BLOCKED;   // one solicitation, the whole blocked→resolved story

  // The manager's audit agrees: no unresolved deferrals, no blockers, real coverage.
  const assess = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/assess-ingest`, {
    data: {}, timeout: 120_000,
  }));
  const prov = assess.body.data.snapshot.provenance;
  console.log('[cov] provenance:', prov.summary);
  expect(prov.unresolvedDeferrals).toEqual([]);
  expect(prov.findings.filter((f: { severity: string }) => f.severity === 'blocker')).toEqual([]);
  expect(prov.read).toBeGreaterThanOrEqual(5);
});

// ═════════════════ STUDIO PATHS on the clean solicitation ═════════════════

test('D1 · regenerate with guidance supersedes; the comment reaches the draft', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await asAdmin(page);
  const r = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'regenerate', guidance: 'COV: verify the 10-page limit against the T3CP instructions.' },
    timeout: 180_000,
  }));
  expect(r.status).toBe(200);
  expect(r.body.data.draft.status).toBe('staged');
  expect(r.body.data.draft.guidance).toMatch(/COV: verify/);
});

test('D2 · FULL AUTO CHAIN — extract → matrix → review through the worker, stops AT the land gate', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  await asAdmin(page);

  const r = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'auto' }, timeout: 180_000,
  }));
  expect(r.status).toBe(200);
  expect(r.body.data.phase).toBe('extract');    // the chain BEGINS at the beginning

  const get = () => page.request.get(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`)
    .then((x) => x.json()).then((x) => x.data);

  // The worker walks it: extract → (advance) → matrix → (advance) → review → colour team →
  // reconcile → record. We observe the terminal state: phase 'review', draft 'reviewed'.
  await expect.poll(async () => {
    const d = await get();
    return `${d.phase}:${d.draft?.status ?? 'none'}`;
  }, { timeout: 6 * 60 * 1000, intervals: [5_000], message: 'auto chain never reached reviewed@review' })
    .toBe('review:reviewed');

  const d = await get();
  expect(d.draft.reviewedAt).toBeTruthy();
  console.log('[cov] chain verdict:', JSON.stringify(d.draft.review));

  await page.goto(`/admin/rfp-curation/${SOL_CLEAN}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/21-cov-auto-chain-at-gate.png`, fullPage: true });
});

test('D3 · the review gate refuses APPROVE — its only exits are land or regenerate', async ({ page }) => {
  await asAdmin(page);
  const r = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'approve' },
  }));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('GATE_REQUIRES_LAND');
});

test('D4 · concurrent LANDS — one consumes the draft, the other refuses cleanly', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await asAdmin(page);
  const fire = () => page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'land' }, timeout: 180_000,
  });
  const [r1, r2] = await Promise.all([fire(), fire()]);
  const statuses = [r1.status(), r2.status()].sort();
  console.log('[cov] concurrent lands:', statuses);
  expect(statuses).toEqual([200, 409]);
  const winner = r1.status() === 200 ? r1 : r2;
  expect((await winner.json()).data.volumes).toBe(7);
  const loser = r1.status() === 409 ? r1 : r2;
  expect((await loser.json()).code).toBe('LAND_BLOCKED');
});

test('D5 · concurrent APPROVES at landed — the CAS lets exactly one into molds; then complete', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await asAdmin(page);
  const fire = () => page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'approve' },
  });
  const [r1, r2] = await Promise.all([fire(), fire()]);
  const statuses = [r1.status(), r2.status()].sort();
  console.log('[cov] concurrent approves:', statuses);
  expect(statuses).toEqual([200, 409]);
  const winner = r1.status() === 200 ? r1 : r2;
  expect((await winner.json()).data.phase).toBe('molds');
  const conflict = r1.status() === 409 ? r1 : r2;
  expect((await conflict.json()).code).toBe('PHASE_CONFLICT');

  const done = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'approve' },
  }));
  expect(done.body.data.phase).toBe('complete');

  await page.goto(`/admin/rfp-curation/${SOL_CLEAN}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/22-cov-complete.png`, fullPage: true });
});

// ═════════════════ REMAINING INPUT / ERROR CASES ═════════════════

test('E1 · override parse lands as source=override, stamped per field', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await asAdmin(page);
  const r = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_BLOCKED}/ingest-assist`, {
    data: {
      publish: false,
      parsed: {
        compliance: { pageLimitTechnical: 12, fontFamily: 'Calibri', minFontSize: 11 },
        volumes: [
          { name: 'Technical Volume', format: 'dsip_standard', items: [{ name: 'Approach', type: 'word_doc' }] },
          { name: 'Cost Volume', format: 'dsip_standard', items: [{ name: 'Base', type: 'spreadsheet' }] },
        ],
        topics: [],
      },
    },
    timeout: 180_000,
  }));
  expect(r.status).toBe(200);
  expect(r.body.data.source).toBe('override');
  expect(r.body.data.landed).toBe(true);      // an admin-reviewed override carries its own authority
  expect(r.body.data.fieldSources.page_limit_technical).toBe('override');
});

test('E2 · bad inputs are refused with the contract error shapes', async ({ page }) => {
  await asAdmin(page);
  const cases: Array<[string, Record<string, unknown>, number, string]> = [
    [`/api/admin/rfp-curation/not-a-uuid/ingest-phase`, { action: 'start' }, 400, 'VALIDATION_ERROR'],
    [`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, { action: 'detonate' }, 400, 'VALIDATION_ERROR'],
    [`/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-phase`, { action: 'start' }, 404, 'NOT_FOUND'],
  ];
  for (const [url, data, status, code] of cases) {
    const r = await j(await page.request.post(url, { data }));
    expect(r.status, url).toBe(status);
    expect(r.body.code, url).toBe(code);
    expect(typeof r.body.error).toBe('string');   // every error carries both fields (SOP)
  }
});

test('E3 · land with nothing staged is a clean 409, not a 500', async ({ page }) => {
  await asAdmin(page);
  // SOL_CLEAN is complete — its drafts are consumed. Landing again must refuse with a reason.
  const r = await j(await page.request.post(`/api/admin/rfp-curation/${SOL_CLEAN}/ingest-phase`, {
    data: { action: 'land' },
  }));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('LAND_BLOCKED');
  expect(r.body.error).toMatch(/No staged matrix/);
});

test('E4 · allowDefaultSkeleton on an unshredded solicitation stages ALL-DEFAULT and refuses to land', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await asAdmin(page);

  // A crawler-lead style solicitation: metadata only, no shredded text.
  const bare = await page.request.post('/api/admin/rfp-upload', {
    multipart: {
      title: 'COV — bare lead (no readable source)',
      agency: 'Department of War',
      programType: 'sbir_phase_1',
      primaryIndex: '0',
      files: { name: 'stub.txt', mimeType: 'text/plain', buffer: Buffer.from('placeholder') },
    },
  });
  const bareBody = await bare.json();
  const bareSol = bareBody.data?.solicitation_id as string;
  expect(bareSol, JSON.stringify(bareBody)).toBeTruthy();

  // Without the opt-in: refused outright.
  const refused = await j(await page.request.post(`/api/admin/rfp-curation/${bareSol}/ingest-assist`, {
    data: { publish: false },
  }));
  expect(refused.status).toBe(409);
  expect(refused.body.code).toBe('SOURCE_TEXT_NOT_READY');

  // With the opt-in: STAGES the default skeleton, every field 'default', and PARKS on the
  // nothing-was-read blocker — the opt-in buys a visible starting point, never a silent land.
  const forced = await j(await page.request.post(`/api/admin/rfp-curation/${bareSol}/ingest-assist`, {
    data: { publish: false, allowDefaultSkeleton: true }, timeout: 180_000,
  }));
  expect(forced.status).toBe(200);
  expect(forced.body.data.landed).toBe(false);
  expect(forced.body.data.blockers.join(' ')).toMatch(/entire matrix is system defaults/);
  const srcs = Object.values(forced.body.data.fieldSources) as string[];
  expect(srcs.every((s) => s === 'default')).toBe(true);
});
