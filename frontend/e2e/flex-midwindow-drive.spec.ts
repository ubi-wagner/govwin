/**
 * FLEX MID-WINDOW DRIVE — the master OPP edited AFTER Spotlight release, BEFORE the
 * buyer's portal release, as real actors on both sides (docs/MASTER_MIRROR_OPP_DESIGN.md).
 *
 *   ADMIN (eric)   claim → review → approve → PUSH (Release 1) · then mid-window: summary +
 *                  expert-note edit · attach a document · add a volume · log+confirm an
 *                  amendment (with its announcing document) · leave curation notes ·
 *                  broadcast · late-topic addition (date guard → close date → auto-release) ·
 *                  cockpit Complete & Release (Release 2).
 *   TENANT (kate)  sees the card · pins · purchases (comp code, 72h window opens) · sees every
 *                  mid-window edit land on her mirror (bridge version advances, summary/note
 *                  refresh, docs_update_available) · opens the released portal with the
 *                  amendment REPLAYED (flag + document) and acknowledges it.
 *
 * Serial by design — this is one continuous curation story.
 * Run: npx playwright test --project=drive flex-midwindow
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolveShreddedSolicitation } from './resolve-solicitation';

/* THIS FILE USED TO SKIP FOR TWO PDFs IT NEVER OPENS.
 *
 * It opened with
 *
 *     const [COMPONENT, TOPIC_PDF] = requireUploads(
 *       'bc936179-OSWT3CP_SBIR_26BZ_R4_v2.pdf',
 *       'a4bcf95d-topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF');
 *
 * and neither binding is referenced anywhere below — grep the file. They are a vestige of an earlier
 * shape. `requireUploads` skips the whole suite when a named file is absent, and those two chat
 * uploads did not survive the container, so all SEVEN tests skipped for a dependency that does not
 * exist. The one T3CP-looking thing F5 actually needs it GENERATES itself (topic_OSW26BZ97ZZ…,
 * a number it invents per run) precisely so the content-hash dedup never trips.
 *
 * That mattered beyond this file: F5 creates the dated late topic p2r-template selects a template
 * for, so p2r had nothing to act on either. Two dead lines were holding eleven tests shut.
 *
 * SOL was likewise a hard-coded id (aca5e83a-…) for a solicitation nobody can rebuild — absent here,
 * so F1 failed and serial mode skipped F2–F7 even when the suite did reach them. Resolve it from the
 * data like every other drive (docs/FIXTURE_INTEGRITY.md).
 */
let SOL = '';
/* flex OWNS its scenario. It curates, pushes, amends and adds a late topic to whatever solicitation
 * it is given, so sharing one with the other drives made five of them fail on state they never
 * created once this file stopped skipping. */
test.beforeAll(async () => { SOL = (await resolveShreddedSolicitation('FLEX_SOL_ID', 'flex')).id; });
const SLUG = 'foundation';
const SHOTS = 'public/guides/rfp-ingest';

test.describe.configure({ mode: 'serial' });

// Cross-test state
let OPP = '';            // the landing opportunity id
let V_AT_PIN = 0;        // kate's bridge_version at pin time
let PORTAL = '';         // kate's purchased portal
let AMENDMENT = '';      // the mid-window amendment
let DOC_ID = '';         // the attached (announcing) document
let TOPIC_OPP = '';      // the late topic
let PROPOSAL = '';       // the released build
let WINDOW_OPEN = true;  // true = amendment confirmed with NO proposal yet (the replay case)

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

const j = async (r: { status(): number; json(): Promise<unknown> }) =>
  ({ status: r.status(), body: (await r.json().catch(() => ({}))) as Record<string, never> & { data?: never; error?: string; code?: string } });

async function kateCard(req: APIRequestContext) {
  const res = await req.get(`/api/portal/${SLUG}/cards`);
  expect(res.status(), await res.text()).toBe(200);
  const { data } = await res.json();
  const rows = (data?.cards ?? data ?? []) as Array<Record<string, unknown>>;
  return rows.find((c) => c.opportunityId === OPP || c.opportunity_id === OPP);
}

// ═════════════ F1 · ADMIN — Release 1: curate + push through the real gates ═════════════

test('F1 · admin curates and pushes the OPP to every tenant', async ({ page }) => {
  test.setTimeout(180_000);
  await asAdmin(page);

  // The push gate requires the spotlight summary — write it through the editor's route.
  const patch = await page.request.patch(`/api/admin/rfp-curation/${SOL}`, {
    data: { spotlightSummary: 'DoW 2026 SBIR umbrella BAA — open-topic (T3CP patent-holiday), dual-use hardware/software; agencies: DoW components; keywords: SBIR Phase I, additive manufacturing, autonomy.' },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  // The push gate needs submission_format on the matrix — the COV BAA correctly DEFERRED it
  // ("Component instructions"), so the admin sets it through the Compliance panel's surface.
  const fmt = await page.request.post(`/api/admin/rfp-curation/${SOL}/compliance`, {
    data: { variableName: 'submission_format', value: 'Electronic submission via DSIP (PDF)', notes: 'Set from Component instructions (mid-window drive)' },
  });
  expect(fmt.status(), await fmt.text()).toBe(200);

  // The action bar's real sequence: claim (tool) → start curation (triage skip_shredder) →
  // request review → approve → PUSH — each through the product's own tool surface. Steps
  // before push tolerate an already-advanced state (409/422) so the serial drive can resume.
  const status = async () =>
    ((await (await page.request.get(`/api/admin/rfp-curation/${SOL}`)).json()).data.solicitation.status as string);
  if (await status() !== 'pushed_to_pipeline') {
    const claim = await page.request.post('/api/tools/solicitation.claim', { data: { input: { solicitationId: SOL } } });
    expect([200, 409, 422]).toContain(claim.status());
    const skip = await page.request.post(`/api/admin/rfp-curation/${SOL}/triage`, { data: { action: 'skip_shredder' } });
    expect([200, 409]).toContain(skip.status());
    for (const tool of ['solicitation.request_review', 'solicitation.approve']) {
      const r = await page.request.post(`/api/tools/${tool}`, { data: { input: { solicitationId: SOL } } });
      expect([200, 409, 422], `${tool}: ${await r.text()}`).toContain(r.status());
    }
    const push = await page.request.post('/api/tools/solicitation.push', { data: { input: { solicitationId: SOL } } });
    expect(push.status(), `push: ${await push.text()}`).toBe(200);
  }

  const detail = await page.request.get(`/api/admin/rfp-curation/${SOL}`);
  const d = (await detail.json()).data;
  expect(d.solicitation.status).toBe('pushed_to_pipeline');
  OPP = d.solicitation.opportunityId as string;
  expect(OPP).toMatch(/^[0-9a-f-]{36}$/);
});

// ═════════════ F2 · TENANT — kate discovers, pins, purchases (the window opens) ═════════════

test('F2 · kate sees the card, pins it, and buys the portal (comp code)', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const card = await kateCard(page.request);
  expect(card, 'the pushed OPP must have fanned onto kate’s mirror').toBeTruthy();
  V_AT_PIN = Number(card!.bridgeVersion ?? 0);
  expect(V_AT_PIN).toBeGreaterThanOrEqual(1);

  const pin = await page.request.post(`/api/portal/${SLUG}/cards/${OPP}/documents`, { data: {} });
  expect(pin.status(), await pin.text()).toBe(200);

  const buy = await page.request.post(`/api/portal/${SLUG}/purchase`, {
    data: { opportunityId: OPP, promoCode: 'rfppipelinetest', label: 'FLEX drive' },
  });
  if (buy.status() === 200) {
    PORTAL = ((await buy.json()).data.portalId as string);
  } else {
    // Serial-drive resume: a prior run already purchased — adopt that portal.
    const bt = await buy.text();
    expect(bt, bt).toContain('ALREADY_PURCHASED');
    const list = await page.request.get(`/api/portal/${SLUG}/portals`);
    expect(list.status(), await list.text()).toBe(200);
    const portals = ((await list.json()).data?.portals ?? []) as Array<Record<string, unknown>>;
    const mine = portals.find((p) => p.opportunityId === OPP);
    expect(mine, 'existing portal for the OPP must be listed').toBeTruthy();
    PORTAL = String(mine!.id);
  }
  expect(PORTAL).toMatch(/^[0-9a-f-]{36}$/);
});

// ═════════════ F3 · ADMIN — the mid-window: every kind of revision, all propagating ═════════════

test('F3 · mid-window revisions: summary · expert note · attachment · volume · amendment · notes · broadcast', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await asAdmin(page);

  // (a) Summary + expert note — both card-snapshot inputs; the save must broadcast.
  const patch = await page.request.patch(`/api/admin/rfp-curation/${SOL}`, {
    data: {
      spotlightSummary: 'UPDATED mid-window: DoW 2026 SBIR umbrella BAA — Component instructions attached; T3CP patent-holiday open topic; additive manufacturing, autonomy, ISR.',
      expertNotes: 'Component-specific instructions now on file — page limits confirmed in Vol. 2 instructions.',
    },
  });
  const pb = (await patch.json()).data;
  expect(patch.status()).toBe(200);
  expect(pb.propagation.republished, 'a pushed OPP must rebroadcast on save').toBeGreaterThanOrEqual(1);

  // (b) Attach the Amendment 0003 NOTICE to the LIVE solicitation (multipart, the real form
  // path; type 'amendment'). Generated per run so the content-hash dedup — which correctly
  // refuses a re-upload of the already-attached Component PDF — never trips.
  const stamp = new Date().toISOString();
  const noticeText = `Amendment 0003 notice - DoW 2026 SBIR BAA - issued ${stamp}`;
  const pdfBody = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${noticeText.length + 45}>>stream\nBT /F1 12 Tf 72 720 Td (${noticeText}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  const attach = await page.request.post('/api/admin/rfp-upload', {
    multipart: {
      title: 'ignored on attach', agency: 'Department of War', programType: 'sbir_phase_1',
      closeDate: '2026-08-19', solicitationId: SOL,
      documentTypes: JSON.stringify(['amendment']),
      files: { name: 'Amendment_0003_notice.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfBody) },
    },
  });
  expect(attach.status(), await attach.text()).toBe(201);
  const ab = (await attach.json()).data;
  expect(ab.propagation?.republished ?? 0).toBeGreaterThanOrEqual(1);

  // (c) Add a volume through the product's own tool surface — volumeCount rides the card.
  const vol = await page.request.post('/api/tools/volume.add', {
    data: { input: { solicitationId: SOL, volumeNumber: 3, volumeName: 'Supporting Documents', volumeFormat: 'custom' } },
  });
  // 409 CONFLICT = a prior run of this serial drive already added Vol 3 — same end state.
  expect([200, 409], await vol.text()).toContain(vol.status());

  // (d) Log an amendment carrying its announcing document, then confirm. NO proposals exist
  // yet (the window!) — flagged must be 0; the mirror broadcast is the pre-release reach and
  // the provision-time REPLAY (F6) is the guarantee for the buyer.
  const docs = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}`)).json()).data.documents as Array<{ id: string; documentType: string }>;
  DOC_ID = docs.find((x) => x.documentType === 'amendment')?.id ?? docs[0].id;
  const logA = await page.request.post(`/api/admin/rfp-curation/${SOL}/amendments`, {
    data: {
      label: 'Amendment 0003', severity: 'major', documentId: DOC_ID,
      summary: 'Component-specific instructions released — Volume 2 page limit confirmed at 12 pages; new Supporting Documents volume required.',
      complianceDelta: [
        { change: 'changed', requirement: 'Technical Volume page limit', detail: 'Confirmed 12 pages per Component instructions.' },
        { change: 'added', requirement: 'Supporting Documents volume', detail: 'Vol 3 required per instructions.' },
      ],
    },
  });
  expect(logA.status(), await logA.text()).toBe(200);
  AMENDMENT = (await logA.json()).data.id as string;
  const confirmA = await page.request.post(`/api/admin/rfp-curation/${SOL}/amendments/${AMENDMENT}`, { data: { action: 'confirm' } });
  expect(confirmA.status(), await confirmA.text()).toBe(200);
  const listA = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}/amendments`)).json()).data.amendments as Array<{ id: string; status: string; flagged: number; documentFilename: string | null }>;
  const mine = listA.find((a) => a.id === AMENDMENT)!;
  expect(mine.status).toBe('confirmed');
  expect(mine.documentFilename).toBe('Amendment_0003_notice.pdf');
  // WINDOW SEMANTICS: pre-release (fresh DB) confirm reaches ZERO proposals — the replay at
  // F6 is the buyer's guarantee. On a resumed drive the portal is already launched, so the
  // confirm rightly flags the live proposal directly. Both are the contract.
  WINDOW_OPEN = mine.flagged === 0;

  // (e) Curation notes — the internal margin survives push.
  const note = await page.request.post(`/api/admin/rfp-curation/${SOL}/notes`, {
    data: { body: 'Mid-window: instructions attached, Vol 3 added, Amendment 0003 confirmed. Buyer (Foundation 3DP) purchased — release after matrix re-check.' },
  });
  expect(note.status(), await note.text()).toBe(201);
  const notes = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}/notes`)).json()).data.notes;
  expect(notes.length).toBeGreaterThanOrEqual(1);

  // (f) The explicit broadcast lever.
  const bc = await page.request.post(`/api/admin/rfp-curation/${SOL}/broadcast`);
  expect(bc.status()).toBe(200);
  expect((await bc.json()).data.republished).toBeGreaterThanOrEqual(1);

  // The workspace shows the live-state chip + broadcast + notes (screenshot for the guide).
  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/30-flex-live-workspace.png` });
});

// ═════════════ F4 · TENANT — every revision landed on kate's mirror ═════════════

test('F4 · kate’s mirror card advanced: version, summary, expert note, update badge', async ({ page }) => {
  await asKate(page);
  const card = await kateCard(page.request);
  expect(card).toBeTruthy();
  expect(Number(card!.bridgeVersion)).toBeGreaterThan(V_AT_PIN);
  const snap = card!.card as Record<string, unknown>;
  expect(String(snap.spotlightSummary)).toContain('UPDATED mid-window');
  expect(String(snap.expertNotes)).toContain('Component-specific instructions');
  expect(card!.docsUpdateAvailable, 'pinned card + advanced version ⇒ the amber update badge').toBe(true);
});

// ═════════════ F5 · ADMIN — late topic: date guard parks it, close date releases it ═════════════

test('F5 · a topic added post-push parks on the date guard, then auto-releases when dated', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await asAdmin(page);

  // Generated per run (unique topic number + content) so the content-hash dedup — which
  // correctly refuses the already-attached real topic PDF — never trips.
  const nn = String(Date.now() % 10000).padStart(4, '0');
  const topicName = `topic_OSW26BZ97ZZ${nn}_FLEX_Patent_Holiday_Addendum.pdf`;
  const topicText = `OSW26BZ97ZZ${nn} FLEX Patent Holiday Addendum - late open-topic call issued after BAA push`;
  const topicPdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${topicText.length + 45}>>stream\nBT /F1 12 Tf 72 720 Td (${topicText}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  const up = await page.request.post('/api/admin/upload-topic-files', {
    multipart: {
      solicitationId: SOL,
      files: { name: topicName, mimeType: 'application/pdf', buffer: Buffer.from(topicPdf) },
    },
  });
  expect([200, 201], await up.text()).toContain(up.status());
  const ub = (await up.json()).data ?? (await up.json());
  const created = (ub.created ?? []) as Array<{ opportunityId: string }>;
  expect(created.length).toBe(1);
  TOPIC_OPP = created[0].opportunityId;
  // Extracted topics carry no close date — the date guard must have parked it off the bridge.
  expect(ub.needsCloseDate ?? 0).toBe(1);

  // Kate must NOT see it yet.
  const kateReq = await page.context().browser()!.newContext();
  const kp = await kateReq.newPage();
  await asKate(kp);
  const before = await kp.request.get(`/api/portal/${SLUG}/cards`);
  const beforeRows = ((await before.json()).data?.cards ?? []) as Array<Record<string, unknown>>;
  expect(beforeRows.find((c) => c.opportunityId === TOPIC_OPP)).toBeFalsy();

  // The close date arrives (the lifecycle surface) → the topic releases itself.
  const cd = await page.request.post(`/api/admin/opportunities/${TOPIC_OPP}/lifecycle`, {
    data: { action: 'close_date_change', closeDate: '2026-08-19T16:00:00Z', reason: 'Release 4 close per BAA schedule' },
  });
  expect(cd.status(), await cd.text()).toBe(200);
  const cdb = (await cd.json()).data;
  expect(cdb.lateRelease?.released, 'the dated late topic must reach the bridge now').toBe(true);

  // Kate sees the new topic card.
  const after = await kp.request.get(`/api/portal/${SLUG}/cards`);
  const afterRows = ((await after.json()).data?.cards ?? []) as Array<Record<string, unknown>>;
  expect(afterRows.find((c) => c.opportunityId === TOPIC_OPP)).toBeTruthy();
  await kateReq.close();
});

// ═════════════ F6 · ADMIN — Release 2: cockpit release; the amendment replays ═════════════

test('F6 · cockpit Complete & Release provisions the buyer with the amendment REPLAYED', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await asAdmin(page);

  // Cockpit view first (notes panel present, readiness visible) — screenshot for the guide.
  await page.goto(`/admin/provisioning/${PORTAL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/31-flex-cockpit-notes.png` });

  const rel = await page.request.post(`/api/admin/provisioning/${PORTAL}/release`, {
    data: { confirm: true },
  });
  if (rel.status() === 200) {
    PROPOSAL = ((await rel.json()).data.proposalId as string);
  } else {
    // Resumed drive: the portal already launched in a prior pass — adopt its build.
    expect([409]).toContain(rel.status());
    const kateCtx = await page.context().browser()!.newContext();
    const kp = await kateCtx.newPage();
    await asKate(kp);
    const list = await kp.request.get(`/api/portal/${SLUG}/portals`);
    const portals = ((await list.json()).data?.portals ?? []) as Array<Record<string, unknown>>;
    PROPOSAL = String(portals.find((p) => String(p.id) === PORTAL)?.proposalId ?? '');
    await kateCtx.close();
  }
  expect(PROPOSAL).toMatch(/^[0-9a-f-]{36}$/);
});

// ═════════════ F7 · TENANT — the fresh portal opens WITH the mid-window amendment ═════════════

test('F7 · kate’s new build carries the replayed amendment + its document; she acknowledges', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const flagsRes = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/amendments`);
  expect(flagsRes.status(), await flagsRes.text()).toBe(200);
  const flags = (await flagsRes.json()).data.flags as Array<{ flagId: string; amendmentId: string; label: string; documentFilename: string | null; acknowledgedAt: string | null }>;
  const replayed = flags.find((f) => f.amendmentId === AMENDMENT);
  expect(
    replayed,
    WINDOW_OPEN
      ? 'the mid-window amendment must have been REPLAYED at provision'
      : 'the amendment must have been flagged directly (window already closed on resume)',
  ).toBeTruthy();
  expect(replayed!.documentFilename).toBeTruthy();

  // The announcing document opens (flag-gated signed URL).
  const doc = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/amendments/${AMENDMENT}/document`);
  expect(doc.status(), await doc.text()).toBe(200);
  expect((await doc.json()).data.url).toBeTruthy();

  // The banner renders on the proposal page (screenshot), then acknowledge.
  await page.goto(`/portal/${SLUG}/proposals/${PROPOSAL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/32-flex-banner-replayed.png` });

  const ack = await page.request.post(`/api/portal/${SLUG}/proposals/${PROPOSAL}/amendments`, {
    data: { flagId: replayed!.flagId },
  });
  expect(ack.status(), await ack.text()).toBe(200);
});
