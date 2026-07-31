/**
 * Walk the Foundation TVSF build through the REAL pipeline gates:
 *   Kate (tenant_admin) redeems the comp code → proposal_portals `curation_pending`
 *   → rfp_admin RELEASES → provisionProposalForPortal instantiates the proposal (draft,
 *     unlocked) + artifacts + sections (empty) + compliance matrix (not_addressed).
 *
 * These are the two customer/admin gates ("customer buys a portal" + "RFP admin releases").
 * Section drafting + lock + advance + export are done in-process by
 * scripts/drive-foundation-tvsf.mts (finds the proposal this spec provisions).
 *
 * Env: TVSF_OPP (required) = the TVSF opportunity id. Self-authenticating (`hitl` project).
 * Requires the Foundation seed (scripts/seed-foundation.mjs) + seed-e2e-hitl.mjs.
 */
import { test, expect } from '@playwright/test';

const TVSF_OPP = process.env.TVSF_OPP || '';
const KATE = { email: 'kate.ulepic@foundation3dp.com', pw: process.env.FOUNDATION_PW || 'DemoPass123!' };
const RFPADMIN = { email: 'e2e-rfpadmin@rfppipeline.test', pw: process.env.E2E_PW || 'E2ETest!2026' };

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

test('Foundation TVSF build — comp purchase (Kate) → release/provision (rfp_admin)', async ({ page }) => {
  test.setTimeout(120_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);
  expect(TVSF_OPP, 'TVSF_OPP env must be set').toBeTruthy();

  // ── Gate 1: the customer buys the portal with the comp code ──
  await login(page, KATE.email, KATE.pw);
  const buy = await page.request.post('/api/portal/foundation/purchase', {
    data: { opportunityId: TVSF_OPP, promoCode: 'rfppipelinetest', label: 'primary' },
  });
  const buyBody = await buy.json();
  log('comp purchase (Kate)', { status: buy.status(), body: buyBody });
  // Idempotent: 200 on a fresh DB, 409 ALREADY_PURCHASED if the portal already exists.
  expect([200, 409], 'purchase 200 or already-purchased').toContain(buy.status());
  const portalId = (buy.status() === 200 ? buyBody?.data?.portalId : process.env.PORTAL_ID) as string;
  expect(portalId, 'portalId (set PORTAL_ID env when re-running against an existing portal)').toBeTruthy();

  // ── Gate 2: the RFP admin releases the portal from curation → provisions the build ──
  await login(page, RFPADMIN.email, RFPADMIN.pw);
  const rel = await page.request.post(`/api/portal/foundation/portals/${portalId}?action=release`, { data: {} });
  const relBody = await rel.json();
  log('release + provision (rfp_admin)', { status: rel.status(), body: relBody });
  expect(rel.status(), 'release 200').toBe(200);
  const proposalId = relBody?.data?.proposalId as string;
  expect(proposalId, 'proposalId').toBeTruthy();

  log('DONE — provisioned', { portalId, proposalId });
  console.log(`\nPORTAL_ID=${portalId}\nPROPOSAL_ID=${proposalId}`);
});
