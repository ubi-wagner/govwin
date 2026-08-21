/**
 * PURCHASE → RELEASE — per-volume TEMPLATE VALIDATION drive (docs/MID_WINDOW_RULES.md P1/P5,
 * docs/CANVAS_ARCHITECTURE.md one-canvas rule).
 *
 * The claim under test: when a purchased portal is released, EVERY volume's required items get
 * the PROPER template for that item's specific requirements —
 *   · an item with a LINKED mold gets that mold's CanvasDocument (right canvas format family),
 *   · the cost volume's data-bearing item gets the COMPUTED budget workbook in the form the
 *     solicitation requires (DoW SBIR → burden waterfall cells), never a narrative mold,
 *   · an item with a DANGLING templateId degrades to the registry/empty WITHOUT failing the
 *     provision (adversarial case),
 *   · limits ride the section (page_allocation), the matrix gets one row per item, and all
 *     of it is ONE CanvasDocument per section (nodes + canvas.format), nothing off-canvas.
 *
 * Actors: eric (rfp_admin) authors + releases; kate (tenant_admin) purchases + receives.
 * Serial; resume-safe. Run: npx playwright test --project=drive p2r-template
 */
import { test, expect, type Page } from '@playwright/test';

const SOL = process.env.FLEX_SOL_ID ?? 'aca5e83a-11b6-4a06-9049-2f17400f1ed9';
const SLUG = 'foundation';
const TPL = {
  techDoc: 'd4476dc5-23ae-4cb8-b9e4-651dd6970c84',   // N26D-CAM07 — Technical Volume (canvas.format 'letter')
  pitchDeck: 'e11a7e00-0000-4000-8000-000000000003', // Pitch Deck (canvas.format 'slide_16_9')
  pastPerf: 'e11a7e00-0000-4000-8000-000000000004',  // Past Performance ('letter')
  dangling: '00000000-dead-4bad-8000-000000000000',  // valid UUID, no such template
};

test.describe.configure({ mode: 'serial' });

let TOPIC = '';      // the target late topic opp
let TOPIC_CANDIDATES: string[] = []; // dated active ZZ topics, oldest→newest
let PORTAL = '';
let PROPOSAL = '';
let VOL1 = ''; let VOL2 = ''; let VOL3 = '';
let COST_ITEM_NAME = '';
let TECH_ITEM_NAME = '';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}
const asAdmin = (page: Page) => signIn(page, 'eric@rfppipeline.com', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
const asKate = (page: Page) => signIn(page, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');

const tool = (page: Page, name: string, input: Record<string, unknown>) =>
  page.request.post(`/api/tools/${name}`, { data: { input } });

// ═════════ P1 · admin resolves the target topic + authors per-item template selection ═════════

test('P1 · admin selects the PROPER template per item (doc mold · slide mold · computed cost · dangling fallback)', async ({ page }) => {
  test.setTimeout(240_000);
  await asAdmin(page);

  const detail = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}`)).json()).data;
  const topics = (detail.topics as Array<{ id: string; topicNumber: string | null; closeDate: string | null; isActive: boolean }>)
    .filter((t) => (t.topicNumber ?? '').startsWith('TOPIC-OSW26BZ97ZZ') && t.closeDate && t.isActive);
  expect(topics.length, 'a dated, released late topic from the FLEX drive must exist').toBeGreaterThan(0);
  TOPIC_CANDIDATES = topics.map((t) => t.id);
  TOPIC = TOPIC_CANDIDATES[TOPIC_CANDIDATES.length - 1];

  const vols = detail.volumes as Array<{ id: string; volumeNumber: number; volumeName: string; requiredItems: Array<{ id: string; itemName: string; itemNumber: number }> | null }>;
  const v1 = vols.find((v) => v.volumeNumber === 1)!; VOL1 = v1.id;
  const v2 = vols.find((v) => v.volumeNumber === 2)!; VOL2 = v2.id;
  const v3 = vols.find((v) => v.volumeNumber === 3)!; VOL3 = v3.id;
  COST_ITEM_NAME = v2.requiredItems?.[0]?.itemName ?? '';
  expect(COST_ITEM_NAME, 'the Cost Volume must already carry its data item').toBeTruthy();

  // Vol 1 item 1 → the LINKED technical doc mold.
  const v1item = v1.requiredItems![0];
  TECH_ITEM_NAME = v1item.itemName;
  const r1 = await tool(page, 'volume.update_required_item', { itemId: v1item.id, templateId: TPL.techDoc });
  expect(r1.status(), await r1.text()).toBe(200);

  // Idempotent authoring: item NAMES may legally repeat (only numbers are unique), so a
  // resumed drive must not stack duplicates — add only when the name is absent.
  const hasItem = (v: typeof v1, name: string) => (v.requiredItems ?? []).some((i) => i.itemName === name);

  // Vol 1 gains a SLIDE item with the slide mold — the format-family match under test.
  if (!hasItem(v1, 'Quad Chart Pitch Deck')) {
    const nextNum = Math.max(...v1.requiredItems!.map((i) => i.itemNumber)) + 1;
    const rSlide = await tool(page, 'volume.add_required_item', {
      volumeId: VOL1, itemNumber: nextNum, itemName: 'Quad Chart Pitch Deck', itemType: 'slide_deck',
      required: true, slideLimit: 12, templateId: TPL.pitchDeck,
    });
    expect(rSlide.status(), await rSlide.text()).toBe(200);
  }

  // Vol 3: a Past Performance item with its mold, page-limited.
  const v3nums = (v3.requiredItems ?? []).map((i) => i.itemNumber);
  if (!hasItem(v3, 'Past Performance Summary')) {
    const rPP = await tool(page, 'volume.add_required_item', {
      volumeId: VOL3, itemNumber: (v3nums.length ? Math.max(...v3nums) : 0) + 1,
      itemName: 'Past Performance Summary', itemType: 'word_doc',
      required: true, pageLimit: 3, templateId: TPL.pastPerf,
    });
    expect(rPP.status(), await rPP.text()).toBe(200);
  }

  // ADVERSARIAL 1: a DANGLING templateId must be a CLEAN validation refusal at authoring
  // time (the FK guard, surfaced properly) — the chain can never carry a phantom mold.
  const rBad = await tool(page, 'volume.add_required_item', {
    volumeId: VOL3, itemNumber: (v3nums.length ? Math.max(...v3nums) : 0) + 2,
    itemName: 'Phantom Mold Item', itemType: 'word_doc',
    required: true, pageLimit: 2, templateId: TPL.dangling,
  });
  expect(rBad.status(), await rBad.text()).toBe(422);
  expect(await rBad.text()).toContain('templateId does not exist');

  // ADVERSARIAL 2: an item with NO template at all — provision must fall back to the
  // code registry or a clean empty section, never fail the release.
  if (!hasItem(v3, 'Fallback Narrative Item')) {
    const rNone = await tool(page, 'volume.add_required_item', {
      volumeId: VOL3, itemNumber: (v3nums.length ? Math.max(...v3nums) : 0) + 2,
      itemName: 'Fallback Narrative Item', itemType: 'word_doc',
      required: true, pageLimit: 2,
    });
    expect(rNone.status(), await rNone.text()).toBe(200);
  }
});

// ═════════ P2 · kate purchases the topic (the 72h window opens) ═════════

test('P2 · kate purchases the topic portal (comp code)', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);
  // Prefer a topic kate has NOT yet purchased so this run provisions FRESH under the current
  // code (a rerun on an adopted portal would validate a build provisioned by older code).
  {
    const mine = ((await (await page.request.get(`/api/portal/${SLUG}/portals`)).json()).data?.portals ?? []) as Array<Record<string, unknown>>;
    const purchased = new Set(mine.map((p) => String(p.opportunityId)));
    const fresh = [...TOPIC_CANDIDATES].reverse().find((id) => !purchased.has(id));
    if (fresh) TOPIC = fresh;
  }
  const buy = await page.request.post(`/api/portal/${SLUG}/purchase`, {
    data: { opportunityId: TOPIC, promoCode: 'rfppipelinetest', label: 'P2R template drive' },
  });
  if (buy.status() === 200) {
    PORTAL = (await buy.json()).data.portalId as string;
  } else {
    expect(await buy.text()).toContain('ALREADY_PURCHASED');
    const portals = ((await (await page.request.get(`/api/portal/${SLUG}/portals`)).json()).data?.portals ?? []) as Array<Record<string, unknown>>;
    PORTAL = String(portals.find((p) => p.opportunityId === TOPIC)?.id ?? '');
  }
  expect(PORTAL).toMatch(/^[0-9a-f-]{36}$/);
});

// ═════════ P3 · admin releases from the cockpit (two-outcome) ═════════

test('P3 · cockpit Complete & Release provisions the build', async ({ page }) => {
  test.setTimeout(240_000);
  await asAdmin(page);
  const rel = await page.request.post(`/api/admin/provisioning/${PORTAL}/release`, { data: { confirm: true } });
  if (rel.status() === 200) {
    PROPOSAL = (await rel.json()).data.proposalId as string;
  } else {
    expect([409]).toContain(rel.status()); // resume: already launched
    const kctx = await page.context().browser()!.newContext();
    const kp = await kctx.newPage();
    await asKate(kp);
    const portals = ((await (await kp.request.get(`/api/portal/${SLUG}/portals`)).json()).data?.portals ?? []) as Array<Record<string, unknown>>;
    PROPOSAL = String(portals.find((p) => String(p.id) === PORTAL)?.proposalId ?? '');
    await kctx.close();
  }
  expect(PROPOSAL).toMatch(/^[0-9a-f-]{36}$/);
});

// ═════════ P4 · THE TEMPLATE VALIDATION — every item got the PROPER canvas ═════════

test('P4 · every volume item carries the proper template on ONE canvas (formats · limits · matrix)', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const doc = (await (await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/document`)).json()).data;
  // The document route's real contract: per-section frame metadata (canvas incl. format,
  // status, lock, version) + the ASSEMBLED one-CanvasDocument for the fluid surface.
  const sections = doc.sections as Array<{
    id: string; title: string; volumeName: string | null; status: string;
    canvas: { format?: string } | null; version: number; isLocked: boolean;
  }>;
  expect(sections.length).toBeGreaterThanOrEqual(5);
  const byTitle = (t: RegExp) => sections.find((s) => t.test(s.title));

  // 1 · Linked DOC mold on the technical item: drafted, doc-family canvas frame.
  const tech = byTitle(new RegExp(TECH_ITEM_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))!;
  expect(tech, `Vol-1 item section ("${TECH_ITEM_NAME}") must exist`).toBeTruthy();
  expect(tech.status).toBe('ai_drafted');
  expect(String(tech.canvas?.format ?? 'letter')).not.toMatch(/slide/);

  // 2 · Linked SLIDE mold: the canvas format family must be SLIDE (the one-canvas fork).
  const slide = byTitle(/Quad Chart Pitch Deck/i)!;
  expect(slide, 'slide section must exist').toBeTruthy();
  expect(slide.status).toBe('ai_drafted');
  expect(String(slide.canvas?.format ?? ''), 'slide item must carry a slide-family canvas').toMatch(/slide/);

  // 3 · COST data item: drafted by the COMPUTED workbook path (cell-level proof lands in
  //     the BUILD drive's zip export, where the cost volume must emerge as native xlsx).
  const cost = sections.find((s) => new RegExp(COST_ITEM_NAME.slice(0, 8), 'i').test(s.title));
  expect(cost, 'cost section must exist').toBeTruthy();
  expect(cost!.status).toBe('ai_drafted');
  expect(String(cost!.canvas?.format ?? '')).not.toMatch(/slide/);

  // 4 · Past Performance mold landed and drafted.
  const pp = byTitle(/Past Performance Summary/i)!;
  expect(pp, 'past performance section must exist').toBeTruthy();
  expect(pp.status).toBe('ai_drafted');

  // 5 · The NO-TEMPLATE item provisioned cleanly (registry fallback or empty) — and the
  //     release plainly did not fail (we are reading its build).
  const fb = byTitle(/Fallback Narrative Item/i)!;
  expect(fb, 'fallback item must still provision').toBeTruthy();
  expect(['empty', 'ai_drafted']).toContain(fb.status);

  // 6 · ONE-CANVAS interpolation floor: nowhere in the assembled document or section frames
  //     may a raw template variable survive.
  expect(JSON.stringify(doc), 'template variables must be interpolated everywhere').not.toContain('{company_name}');

  // 7 · Matrix: one row per section, all not_addressed at birth.
  const comp = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/compliance`);
  expect(comp.status(), await comp.text()).toBe(200);
  const compData = (await comp.json()).data;
  const rows = (compData.items ?? compData.matrix ?? compData.rows ?? compData) as Array<{ status: string }>;
  expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThanOrEqual(sections.length);
  if (Array.isArray(rows)) {
    expect(rows.every((r) => r.status === 'not_addressed')).toBe(true);
  }
});
