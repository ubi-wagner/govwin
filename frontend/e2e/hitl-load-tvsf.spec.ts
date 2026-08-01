/**
 * Load the TVSF opportunity into the master Opps list, with the REAL DMVEC/Round-45 format
 * (Proposal + Budget, 7 pages total) and dates "opened 2 weeks ago, closes in 2 weeks".
 * Digested format: docs/runbook-assets/fondation-tvs/TVSF_FORMAT.md.
 *
 * Drives the proven ingest → curate(2 volumes) → approve → push chain (same routes verified
 * green by hitl-onboard-tvs.spec.ts). Self-authenticating (`hitl` project) as the seeded
 * rfp_admin. Dates: intake sets close_date + posted_date; open_date is set to "2 weeks ago"
 * by the psql step in the runbook (the intake API doesn't take open_date, and push COALESCEs
 * it to now()). Prints OPPID/SOLID for that step.
 *
 * Requires a running, seeded instance + scripts/seed-e2e-hitl.mjs.
 */
import { test, expect } from '@playwright/test';

const PW = process.env.E2E_PW || 'E2ETest!2026';
// "opened 2 weeks ago, closes in two weeks" — overridable; defaults anchor to the ask.
const POSTED = process.env.TVSF_POSTED || '2026-07-17'; // 2 weeks before 2026-07-31
const CLOSE = process.env.TVSF_CLOSE || '2026-08-14';   // 2 weeks after 2026-07-31
const SFX = process.env.RUN_SFX || String(Date.now()).slice(-6);

// Volume 1 — Proposal: the DMVEC Round-45 questions as required items (7-page limit; Abstract
// excluded). Volume 2 — Budget: one spreadsheet item (spend types: Personnel/Equipment/Supplies/
// Purchased Services → OTF Project Funds + Total). Structure only — no DMVEC prose.
const VOLUMES = [
  { name: 'Proposal', format: 'custom', items: [
    { name: 'Abstract (public, non-confidential; excluded from the 7-page limit)', type: 'word_doc' },
    { name: '#1 Market Opportunity (TAM)', type: 'word_doc' },
    { name: '#2 Overview of the Technology', type: 'word_doc' },
    { name: '#3 Development Stage', type: 'word_doc' },
    { name: '#4 Commercialization Strategy (SAM)', type: 'word_doc' },
    { name: '#5 Intellectual Property', type: 'word_doc' },
    { name: '#6 Business Model & Pro-forma P&L', type: 'word_doc', pageLimit: 1 },
    { name: '#7 Financial Stage (capital plan)', type: 'word_doc' },
    { name: '#8 Team / Management', type: 'word_doc' },
    { name: '#9 Competitive Landscape', type: 'word_doc' },
    { name: '#10 Economic Impact (Ohio)', type: 'word_doc' },
    { name: '#11 Project Plan (milestones)', type: 'word_doc' },
  ] },
  { name: 'Budget', format: 'custom', items: [
    { name: '#12 Budget by spend type (Personnel/Equipment/Supplies/Purchased Services → OTF Project Funds + Total)', type: 'spreadsheet' },
  ] },
];

test('load the TVSF opportunity (real format, dated open-2wks / close-2wks)', async ({ page }) => {
  test.setTimeout(120_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);

  await page.goto('/login');
  await page.fill('input[name="email"]', 'e2e-rfpadmin@rfppipeline.test');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  // ── ingest → master Opps (storage-free intake door; close + posted dates) ──
  const up = await page.request.post('/api/admin/intake', {
    data: {
      title: `TVSF Round 45 — Technology Validation & Startup Fund (${SFX})`,
      agency: 'Ohio Third Frontier · DMVEC (Dayton/Miami Valley Entrepreneurs Center)',
      programType: 'tvsf',
      solicitationNumber: `TVSF-R45-${SFX}`,
      closeDate: CLOSE,
      postedDate: POSTED,
      description: 'Ohio Third Frontier Technology Validation & Startup Fund — Round 45. Proposal (12 questions, 7-page limit; Abstract excluded) + Budget by spend type. Format digested from the DMVEC template.',
    },
  });
  log('intake → master Opps', { status: up.status() });
  expect(up.status()).toBe(200);
  const { opportunityId: oppId, solicitationId: solId } = (await up.json()).data;
  log('  → ids', { oppId, solId });

  // ── curate: claim → skip_shredder → define the 2 TVSF volumes ──
  await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'claim' } });
  await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'skip_shredder' } });
  const ia = await page.request.post(`/api/admin/rfp-curation/${solId}/ingest-assist`, {
    data: { publish: false, parsed: {
      compliance: {
        submissionFormat: 'Proposal (≤7 pages, Abstract excluded) + Budget',
        pageLimitTechnical: 7,
        requiredSections: VOLUMES[0].items.map((i) => i.name),
        requiredDocuments: ['Budget (spend-type table)'],
      },
      volumes: VOLUMES } },
  });
  log('curate → 2 volumes (Proposal + Budget)', { status: ia.status(), body: await ia.text().then((t) => t.slice(0, 140)) });
  expect(ia.status()).toBe(200);

  // ── spotlight + approve + push ──
  await page.request.patch(`/api/admin/rfp-curation/${solId}`, {
    data: { spotlightSummary: 'Ohio Third Frontier TVSF (Round 45) — technology validation & startup commercialization grant; Proposal (7pp) + Budget; state match/leverage.' },
  });
  await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'request_review' } });
  const approve = await page.request.post('/api/tools/solicitation.approve', { data: { input: { solicitationId: solId } } });
  log('approve', { status: approve.status() });
  const push = await page.request.post('/api/tools/solicitation.push', { data: { input: { solicitationId: solId } } });
  log('push → bridge/cards', { status: push.status(), body: await push.text().then((t) => t.slice(0, 160)) });
  expect(push.status()).toBe(200);

  log('DONE — TVSF opportunity loaded', { oppId, solId, posted: POSTED, close: CLOSE });
  console.log(`\nOPPID=${oppId} SOLID=${solId}`); // for the psql open_date step (see runbook)
});
