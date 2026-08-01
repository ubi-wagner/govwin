/**
 * Load a small set of SBIR/STTR master opportunities relevant to Foundation (3D-printed
 * concrete formwork / additive construction), so they rank against Foundation's spotlight
 * buckets next to the TVSF build. Same proven intake → curate → approve → push chain as
 * hitl-load-tvsf.spec.ts. Self-authenticating (`hitl` project) as the seeded rfp_admin.
 *
 * These are discovery opportunities (not built), so each gets a single Technical volume.
 * Dates: posted ~3–5 weeks ago, close 3–7 weeks out (all currently OPEN).
 *
 * Requires a running, seeded instance + scripts/seed-e2e-hitl.mjs. Prints OPP ids.
 */
import { test, expect } from '@playwright/test';

const PW = process.env.E2E_PW || 'E2ETest!2026';
const SFX = process.env.RUN_SFX || String(Date.now()).slice(-6);

// fit = intended relevance to Foundation's buckets (drives the expected ranking Paul sees).
const OPPS = [
  {
    key: 'army-aces', fit: 'very-high',
    title: 'Additive Construction of Expeditionary Structures (ACES)',
    agency: 'U.S. Army — ERDC (Engineer Research & Development Center)',
    programType: 'sbir', number: `A24-ACES-${SFX}`,
    posted: '2026-07-01', close: '2026-09-05',
    description: '3D-printed concrete structures for expeditionary basing — additive construction, local-material concrete, automated placement. Directly adjacent to Foundation additive-construction / concrete-printing core.',
    summary: 'Army additive construction (3D concrete printing) — very high fit with Foundation additive-construction + concrete-materials buckets.',
  },
  {
    key: 'nsf-constr-automation', fit: 'high',
    title: 'SBIR Phase I — Advanced Manufacturing: Construction Automation & Robotics',
    agency: 'National Science Foundation (NSF)',
    programType: 'sbir', number: `NSF-AM-CA-${SFX}`,
    posted: '2026-06-26', close: '2026-08-28',
    description: 'Automation and robotics for the construction sector — advanced manufacturing, repeatable automated workflows for the built environment. Strong fit with Foundation advanced-manufacturing/automation bucket.',
    summary: 'NSF advanced-manufacturing / construction automation — high fit (automation + construction-tech buckets).',
  },
  {
    key: 'doe-low-carbon-concrete', fit: 'medium-high',
    title: 'SBIR — Low-Carbon Concrete & Cement Materials',
    agency: 'U.S. Department of Energy (DOE)',
    programType: 'sbir', number: `DE-LCC-${SFX}`,
    posted: '2026-06-20', close: '2026-08-20',
    description: 'Low-carbon concrete/cement formulations and placement. Fits Foundation materials (concrete/low-carbon cement) bucket; Foundation uses common local concrete and can adopt low-carbon mixes.',
    summary: 'DOE low-carbon concrete/cement — medium-high fit (materials bucket).',
  },
  {
    key: 'nasa-offworld-construction', fit: 'medium',
    title: 'SBIR — Additive Construction for Off-World Habitats',
    agency: 'NASA',
    programType: 'sbir', number: `NASA-ACO-${SFX}`,
    posted: '2026-06-15', close: '2026-09-12',
    description: 'Additive construction for lunar/planetary habitats — adjacent additive-construction technology, non-terrestrial materials. Moderate fit (additive construction, different environment).',
    summary: 'NASA off-world additive construction — medium fit (adjacent additive construction).',
  },
  {
    key: 'nsf-built-env-robotics', fit: 'medium',
    title: 'STTR — Robotics for the Built Environment',
    agency: 'National Science Foundation (NSF)',
    programType: 'sttr', number: `NSF-BE-ROB-${SFX}`,
    posted: '2026-07-05', close: '2026-09-19',
    description: 'University-partnered robotics for construction and the built environment. Fits automation bucket; STTR requires a research-institution partner (Foundation can pair with a local school per its commercialization plan).',
    summary: 'NSF STTR robotics for the built environment — medium fit (automation; university partner).',
  },
];

test('load Foundation-relevant SBIR/STTR master opportunities', async ({ page }) => {
  test.setTimeout(180_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);

  await page.goto('/login');
  await page.fill('input[name="email"]', 'e2e-rfpadmin@rfppipeline.test');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  const ids: Record<string, string> = {};
  for (const o of OPPS) {
    const up = await page.request.post('/api/admin/intake', {
      data: {
        title: `${o.title} (${SFX})`,
        agency: o.agency,
        programType: o.programType,
        solicitationNumber: o.number,
        closeDate: o.close,
        postedDate: o.posted,
        description: o.description,
      },
    });
    expect(up.status(), `intake ${o.key}`).toBe(200);
    const { opportunityId: oppId, solicitationId: solId } = (await up.json()).data;

    await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'claim' } });
    await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'skip_shredder' } });
    await page.request.post(`/api/admin/rfp-curation/${solId}/ingest-assist`, {
      data: { publish: false, parsed: {
        compliance: { submissionFormat: 'SBIR/STTR technical volume', pageLimitTechnical: 15, requiredSections: ['Technical Volume'], requiredDocuments: [] },
        volumes: [{ name: 'Volume I — Technical', format: 'custom', items: [{ name: 'Technical Volume', type: 'word_doc' }] }],
      } },
    });
    await page.request.patch(`/api/admin/rfp-curation/${solId}`, { data: { spotlightSummary: o.summary } });
    await page.request.post(`/api/admin/rfp-curation/${solId}/triage`, { data: { action: 'request_review' } });
    const approve = await page.request.post('/api/tools/solicitation.approve', { data: { input: { solicitationId: solId } } });
    expect(approve.status(), `approve ${o.key}`).toBe(200);
    const push = await page.request.post('/api/tools/solicitation.push', { data: { input: { solicitationId: solId } } });
    expect(push.status(), `push ${o.key}`).toBe(200);
    ids[o.key] = oppId;
    log(`loaded ${o.key} [${o.fit}]`, { oppId });
  }

  log('DONE — SBIR/STTR opps loaded', ids);
  console.log('\nSBIR_IDS=' + JSON.stringify(ids));
});
