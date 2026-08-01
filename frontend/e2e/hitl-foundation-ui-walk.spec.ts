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
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  📸 ${name}`);
};
// Reach the provisioned build workspace (portals → "Open build →"), no proposalId needed.
async function openBuild(page: any) {
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
  const card = page.locator('div')
    .filter({ has: page.getByRole('heading', { name: /TVSF Round 45/ }) })
    .filter({ has: page.getByRole('button', { name: /Pin/ }) }).last();
  await card.getByRole('button', { name: /Pin/ }).click();
  // Purchase appears only after pinning; only TVSF is pinned → the sole Purchase button.
  await page.getByRole('button', { name: 'Purchase' }).click();
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
  await page.getByRole('button', { name: /Release to customer/i }).first().click();
  await expect(page.getByRole('link', { name: /Open build/i }).first()).toBeVisible({ timeout: 25_000 });
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
});

test('step 10 — advance the stage (→ submitted)', async ({ page }) => {
  page.on('dialog', (d: any) => d.accept().catch(() => {}));
  await login(page, KATE, PW);
  await openBuild(page);
  const adv = page.getByRole('button', { name: /^Advance to /i }).first();
  if (await adv.isVisible().catch(() => false)) { await adv.click(); await page.waitForTimeout(2500); }
  await shot(page, '10_advanced_submitted');
});

test('step 11 — download the completed proposal (.docx)', async ({ page }) => {
  await login(page, KATE, PW);
  await openBuild(page);
  await page.getByRole('button', { name: /All Sections/i }).first().click().catch(() => {});
  await page.getByRole('button', { name: /Artifacts/i }).first().click().catch(() => {});
  await shot(page, '11a_completed_ready_to_download');
  const dlBtn = page.getByRole('button', { name: /Download Proposal \(\.docx\)/i }).first();
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 25_000 }).catch(() => null),
    dlBtn.click().catch(() => {}),
  ]);
  if (dl[0]) { await dl[0].saveAs(`${SHOTS}/../Foundation_TVSF_UI_downloaded.docx`); console.log('  ⬇ downloaded via UI'); }
  await shot(page, '11b_download_done');
});
