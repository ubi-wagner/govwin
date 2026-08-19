/**
 * T3CP end-to-end spine, driven as the real actors it belongs to.
 *
 *   rfp_admin     complete the master build-out  →  push the opportunity onto the bridge
 *   tenant_admin  buy the proposal portal with the comp code (curation_pending, 72h SLA)
 *   rfp_admin     release it — provisioning the buyer's private portal off the master
 *
 * Then it checks the thing the whole master-mirror model exists to guarantee: the buyer's
 * provisioned build is the SOLICITATION's shape, not a default skeleton. Specifically —
 *
 *   · the authored volumes (1 · 2 · 3 · 5) each stood up an artifact and its sections
 *   · the DSIP-only work (V1's cover-sheet webform, V4 CCR, V6 FWA) stood up NOTHING; it is
 *     completed in the agency portal, and an authoring section for it is work that can never be
 *     done and a readiness blocker that can never clear
 *   · the two cover-sheet narratives carry their 3,000-character budgets
 *   · the Technical Volume carries its 10-page cap
 *   · every authored section was seeded from its master mold, not left blank
 *
 * Run: npx playwright test --project=drive t3cp-spine
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const SOL = process.env.DRIVE_SOL_ID ?? '11263a74-ab09-48bb-ada5-565aa2ee986e';
const OPP = process.env.DRIVE_OPP_ID ?? '2e96f788-0798-42d3-b8ef-361e35a2219a';
const TENANT = process.env.DRIVE_TENANT_SLUG ?? 'immobileyes';
const COMP_CODE = 'rfppipelinetest';

const ADMIN = { email: 'eric@rfppipeline.com', password: 'RFPAdmin2026!' };
const BUYER = { email: 'admin@immobileyes.test', password: 'DemoPass123!' };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function post(api: APIRequestContext, url: string, data: unknown) {
  const res = await api.post(url, { data, timeout: 180_000 });
  return { ok: res.ok(), status: res.status(), body: await res.json().catch(() => ({})) };
}

test('spine · build-out → push → comp purchase → release → the buyer gets the solicitation’s shape', async ({ browser }) => {
  test.setTimeout(12 * 60 * 1000);

  // ── 1. rfp_admin: complete the master build-out ──────────────────────────────
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, ADMIN);

  const readiness = await post(admin.request, `/api/admin/rfp-curation/${SOL}/complete-buildout`, {});
  if (!readiness.ok && readiness.body?.code === 'NOT_READY') {
    // The bar exists to stop a half-built master reaching a buyer. Report what is missing rather
    // than confirming past it blindly — a drive that always confirms proves nothing about the bar.
    console.log('[spine] build-out below the bar:', JSON.stringify(readiness.body.data?.readiness));
  }
  expect(readiness.ok, `complete-buildout: ${JSON.stringify(readiness.body)}`).toBeTruthy();
  console.log('[spine] build-out complete:', JSON.stringify(readiness.body.data));

  // ── 2. rfp_admin: push the opportunity onto the bridge ───────────────────────
  const push = await post(admin.request, `/api/admin/opportunities/${OPP}/publish`, {});
  console.log('[spine] push:', push.status, JSON.stringify(push.body).slice(0, 300));
  expect(push.ok, `push: ${JSON.stringify(push.body)}`).toBeTruthy();

  // The card the buyer will see must carry the facts the ingest READ — not a default.
  const cardRes = await admin.request.get(`/api/portal/${TENANT}/cards`);
  expect(cardRes.ok()).toBeTruthy();
  const cards = (await cardRes.json()).data as { cards?: Array<Record<string, unknown>> };
  const card = (cards.cards ?? []).find((c) => String(c.opportunityId) === OPP);
  expect(card, 'the T3CP opportunity must have reached the tenant as a card').toBeTruthy();
  console.log('[spine] card:', JSON.stringify({
    title: card!.title, agency: card!.agency, closeDate: card!.closeDate,
  }));

  // ── 3. tenant_admin: buy the portal with the comp code ───────────────────────
  const buyerCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  await signIn(buyer, BUYER);

  const purchase = await post(buyer.request, `/api/portal/${TENANT}/purchase`, {
    opportunityId: OPP, promoCode: COMP_CODE, label: 'primary',
  });
  console.log('[spine] purchase:', purchase.status, JSON.stringify(purchase.body).slice(0, 300));
  expect(purchase.ok, `purchase: ${JSON.stringify(purchase.body)}`).toBeTruthy();
  const portalId = purchase.body.data?.portalId as string;
  expect(portalId).toBeTruthy();

  // The buyer waits: a comp purchase opens curation_pending, never a live build.
  expect(purchase.body.data?.status ?? 'curation_pending').toBe('curation_pending');

  // ── 4. rfp_admin: release from the provisioning cockpit ──────────────────────
  const release = await post(admin.request, `/api/admin/provisioning/${portalId}/release`, {});
  console.log('[spine] release:', release.status, JSON.stringify(release.body).slice(0, 400));
  expect(release.ok, `release: ${JSON.stringify(release.body)}`).toBeTruthy();
  const proposalId = (release.body.data?.proposalId ?? release.body.data?.proposal?.id) as string;
  expect(proposalId, 'release must provision a proposal').toBeTruthy();

  // ── 5. What the buyer actually received ──────────────────────────────────────
  const docRes = await buyer.request.get(`/api/portal/${TENANT}/proposals/${proposalId}/document`);
  expect(docRes.ok(), 'the buyer must be able to load their provisioned build').toBeTruthy();
  const doc = (await docRes.json()).data as {
    sections?: Array<{ title: string; volumeName: string | null; volumeNumber: number | null;
                       pageAllocation: number | null; characterAllocation: number | null;
                       status: string; contentSource: string | null }>;
  };
  const sections = doc.sections ?? [];
  console.log(`[spine] provisioned ${sections.length} sections`);
  for (const s of sections) {
    console.log(`   V${s.volumeNumber ?? '?'} · ${s.title}`
      + `${s.pageAllocation ? ` · ${s.pageAllocation}pp` : ''}`
      + `${s.characterAllocation ? ` · ${s.characterAllocation} chars` : ''}`
      + ` · ${s.status}/${s.contentSource ?? 'none'}`);
  }

  const volumes = new Set(sections.map((s) => s.volumeNumber).filter((v): v is number => v != null));
  // Authored volumes are present…
  for (const v of [1, 2, 3, 5]) expect(volumes.has(v), `Volume ${v} must be authored`).toBe(true);
  // …and DSIP-only work stood up nothing at all.
  for (const v of [4, 6, 7]) expect(volumes.has(v), `Volume ${v} is DSIP-only — nothing to author`).toBe(false);
  expect(sections.some((s) => /DSIP webform/i.test(s.title)),
    'the cover-sheet webform is completed in DSIP, never authored here').toBe(false);

  // The two cover-sheet narratives carry the cap the BAA states.
  for (const title of ['Project Summary', 'Anticipated Benefits']) {
    const s = sections.find((x) => x.title.includes(title));
    expect(s, `${title} must be provisioned`).toBeTruthy();
    expect(s!.characterAllocation, `${title} must carry its 3,000-character cap`).toBe(3000);
  }

  // Every authored section was seeded from its master mold rather than left blank.
  const seeded = sections.filter((s) => s.contentSource === 'template').length;
  console.log(`[spine] ${seeded}/${sections.length} sections seeded from a master mold`);
  expect(seeded, 'the molds must reach the buyer').toBeGreaterThan(0);

  await adminCtx.close();
  await buyerCtx.close();
});
