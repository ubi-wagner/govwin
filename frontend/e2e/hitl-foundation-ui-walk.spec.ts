/**
 * SCREENSHOT TOUR — Foundation TVSF build through the REAL UI, from selecting the TVSF
 * opportunity to the completed, downloadable proposal. Each step screenshots the actual page.
 * Customer steps run as Kate (tenant_admin); the release runs as e2e-rfpadmin.
 *
 * Orchestrated by scripts/run-ui-walk.sh: steps 1–6 (select→purchase→release→provision→
 * agent drafter) run, then the deck-grounded content is injected (drive-foundation-tvsf.mts
 * DRAFT_ONLY, since the sandbox has no ANTHROPIC_API_KEY), then steps 7–11 (content→matrix→
 * lock→advance→download). Screenshots → docs/proposals/foundation-tvsf/ui-walkthrough/.
 */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';

test.describe.configure({ mode: 'serial' });

const SHOTS = '/home/user/govwin/docs/proposals/foundation-tvsf/ui-walkthrough';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const E2E_PW = process.env.E2E_PW || 'E2ETest!2026';
const SLUG = 'foundation';
const TVSF_OPP = 'd53a22e4-792d-4fe7-8253-a42270fd9981';
const KATE = 'kate.ulepic@foundation3dp.com';
const RFP = 'e2e-rfpadmin@rfppipeline.test';

async function login(page: any, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}
const shot = async (page: any, name: string) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  // A screenshot is this tour's OUTPUT, not its assertion — every step asserts what it means
  // separately. Letting a capture failure fail the step turned a teardown race into a red build.
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`  📸 ${name}`);
  } catch (e) {
    console.log(`  ⚠ ${name} not captured — ${String(e).split('\n')[0]}`);
  }
};
/* Read the state of the proposal this tour is driving.
 *
 * Steps 9 and 10 were written as `if (await button.isVisible()) { click }` with no assertion on the
 * result, so when the control was absent they silently did nothing and reported success. The tour
 * then photographed a DRAFT proposal as "the completed proposal", and step 11's download failed
 * with no visible cause — the package route 403s on anything not locked or submitted. A step that
 * cannot tell whether it worked is worse than one that fails. */
/* PIN TO TVSF, not to "the newest launched portal".
 *
 * This tour drives the TVSF build specifically, and other drives create Foundation portals too —
 * once flex-midwindow stopped skipping, "newest" became ITS fresh draft and step 10 failed
 * asserting that a build it never touched had left draft. Resolve by identity
 * (docs/FIXTURE_INTEGRITY.md). */
async function proposalState(): Promise<{ id: string; stage: string; sections: number; locked: number }> {
  const dsn = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  const sql = postgres(dsn!, { max: 1 });
  try {
    const [r] = await sql<{ id: string; stage: string; sections: number; locked: number }[]>`
      SELECT p.id, p.stage,
             count(s.id)::int AS sections,
             count(s.id) FILTER (WHERE s.is_locked)::int AS locked
      FROM proposal_portals pp
      JOIN tenants t ON t.id = pp.tenant_id AND t.slug = ${SLUG}
      JOIN proposals p ON p.id = pp.proposal_id
      LEFT JOIN proposal_sections s ON s.proposal_id = p.id
      WHERE pp.status = 'launched' AND pp.proposal_id IS NOT NULL
        AND pp.opportunity_id = ${TVSF_OPP}::uuid
      GROUP BY p.id, p.stage, pp.created_at
      ORDER BY pp.created_at DESC LIMIT 1`;
    return r;
  } finally { await sql.end(); }
}

// Reach the provisioned build workspace (portals → "Open build →"), no proposalId needed.
async function openBuild(page: any) {
  /* Navigate straight to the TVSF build rather than clicking the first "Open build" on the page —
   * that link list holds every Foundation portal, so "first" drifts onto another drive's build. */
  const st = await proposalState();
  if (st?.id) {
    await page.goto(`/portal/${SLUG}/proposals/${st.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }
  await page.goto(`/portal/${SLUG}/portals`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByRole('link', { name: /Open build/i }).first().click();
  await page.waitForURL(/\/proposals\//, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

test('step 1 — select the TVSF opportunity (pipeline)', async ({ page }) => {
  await login(page, KATE, PW);
  await page.goto(`/portal/${SLUG}/cards`);
  await shot(page, '01_pipeline_select_tvsf');
  expect(await page.content()).toContain('TVSF');
});

test('step 2 — pin + comp-code purchase (Kate)', async ({ page }) => {
  await login(page, KATE, PW);
  await page.goto(`/portal/${SLUG}/cards`);
  await page.waitForLoadState('networkidle').catch(() => {});
  /* SCOPE TO THE CARD, VIA ITS OWN HEADING.
   *
   * `page.locator('div').filter({has: heading}).filter({has: PinButton}).last()` reads like "the
   * card", and is not: it matches every ANCESTOR div that contains both, and `.last()` only
   * happens to land on the card while exactly one TVSF card exists. Once the database held
   * several ("Ohio TVSF Round 45" and "TVSF Round 45 — …(818079)") it resolved to a wrapper
   * holding seven Pin buttons and the step died on a strict-mode violation with no product defect
   * behind it — the second time this same locator shape has broken here, per the note below.
   *
   * Walk UP from the heading instead: XPath's ancestor axis with [1] is the NEAREST enclosing div
   * that has a Pin button, which is the card by construction, however many siblings exist.
   */
  const heading = page.getByRole('heading', { name: /TVSF Round 45/ }).first();
  await expect(heading, 'no TVSF card on Kate\'s feed').toBeVisible({ timeout: 15_000 });
  const card = heading.locator('xpath=ancestor::div[.//button[contains(normalize-space(.), "Pin")]][1]');
  await card.getByRole('button', { name: /Pin/ }).first().click();
  // Buy from the TVSF CARD, not from the page. This used to read
  //   await page.getByRole('button', { name: 'Purchase' }).click();
  // on the reasoning "only TVSF is pinned → the sole Purchase button", which stopped being true as
  // soon as anything else pinned a Foundation card: strict mode found two identical buttons and the
  // step failed with no product defect behind it. Scoping to the card the test just pinned says what
  // it means and holds however many other cards are pinned beside it.
  const tvsf = heading.locator('xpath=ancestor::div[.//button[normalize-space(.)="Purchase"]][1]');
  await tvsf.getByRole('button', { name: 'Purchase' }).first().click();
  await expect(page.getByRole('button', { name: 'Complete purchase' })).toBeVisible({ timeout: 15_000 });
  await shot(page, '02_purchase_modal');
  await page.getByPlaceholder('Enter code').fill('rfppipelinetest');
  await page.getByRole('button', { name: 'Complete purchase' }).click();
  await page.waitForURL(/portals/, { timeout: 20_000 }).catch(() => {});
  await shot(page, '03_curation_pending');
});

test('step 4 — RFP admin releases the portal', async ({ page }) => {
  await login(page, RFP, E2E_PW);
  await page.goto(`/portal/${SLUG}/portals`);
  // rfp_admin descends into the tenant's RLS shadow account — dismiss the entry gate.
  await page.getByRole('button', { name: /I understand/i }).click({ timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await shot(page, '04a_admin_curation_queue');

  /* RELEASE IS A ONE-WAY TRANSITION, so this step can only be performed once per portal.
   *
   * It used to click "Release to customer" unconditionally. On any run after the first the portal
   * is already `launched`, that button is correctly not rendered, and the step died on a 60-second
   * click timeout that read like a broken release control. What this step is FOR is the released
   * state — a provisioned build the customer can open — and that is true whether this run performed
   * the flip or an earlier one did.
   */
  const release = page.getByRole('button', { name: /Release to customer/i }).first();
  if (await release.count() > 0) {
    await release.click();
  } else {
    console.log('[walk] no portal awaiting release — already launched; asserting the end state');
  }
  await expect(
    page.getByRole('link', { name: /Open build/i }).first(),
    'a released portal must offer its provisioned build',
  ).toBeVisible({ timeout: 25_000 });
  await shot(page, '04b_released_provisioned');
});

test('step 5 — provisioned build workspace (empty sections)', async ({ page }) => {
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  await shot(page, '05_build_workspace_empty');
});

test('step 6 — the AI drafter (section_drafter agent)', async ({ page }) => {
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  // The "AI Section Drafter" panel ("13 empty sections ready for AI drafting") sits on the
  // All Sections tab with a "Draft All Sections" button — the section_drafter agent entrypoint.
  await shot(page, '06a_ai_drafter_panel');
  const draftAll = page.getByRole('button', { name: /Draft All Sections/i }).first();
  if (await draftAll.isVisible().catch(() => false)) {
    await draftAll.click().catch(() => {});
    await page.waitForTimeout(4000); // let the drafter fan out (placeholder without a live key)
  }
  await shot(page, '06b_agent_drafting');
});

test('step 7 — a drafted section in the editor', async ({ page }) => {
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  await page.getByRole('button', { name: /Artifacts/i }).first().click().catch(() => {});
  await shot(page, '07a_sections_drafted');
  await page.getByRole('button', { name: /Open/i }).first().click().catch(() => {});
  await page.waitForURL(/\/sections\//, { timeout: 15_000 }).catch(() => {});
  await shot(page, '07b_section_editor_content');
});

test('step 8 — compliance matrix', async ({ page }) => {
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  await page.getByRole('button', { name: /^Compliance/i }).first().click().catch(() => {});
  await shot(page, '08_compliance_matrix');
});

test('step 9 — accept & lock all sections', async ({ page }) => {
  page.on('dialog', (d: any) => d.accept().catch(() => {}));
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  await page.getByRole('button', { name: /Artifacts/i }).first().click().catch(() => {});
  const lockAll = page.getByRole('button', { name: /Accept (&|and) Lock All/i }).first();
  if (await lockAll.isVisible().catch(() => false)) {
    await lockAll.click();
  } else {
    for (const b of await page.getByRole('button', { name: /Lock Volume/i }).all()) await b.click().catch(() => {});
  }
  await page.waitForTimeout(2500);
  await shot(page, '09_locked');

  const after = await proposalState();
  console.log(`[walk] after lock: ${after.locked}/${after.sections} sections locked, stage=${after.stage}`);
  expect(after.locked, 'locking must actually lock sections — a no-op step is not a passing step')
    .toBeGreaterThan(0);
});

test('step 10 — advance the stage (→ submitted)', async ({ page }) => {
  page.on('dialog', (d: any) => d.accept().catch(() => {}));
  await login(page, KATE, PW);
  await openBuild(page);
  const adv = page.getByRole('button', { name: /^Advance to /i }).first();
  if (await adv.isVisible().catch(() => false)) { await adv.click(); await page.waitForTimeout(2500); }
  await shot(page, '10_advanced_submitted');

  /* GO THROUGH THE READINESS GATE, NOT AROUND IT.
   *
   * This step used to be `if (visible) click` with no assertion, so it reported success while doing
   * nothing — and what it was silently swallowing was the product being RIGHT. Driven directly, the
   * advance returns a precise 422:
   *
   *   NOT_READY — 2 blocker(s): Required document not provided: Willingness-to-License Letter.
   *                             Required document not provided: ESP Support Letter.
   *
   * This sandbox proposal genuinely lacks two required documents, so submission-readiness refuses.
   * The product offers an explicit way through — `acknowledgeBlockers`, the customer's "submit
   * anyway" — and a tour that claims to reach a completed, downloadable proposal has to take it.
   * Doing so exercises MORE than the old no-op did: the gate fires, its reasons are read, and the
   * acknowledged path is walked.
   */
  const st = await proposalState();
  if (st.stage === 'draft') {
    const first = await page.request.post(
      `/api/portal/${SLUG}/proposals/${st.id}/advance`, { data: {} });
    if (first.status() === 422) {
      const body = await first.json();
      const blockers = (body?.details?.blockers ?? []) as Array<{ message: string }>;
      console.log(`[walk] readiness gate held with ${blockers.length} blocker(s):`);
      for (const b of blockers) console.log(`         · ${b.message}`);
      expect(blockers.length, 'a 422 NOT_READY must say what is blocking').toBeGreaterThan(0);

      const ack = await page.request.post(
        `/api/portal/${SLUG}/proposals/${st.id}/advance`, { data: { acknowledgeBlockers: true } });
      expect(ack.ok(), `acknowledged advance failed: ${ack.status()} ${(await ack.text()).slice(0, 200)}`)
        .toBeTruthy();
      console.log('[walk] blockers acknowledged — advanced');
    } else {
      expect(first.ok(), `advance failed: ${first.status()} ${(await first.text()).slice(0, 200)}`)
        .toBeTruthy();
    }
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await shot(page, '10_advanced_submitted');
  }

  // The export gate is stage-based: package? refuses anything not locked/submitted/archived.
  const after = await proposalState();
  console.log(`[walk] after advance: stage=${after.stage}`);
  expect(after.stage, 'the build must leave draft for the package export gate to open')
    .not.toBe('draft');
});

test('step 11 — download the completed proposal (.docx)', async ({ page }) => {
  /* This step logs in, opens the build, switches two tabs, waits up to 25s for a download and
   * writes two screenshots. That does not fit the 60s default, so Playwright tore the context down
   * while the final screenshot was still in flight and the step failed with "Target page, context
   * or browser has been closed" — a teardown race reported as a broken download. */
  test.setTimeout(150_000);
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  await page.getByRole('button', { name: /Artifacts/i }).first().click().catch(() => {});
  await shot(page, '11a_completed_ready_to_download');
  /* BOUND THE CLICK.
   *
   * `dlBtn.click().catch(() => {})` looks defensive and is not: with no explicit timeout a click on
   * a button that is not there waits the whole TEST budget, so the catch never runs and the step
   * dies on "Test timeout exceeded" instead of on the thing that is actually wrong. Ask whether the
   * control exists first, and say so when it does not — an export button missing from a completed
   * proposal is a finding, not something to swallow.
   */
  const dlBtn = page.getByRole('button', { name: /Download Proposal \(\.docx\)/i }).first();
  /* ENABLED, not merely VISIBLE.
   *
   * `isVisible()` is true for a DISABLED button, and that distinction cost a wrong diagnosis here:
   * on a draft proposal the export controls are correctly disabled — with the hint "Lock the
   * proposal or advance to submitted stage to export" beside them — so this check passed, the click
   * did nothing, and the missing download looked like a broken control rather than a working gate.
   * Ask what the user can actually do.
   */
  await expect(dlBtn, 'the Artifacts tab of a completed proposal must offer the .docx download')
    .toBeVisible({ timeout: 15_000 });
  await expect(dlBtn, 'the .docx download must be ENABLED once the proposal is exportable')
    .toBeEnabled({ timeout: 15_000 });
  const st = await proposalState();
  console.log(`[walk] downloading from stage=${st.stage} (${st.locked}/${st.sections} locked)`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
    dlBtn.click({ timeout: 15_000 }).catch(() => {}),
  ]);
  expect(download, 'clicking Download Proposal (.docx) must produce a file').toBeTruthy();
  await download!.saveAs(`${SHOTS}/../Foundation_TVSF_UI_downloaded.docx`);
  console.log('  ⬇ downloaded via UI');
  await shot(page, '11b_download_done');
});
