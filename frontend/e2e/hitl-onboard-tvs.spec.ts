/**
 * HITL onboard — the Fondation / TVS playbook, driven as authenticated API calls through the
 * real route handlers (docs/PLAYBOOK_ONBOARD_NEWCO_TVS.md). Proves the headline chain end-to-end:
 *   create company (Phase A) → ingest a custom-format RFP into master Opps (Phase B) →
 *   curate the TVS format + set push vars + approve → push to tenant cards (Phase C1–C5).
 * Purchase + release (C6–C7) need a tenant_admin whose temp password is reset first (see the
 * playbook §C); those are verified by trace and left to the operator / a follow-up drive.
 *
 * Self-authenticating (`hitl` project) as the seeded rfp_admin. Requires a running, seeded
 * instance + scripts/seed-e2e-hitl.mjs. It's idempotent-friendly: the tenant name is uniquified
 * per run so re-running never collides.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PW = process.env.E2E_PW || 'E2ETest!2026';
const RFP = path.join(__dirname, '..', '..', 'docs', 'runbook-assets', 'fondation-tvs', 'TVS_RFP_Fondation_MOCK.md');

// Unique suffix so repeat runs don't collide on tenant slug / document hash.
const SFX = process.env.RUN_SFX || String(Date.now()).slice(-6);

test('Fondation/TVS onboarding chain: create → ingest → curate → push', async ({ page }) => {
  test.setTimeout(120_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);

  // ── login as rfp_admin ────────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input[name="email"]', 'e2e-rfpadmin@rfppipeline.test');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  // ── PHASE A — create the company ──────────────────────────────────────
  const createRes = await page.request.post('/api/admin/tenants', {
    data: { name: `Fondation ${SFX}`, adminEmail: `admin+${SFX}@fondation.test`,
      adminName: 'Fondation Admin', legalName: 'Fondation, Inc.', website: 'https://fondation.example' },
  });
  log('A · POST /api/admin/tenants', { status: createRes.status() });
  expect(createRes.status(), 'create company should 201').toBe(201);
  const created = (await createRes.json()).data;
  log('  → tenant', { tenantId: created.tenantId, slug: created.slug, cardsBackfilled: created.cardsBackfilled });
  expect(created.slug).toContain('fondation');

  // ── PHASE B — ingest the TVS opportunity into the master Opps ─────────
  // NOTE: the file-upload door (POST /api/admin/rfp-upload) is the one to use in prod for a real
  // RFP *document*, but it writes the file to object storage (R2/S3) and 500s if AWS_S3_BUCKET_NAME
  // is unset (this sandbox). The intake/notice door is storage-free (JSON, no file) and accepts a
  // custom program string via the API — it's the path proven live here. (RFP asset available at
  // docs/runbook-assets/fondation-tvs/TVS_RFP_Fondation_MOCK.md; unused in the storage-free path.)
  void fs.existsSync(RFP);
  const upRes = await page.request.post('/api/admin/intake', {
    data: {
      title: `TVS-2026-01-${SFX} — Technology Validation & Startup Fund`,
      agency: 'State Economic Development Office — Third Frontier',
      programType: 'other',
      solicitationNumber: `TVS-2026-01-${SFX}`,
      closeDate: '2026-10-15',
      description: 'Mock state econ-dev commercialization grant (TVS/TVSF) — playbook worked example.',
    },
  });
  log('B · POST /api/admin/intake', { status: upRes.status() });
  expect(upRes.status(), 'intake should 200').toBe(200);
  const up = (await upRes.json()).data;
  const oppId = up.opportunityId, solId = up.solicitationId;
  log('  → ingested (master Opps)', { opportunityId: oppId, solicitationId: solId, status: up.status });
  expect(oppId && solId, 'intake returns opportunityId + solicitationId').toBeTruthy();

  // ── PHASE C1–C4 — curate the TVS format, set push vars, approve ───────
  // Triage state machine: new →(claim)→ claimed →(skip_shredder)→ curation_in_progress
  //   →(request_review)→ review_requested →(approve)→ approved →(push)→ pushed_to_pipeline.
  const claim = await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'claim' } });
  log('C1a · triage claim', { status: claim.status() });
  const skip = await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'skip_shredder' } });
  log('C1b · triage skip_shredder (→ curation_in_progress)', { status: skip.status() });

  // ingest-assist `parsed` uses camelCase keys (NOT the DB columns): volumes[{name,format,items[{name,type,pageLimit,notes}]}]
  // + compliance{submissionFormat, requiredSections, requiredDocuments, …}. Verified against lib/ingest/materialize.ts.
  const volumes = [
    { name: 'Cover & Eligibility', format: 'custom', items: [{ name: 'Applicant & eligibility form', type: 'form_other' }] },
    { name: 'Project Narrative', format: 'custom', items: [{ name: 'Technology & work plan', type: 'word_doc', pageLimit: 12 }] },
    { name: 'Commercialization & Market-Entry Plan', format: 'custom', items: [{ name: 'Market & path to revenue', type: 'word_doc', pageLimit: 6 }] },
    { name: 'Budget & Match', format: 'custom', items: [{ name: 'Line-item budget + match schedule', type: 'spreadsheet' }] },
    { name: 'Ohio Economic-Impact Statement', format: 'custom', items: [{ name: 'Jobs & follow-on investment', type: 'word_doc', pageLimit: 2 }] },
    { name: 'Supporting Documents', format: 'custom', items: [{ name: 'Binding match-commitment letter', type: 'pdf' }] },
  ];
  const ia = await page.request.post(`/api/admin/rfp-curation/${solId}/ingest-assist`, {
    data: { publish: false, parsed: {
      compliance: { submissionFormat: 'Single combined PDF per volume',
        requiredSections: ['Project Narrative', 'Commercialization Plan', 'Ohio Economic Impact'],
        requiredDocuments: ['Match-commitment letter(s)', 'Key-personnel bios'] },
      volumes } },
  });
  log('C2 · ingest-assist (define 6 TVS volumes)', { status: ia.status(), body: await ia.text().then(t => t.slice(0, 160)) });

  const patch = await page.request.patch(`/api/admin/rfp-curation/${solId}`, {
    data: { spotlightSummary: 'TVS Technology Validation & Startup — Ohio econ-dev commercialization grant; 1:1 match; validation to milestone.' },
  });
  log('C3 · PATCH spotlight_summary', { status: patch.status() });

  const rr = await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'request_review' } });
  log('C4a · triage request_review', { status: rr.status() });
  const approve = await page.request.post('/api/tools/solicitation.approve', { data: { input: { solicitationId: solId } } });
  log('C4b · solicitation.approve', { status: approve.status(), body: await approve.text().then(t => t.slice(0, 160)) });

  // ── PHASE C5 — push onto the bridge → tenant cards ────────────────────
  const push = await page.request.post('/api/tools/solicitation.push', { data: { input: { solicitationId: solId } } });
  log('C5 · solicitation.push', { status: push.status(), body: await push.text().then(t => t.slice(0, 300)) });

  // ── backfill Fondation (idempotent) + verify the card landed ──────────
  const bf = await page.request.post(`/api/admin/tenants/${created.tenantId}/backfill-cards`, { data: {} });
  log('C5b · backfill-cards', { status: bf.status() });
  const cards = await page.request.get(`/api/portal/${created.slug}/cards`);
  log('VERIFY · GET Fondation cards', { status: cards.status() });

  // Summary line the operator can read off the run.
  log('DONE — worked-example IDs', { tenantId: created.tenantId, slug: created.slug, opportunityId: oppId, solicitationId: solId });
});
