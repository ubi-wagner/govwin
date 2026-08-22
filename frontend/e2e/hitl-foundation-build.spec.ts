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
import { test, expect, type Page } from '@playwright/test';

const TVSF_OPP = process.env.TVSF_OPP || '';
const KATE = { email: 'kate.ulepic@foundation3dp.com', pw: process.env.FOUNDATION_PW || 'DemoPass123!' };
const RFPADMIN = { email: 'e2e-rfpadmin@rfppipeline.test', pw: process.env.E2E_PW || 'E2ETest!2026' };

/* ONE BROWSER CONTEXT PER ACTOR.
 *
 * This spec used to sign both actors into the SAME page: clearCookies(), then goto('/login'), then
 * fill. That works from a neutral page and fails from inside the portal — measured here, the second
 * login landed on /portal/foundation/dashboard with Kate still signed in, and surfaced only as a
 * `page.fill` timeout on a form that was never on screen. Clearing the cookie jar does not
 * un-authenticate a client that has already hydrated a session.
 *
 * Two different users are two different browsers. Giving each its own context is both the fix and
 * the more faithful simulation — it is what the drive-* scripts already do — and it removes any
 * ordering coupling between the gates.
 */
async function signIn(browser: import('@playwright/test').Browser, email: string, pw: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // If the sign-in form is not here, say WHERE we are. A bare `page.fill` timeout on a page that
  // is not /login reads as a broken form; it is almost always a stale session or a redirect.
  await page.locator('input[name="email"]').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
    throw new Error(`sign-in form not present after goto('/login') — landed on ${page.url()}`);
  });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  return page;
}

test('Foundation TVSF build — comp purchase (Kate) → release/provision (rfp_admin)', async ({ browser }) => {
  test.setTimeout(120_000);
  const log = (m: string, v?: unknown) => console.log(`\n▶ ${m}${v !== undefined ? ' ' + JSON.stringify(v) : ''}`);
  expect(TVSF_OPP, 'TVSF_OPP env must be set').toBeTruthy();

  // ── Gate 1: the customer buys the portal with the comp code ──
  const kate = await signIn(browser, KATE.email, KATE.pw);
  const buy = await kate.request.post('/api/portal/foundation/purchase', {
    data: { opportunityId: TVSF_OPP, promoCode: 'rfppipelinetest', label: 'primary' },
  });
  const buyBody = await buy.json();
  log('comp purchase (Kate)', { status: buy.status(), body: buyBody });
  // Idempotent: 200 on a fresh DB, 409 ALREADY_PURCHASED if the portal already exists.
  expect([200, 409], 'purchase 200 or already-purchased').toContain(buy.status());
  /* Both gates here are ONE-WAY TRANSITIONS the product deliberately refuses to repeat: purchase
   * 409s once a workspace exists, and release 409s once the portal has left curation. This spec
   * called itself idempotent but only handled the first of those, and then only by asking for a
   * PORTAL_ID env var — a manual step, not idempotency. So every run after the first failed, in a
   * way that read like a broken purchase or a broken release rather than a used-up fixture.
   *
   * What the test is actually FOR is the end state: the buyer ends up with a launched portal and a
   * provisioned build. That must hold whether THIS run performed the transitions or an earlier one
   * did. So on each 409, verify the state the transition would have produced — which is a strictly
   * stronger check than asserting a 200 and never looking at the result.
   */
  type PortalRow = { id: string; opportunityId?: string; status?: string; proposalId?: string | null };
  const portalsOf = async (): Promise<PortalRow[]> =>
    (await (await kate.request.get('/api/portal/foundation/portals')).json())?.data?.portals ?? [];

  let portalId = (buy.status() === 200 ? buyBody?.data?.portalId : process.env.PORTAL_ID) as string | undefined;
  if (!portalId) {
    const portals = await portalsOf();
    portalId = portals.find((p) => p.opportunityId === TVSF_OPP)?.id;
    log('recovered existing portal after 409', { portalId, of: portals.length });
  }
  expect(portalId, 'portalId — purchase returned neither a new portal nor a findable existing one').toBeTruthy();

  // ── Gate 2: the RFP admin releases the portal from curation → provisions the build ──
  const admin = await signIn(browser, RFPADMIN.email, RFPADMIN.pw);
  const rel = await admin.request.post(`/api/portal/foundation/portals/${portalId}?action=release`, { data: {} });
  const relBody = await rel.json();
  log('release + provision (rfp_admin)', { status: rel.status(), body: relBody });
  expect([200, 409], 'release 200, or 409 if it left curation on an earlier run').toContain(rel.status());

  let proposalId = relBody?.data?.proposalId as string | undefined;
  if (rel.status() === 409) {
    // The CAS on curation_pending refused — correct, and it means the flip already happened.
    expect(relBody?.code, 'a refused re-release is a CONFLICT').toBe('CONFLICT');
    const portal = (await portalsOf()).find((p) => p.id === portalId);
    expect(portal?.status, 'the portal that refused re-release must already be launched').toBe('launched');
    proposalId = portal?.proposalId ?? undefined;
    log('already released on an earlier run — asserting the end state instead', { status: portal?.status, proposalId });
  }
  expect(proposalId, 'proposalId — a launched portal must carry the provisioned build').toBeTruthy();

  log('DONE — provisioned', { portalId, proposalId });
  console.log(`\nPORTAL_ID=${portalId}\nPROPOSAL_ID=${proposalId}`);
});
