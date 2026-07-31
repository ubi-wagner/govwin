/**
 * HITL onboard — Phase C6 (comp-code purchase) + C7 (release/provision) of the Fondation/TVS
 * playbook, driven live: the new tenant_admin buys the portal, then an rfp_admin releases it,
 * producing a provisioned + UNLOCKED build (the precondition for Phase D "walk the build").
 *
 * Parameterized by env (a tenant with a pushed, purchasable card + a login-able tenant_admin):
 *   FOND_SLUG, FOND_OPP, FOND_ADMIN   (see docs/PLAYBOOK_ONBOARD_NEWCO_TVS.md §C5–C7)
 * Skips cleanly when unset so it never blocks the suite. Two browser contexts (customer + admin).
 */
import { test, expect } from '@playwright/test';

const PW = process.env.E2E_PW || 'E2ETest!2026';
const SLUG = process.env.FOND_SLUG;
const OPP = process.env.FOND_OPP;
const ADMIN = process.env.FOND_ADMIN;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('C6 purchase + C7 release → provisioned UNLOCKED build', async ({ browser }) => {
  test.skip(!SLUG || !OPP || !ADMIN, 'set FOND_SLUG/FOND_OPP/FOND_ADMIN to a pushed, purchasable card');
  test.setTimeout(90_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);

  // ── C6 — the new tenant_admin pins + buys the portal (comp code) ──────
  const cust = await browser.newContext({ baseURL: BASE });
  const cp = await cust.newPage();
  await login(cp, ADMIN!);
  const pin = await cp.request.post(`/api/portal/${SLUG}/cards/${OPP}/pin`, { data: {} });
  log('C6a · pin card', { status: pin.status() });
  const buy = await cp.request.post(`/api/portal/${SLUG}/purchase`, {
    data: { opportunityId: OPP, promoCode: 'rfppipelinetest' },
  });
  const buyBody = await buy.json();
  log('C6b · purchase (comp code)', { status: buy.status(), body: JSON.stringify(buyBody).slice(0, 200) });
  expect(buy.status(), 'purchase should 200').toBe(200);
  const portalId = buyBody.data?.portalId ?? buyBody.portalId;
  expect(portalId, 'purchase returns a portalId').toBeTruthy();
  log('  → portal', { portalId, status: buyBody.data?.status ?? buyBody.status });
  await cust.close();

  // ── C7 — an rfp_admin releases → provisions the build ────────────────
  const adm = await browser.newContext({ baseURL: BASE });
  const ap = await adm.newPage();
  await login(ap, 'e2e-rfpadmin@rfppipeline.test');
  const rel = await ap.request.post(`/api/portal/${SLUG}/portals/${portalId}?action=release`, { data: {} });
  const relBody = await rel.json();
  log('C7 · release + provision', { status: rel.status(), body: JSON.stringify(relBody).slice(0, 200) });
  expect(rel.status(), 'release should 200').toBe(200);
  const proposalId = relBody.data?.proposalId ?? relBody.proposalId;
  expect(proposalId, 'release returns a proposalId (build provisioned)').toBeTruthy();
  log('DONE — provisioned build', { proposalId, slug: SLUG });
  await adm.close();
});
