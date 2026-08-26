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
const TOPIC = process.env.DRIVE_TOPIC ?? 'OSW26BZ04-DP013';
/** The solicitation's authored/elsewhere volume split. Defaults to T3CP's; override per scenario. */
const nums = (v: string | undefined, fallback: number[]) =>
  v === undefined ? fallback : v.split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
const AUTHORED_VOLUMES = nums(process.env.DRIVE_AUTHORED_VOLUMES, [1, 2, 3, 5]);
const UNAUTHORED_VOLUMES = nums(process.env.DRIVE_UNAUTHORED_VOLUMES, [4, 6, 7]);
const EXPECT_NO_WEBFORM = process.env.DRIVE_EXPECT_NO_WEBFORM !== 'false';
const CAPPED_SECTIONS: Array<[string, number]> =
  process.env.DRIVE_CAPPED_SECTIONS === undefined
    ? [['Project Summary', 3000], ['Anticipated Benefits', 3000]]
    : process.env.DRIVE_CAPPED_SECTIONS.split(',').filter(Boolean).map((pair) => {
        const [t, c] = pair.split(':');
        return [t.trim(), Number(c)] as [string, number];
      });

const ADMIN = { email: 'eric@rfppipeline.com', password: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!') };
// The BUYER is per-scenario, like the tenant and the solicitation: each company buys a different
// OPP. Defaults to the immobileyes fixture so the original scenario is unchanged.
const BUYER = {
  email: process.env.DRIVE_BUYER_EMAIL ?? 'admin@immobileyes.test',
  password: process.env.DRIVE_BUYER_PW ?? 'DemoPass123!',
};

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

  /* THE T3CP SCENARIO IS NOT ON THIS MACHINE.
   *
   * SOL/OPP/TOPIC default to ids from a curated T3CP solicitation that was built by hand on a
   * long-lived box. Its source documents — the OSW T3CP component instructions and the
   * Patent-Holiday topic call — arrived as chat uploads and are not in the repository, so nothing
   * here can rebuild it and the readiness bar correctly reports an empty master
   * (hasCompliance false, volumeCount 0).
   *
   * That is a could-not-run, not a defect: reporting it red buries the failures that matter. Same
   * argument as e2e/upload-fixtures.ts; the class is catalogued in docs/FIXTURE_INTEGRITY.md.
   */
  const readiness = await post(admin.request, `/api/admin/rfp-curation/${SOL}/complete-buildout`, {});
  if (!readiness.ok && readiness.body?.code === 'NOT_READY'
      && readiness.body?.data?.readiness?.volumeCount === 0) {
    await adminCtx.close();
    test.skip(true,
      `solicitation ${SOL} has no build-out on this machine (volumeCount 0) — this spine needs the `
      + `curated T3CP master, whose source PDFs are absent. Stand a scenario up with `
      + `scripts/drive-ingest-scenario.mjs and pass DRIVE_SOL_ID/DRIVE_OPP_ID/DRIVE_TOPIC.`);
  }
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

  let portalId: string;
  if (!purchase.ok && purchase.body?.code === 'ALREADY_PURCHASED') {
    // A second run of this drive hits the product's own one-workspace-per-opportunity rule. That
    // refusal is correct behaviour, not a drive failure — pick up the existing portal and carry on,
    // so the drive stays re-runnable without needing the database reset by hand.
    const list = await buyer.request.get(`/api/portal/${TENANT}/portals`);
    expect(list.ok(), 'must be able to list the tenant’s portals').toBeTruthy();
    const body = (await list.json()).data as { portals?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const portals = (Array.isArray(body) ? body : body.portals) ?? [];
    const mine = portals.find((p) => String(p.opportunityId) === OPP);
    expect(mine, 'the already-purchased portal must be findable').toBeTruthy();
    portalId = String(mine!.id);
    console.log(`[spine] reusing the existing portal ${portalId} (status ${String(mine!.status)})`);
  } else {
    expect(purchase.ok, `purchase: ${JSON.stringify(purchase.body)}`).toBeTruthy();
    portalId = purchase.body.data?.portalId as string;
    expect(portalId).toBeTruthy();
    // The buyer waits: a comp purchase opens curation_pending, never a live build.
    expect(purchase.body.data?.status ?? 'curation_pending').toBe('curation_pending');
  }

  // ── 4. rfp_admin: release from the provisioning cockpit ──────────────────────
  const release = await post(admin.request, `/api/admin/provisioning/${portalId}/release`, {});
  console.log('[spine] release:', release.status, JSON.stringify(release.body).slice(0, 400));
  let proposalId: string;
  if (!release.ok && /already|launched/i.test(JSON.stringify(release.body))) {
    // Already released on an earlier run — find the provisioned proposal through the buyer's own
    // list rather than re-releasing, which would double-provision.
    const props = await buyer.request.get(`/api/portal/${TENANT}/proposals`);
    expect(props.ok()).toBeTruthy();
    const pb = (await props.json()).data as { proposals?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const list = (Array.isArray(pb) ? pb : pb.proposals) ?? [];
    // The proposals list does not carry opportunityId, so match on the title provision writes:
    // `<topicNumber>: <title>`.
    const mine = list.find((p) => String(p.title ?? '').includes(TOPIC));
    expect(mine, `the provisioned proposal must be findable (looked for "${TOPIC}" in ${list.length} proposals)`).toBeTruthy();
    proposalId = String(mine!.id);
    console.log(`[spine] reusing the provisioned proposal ${proposalId}`);
  } else {
    expect(release.ok, `release: ${JSON.stringify(release.body)}`).toBeTruthy();
    proposalId = (release.body.data?.proposalId ?? release.body.data?.proposal?.id) as string;
    expect(proposalId, 'release must provision a proposal').toBeTruthy();
  }

  // ── 5. What the buyer actually received ──────────────────────────────────────
  const secRes = await buyer.request.get(`/api/portal/${TENANT}/proposals/${proposalId}/sections`);
  expect(secRes.ok(), 'the buyer must be able to load their provisioned build').toBeTruthy();
  const payload = (await secRes.json()).data as {
    sections?: Array<{ title: string; volumeName: string | null; volumeNumber: number | null;
                       pageAllocation: number | null; characterAllocation: number | null;
                       status: string; contentSource: string | null }>;
  };
  const sections = (Array.isArray(payload) ? payload : payload.sections) ?? [];
  console.log(`[spine] provisioned ${sections.length} sections`);
  for (const s of sections) {
    console.log(`   V${s.volumeNumber ?? '?'} · ${s.title}`
      + `${s.pageAllocation ? ` · ${s.pageAllocation}pp` : ''}`
      + `${s.characterAllocation ? ` · ${s.characterAllocation} chars` : ''}`
      + ` · ${s.status}/${s.contentSource ?? 'none'}`);
  }

  const volumes = new Set(sections.map((s) => s.volumeNumber).filter((v): v is number => v != null));
  // WHICH volumes get authored is a property of the SOLICITATION, not of this drive. T3CP splits
  // its work — 1/2/3/5 are authored here, 4/6/7 are completed in DSIP and must stand up nothing —
  // but point the same spine at another solicitation (DRIVE_SOL_ID) and the split is different: the
  // DoW 2026 annual BAA authors all seven. Hardcoding T3CP's shape made the spine untestable
  // against any other solicitation, which is exactly what was needed when the T3CP source PDFs
  // turned out not to be in the repository. The pipeline stages are the invariant; the shape is a
  // parameter.
  for (const v of AUTHORED_VOLUMES) expect(volumes.has(v), `Volume ${v} must be authored`).toBe(true);
  for (const v of UNAUTHORED_VOLUMES) expect(volumes.has(v), `Volume ${v} is completed elsewhere — nothing to author`).toBe(false);
  if (EXPECT_NO_WEBFORM) {
    expect(sections.some((s) => /DSIP webform/i.test(s.title)),
      'the cover-sheet webform is completed in DSIP, never authored here').toBe(false);
  }

  // Capped narratives carry the cap the SOLICITATION states — which sections those are, and what
  // the cap is, is again a property of the document, not of the spine. T3CP caps its two
  // cover-sheet narratives at 3,000 characters; another solicitation caps different sections, or
  // none. Format: "Title:cap,Title:cap"; empty means this solicitation states no character caps.
  for (const [title, cap] of CAPPED_SECTIONS) {
    const s = sections.find((x) => x.title.includes(title));
    expect(s, `${title} must be provisioned`).toBeTruthy();
    expect(s!.characterAllocation, `${title} must carry its ${cap.toLocaleString()}-character cap`).toBe(cap);
  }

  // No authored section arrives BLANK — each carries content the moment the buyer opens it.
  //
  // Asserted as "not blank" rather than "contentSource === 'template'" because with the pipeline
  // worker running, provision's own OnProposalCreated drafts the build within seconds and flips
  // content_source from 'template' to 'ai_draft'. That is correct product behaviour, and a drive
  // that asserted the transient value was racing it — reporting 0/20 seeded on a build whose molds
  // had in fact all been delivered and then drafted over.
  const blank = sections.filter((s) => !s.contentSource || s.contentSource === 'empty');
  console.log('[spine] content source:', JSON.stringify(
    sections.reduce<Record<string, number>>((a, s) => {
      const k = s.contentSource ?? 'none'; a[k] = (a[k] ?? 0) + 1; return a;
    }, {})));
  expect(blank.map((s) => s.title), 'no authored section may arrive blank').toEqual([]);

  // …and the master really does carry a mold for every item it should, which is the durable fact
  // the transient content_source was standing in for.
  const gate = await admin.request.get(`/api/admin/rfp-curation/${SOL}/ingest-phase`);
  expect(gate.ok()).toBeTruthy();
  const molds = (await gate.json()).data?.molds as { itemsToMold: number; itemsWithMold: number };
  console.log(`[spine] master molds: ${molds.itemsWithMold}/${molds.itemsToMold}`);
  expect(molds.itemsWithMold, 'every moldable item on the master must carry a mold').toBe(molds.itemsToMold);
  expect(molds.itemsToMold).toBeGreaterThan(0);

  await adminCtx.close();
  await buyerCtx.close();
});
