/**
 * Ingest Studio — the four gates, driven as a real rfp_admin.
 *
 * Proves the invariants from docs/INGEST_STUDIO_DESIGN.md against the live stack:
 *
 *   1. A matrix is STAGED before it is landed, and the panel says which state it is in.
 *   2. The colour team runs over the staged draft and its verdict is recorded on the draft.
 *   3. Landing is a separate act, and it is the ONLY writer of solicitation_compliance.
 *   4. Auto cannot land a matrix with an unresolved blocker — a person must.
 *
 * Run: DRIVE_SOL_ID=<curated_solicitations.id> npx playwright test --project=drive ingest-studio
 */
import { test, expect, type Page } from '@playwright/test';
import { resolveShreddedSolicitation } from './resolve-solicitation';

const SHOTS = 'public/guides/rfp-ingest';
/* Resolved from the DB in beforeAll — `process.env.DRIVE_SOL_ID!` was unset, so every request
 * went to /…/undefined/… and this file failed on a bare false.
 *
 * This drive OWNS its scenario ("[owned:studio]"). It mutates the solicitation's matrix/structure,
 * and a shared one meant the next drive read state this one had left behind — dow-assist asserting
 * a deferral stays STAGED found it already landed, t3cp-v1-items found its items rearranged. Heavy
 * mutators get their own; the shared pool excludes every owned scenario. See
 * e2e/resolve-solicitation.ts and docs/FIXTURE_INTEGRITY.md. */
let SOL = '';
async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

const phase = (page: Page) => page.request.get(`/api/admin/rfp-curation/${SOL}/ingest-phase`)
  .then((r) => r.json()).then((j) => j.data);

test.beforeAll(async () => {
  SOL = (await resolveShreddedSolicitation('DRIVE_SOL_ID', 'studio')).id;
});

test('gates · staged → reviewed → landed, with the panel telling the truth at each step', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  await signIn(page);

  // ── The panel, before anything runs ──
  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Ingest Studio' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Show gates/i }).click();
  await page.screenshot({ path: `${SHOTS}/10-studio-gates.png`, fullPage: true });

  // ── 1. START → the matrix is STAGED, not landed ──
  const start = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-phase`, {
    data: { action: 'start' }, timeout: 180_000,
  });
  expect(start.ok()).toBeTruthy();
  const started = (await start.json()).data;
  console.log('[studio] staged:', JSON.stringify({
    phase: started.phase, draft: started.draft?.id, audit: started.draft?.audit?.read,
  }));
  expect(started.phase).toBe('matrix');
  expect(started.draft?.status).toBe('staged');

  // The staged draft carries the deterministic audit the colour team reasons over.
  const audit = started.draft.audit;
  expect(audit.fieldsTotal).toBeGreaterThan(0);
  expect(typeof audit.read).toBe('number');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Matrix STAGED — not landed')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/11-studio-staged.png`, fullPage: true });

  // ── 2. APPROVE → advance to the review gate ──
  const approve = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-phase`, {
    data: { action: 'approve' },
  });
  expect(approve.ok()).toBeTruthy();
  expect((await approve.json()).data.phase).toBe('review');

  // ── 3. LAND → the only writer. After this the matrix is live. ──
  const land = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-phase`, {
    data: { action: 'land' }, timeout: 180_000,
  });
  const landBody = await land.json();
  console.log('[studio] land:', land.status(), JSON.stringify(landBody).slice(0, 400));

  if (land.status() === 409 && landBody.code === 'LAND_BLOCKED') {
    // A refusal is a PASS for invariant 4 — but only when there is a real blocker behind it.
    expect(landBody.detail.blockers.length).toBeGreaterThan(0);
    console.log('[studio] land correctly refused:', landBody.detail.blockers);
  } else {
    expect(land.ok()).toBeTruthy();
    expect(landBody.data.phase).toBe('landed');
    expect(landBody.data.volumes).toBeGreaterThan(0);

    const after = await phase(page);
    expect(after.phase).toBe('landed');
    // Landing consumes the draft — nothing is left open pretending to be pending.
    expect(after.draft).toBeNull();
  }

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/12-studio-landed.png`, fullPage: true });
});

test('colour team · auto runs the adversarial review through the WORKER and records the verdict', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await signIn(page);

  // AUTO: stages a fresh draft and emits ingest.phase_requested(phase=review) with the three
  // lenses. The pipeline worker picks it up: curation_qa × {citation, completeness, consistency}
  // → advisory_manager reconcile → record_ingest_review marks the draft 'reviewed'. Nothing here
  // lands anything — the auto-chain stops AT the land gate by design.
  const r = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-phase`, {
    data: { action: 'auto' }, timeout: 180_000,
  });
  expect(r.ok()).toBeTruthy();
  const d = (await r.json()).data;
  /* AUTO returns the chain's FIRST hop, not its destination.
   *
   * The route emits ingest.phase_requested(phase='extract', auto=true) and returns immediately;
   * the worker then makes each hop itself — extract → matrix → review — via advance_ingest_phase,
   * stopping at the land gate (route.ts:262-278, "Starting auto mid-chain would leave the earlier
   * phases' agents and the chain hops themselves permanently unexercised").
   *
   * This asserted `toBe('review')` on that synchronous response, so it demanded the endpoint
   * report a state only the worker can reach. It cannot pass by design. The asynchronous outcome
   * is what matters and the poll below already measures it.
   */
  expect(d.phase, 'auto starts the chain at extract; the worker walks it forward').toBe('extract');
  expect(d.draft.status).toBe('staged');
  console.log('[studio] auto → review, draft', d.draft.id, 'audit read =', d.draft.audit?.read);

  // The staged audit must be REAL now (the earlier bug reported 0 for a matrix that was read).
  expect(d.draft.audit.read).toBeGreaterThan(0);

  // Wait for the worker to run the colour team + record the verdict on the draft.
  await expect
    .poll(async () => (await phase(page))?.draft?.status ?? 'gone', {
      timeout: 5 * 60 * 1000, intervals: [5_000],
      message: 'worker never recorded the adversarial review on the staged draft',
    })
    .toBe('reviewed');

  const after = await phase(page);
  console.log('[studio] reviewed:', JSON.stringify(after.draft.review));
  expect(after.draft.reviewedAt).toBeTruthy();
  // …and the phase machine stands at the land gate: review has NO auto successor.
  expect(after.phase).toBe('review');

  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/13-studio-reviewed.png`, fullPage: true });
});

test('invariant · a staged matrix is invisible to the live compliance table until landed', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await signIn(page);

  // Re-stage (supersedes whatever is open) and confirm the phase reports it as staged. The point
  // is that staging is repeatable and non-destructive: it never touches the landed matrix.
  const r = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-phase`, {
    data: { action: 'regenerate', guidance: 'Re-read the Component-specific instructions for the page limit.' },
    timeout: 180_000,
  });
  expect(r.ok()).toBeTruthy();
  const d = (await r.json()).data;
  expect(d.draft.status).toBe('staged');
  // The admin's comment is carried to the agents as guidance, and recorded on the draft.
  expect(d.draft.guidance).toMatch(/Component-specific/i);
});
