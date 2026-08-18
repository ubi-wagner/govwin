/**
 * PROPOSAL BUILD + COLLABORATION drive (docs/DATA_FLOW.md §section-save · §build→package,
 * docs/TENANT_WORKFLOW_SETUP_DESIGN.md TW-1..6, docs/CANVAS_ARCHITECTURE.md one-canvas rule).
 *
 * Runs on the FRESHLY-provisioned p2r portal (newest launched portal for kate) and proves the
 * whole build side as the real customer:
 *   B1 · the tenant ToDo queue is VISIBLE and non-empty under production RLS serving (the
 *        context-less task routes were the CRITICAL adversarial find),
 *   B2 · Workflow Setup: review → Accept & Start; per-task PATCH reschedules (and a bogus
 *        role is a clean 422, not a vanishing ToDo),
 *   B3 · section save honors the canvas_versions numbering + non-destructive 409 contract,
 *   B4 · node-anchored comments post + list,
 *   B5 · the emulated AI compliance review runs end-to-end (AI-gated flow, no live key),
 *   B6 · lock → compliance matrix row flips satisfied; readiness rolls up,
 *   B7 · lock-scope all + advance to submitted,
 *   B8 · package docx + pdf + zip download with the advisory X-Compliance-Violations header;
 *        the zip carries the cost volume as NATIVE xlsx whose styles carry the $#,##0
 *        currency format — the computed workbook survives to the wire (deferred cost proof).
 *
 * Actors: kate (tenant_admin). Serial; resume-safe.
 * Run: npx playwright test --project=drive build-collab
 */
import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

const SLUG = 'foundation';

test.describe.configure({ mode: 'serial' });

let PORTAL = '';
let PROPOSAL = '';
let TECH_SECTION = '';   // the mold-provisioned tech section we edit
let NODE_ID = '';        // a node in it (comment anchor)

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}
const asKate = (page: Page) => signIn(page, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');

const getDoc = async (page: Page) =>
  (await (await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/document`)).json()).data;

// ═════════ B1 · the tenant ToDo queue is ALIVE (RLS context fix) ═════════

test('B1 · kate finds the launched portal and a NON-EMPTY ToDo queue', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const portals = ((await (await page.request.get(`/api/portal/${SLUG}/portals`)).json()).data?.portals ?? []) as Array<Record<string, unknown>>;
  const launched = portals.filter((p) => p.proposalId && (p.status === 'launched' || p.status === 'executing'));
  expect(launched.length, 'a launched portal with a linked proposal must exist (run p2r first)').toBeGreaterThan(0);
  launched.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  const target = launched[launched.length - 1];
  PORTAL = String(target.id);
  PROPOSAL = String(target.proposalId);

  // The queue read/write path runs on the RLS'd tasks ledger — under the production
  // govtech_app posture this returned [] before the enterTenant fix.
  const q = await page.request.get(`/api/portal/${SLUG}/tasks`);
  expect(q.status(), await q.text()).toBe(200);
  const tasks = ((await q.json()).data?.tasks ?? []) as Array<Record<string, unknown>>;
  expect(tasks.length, 'the tenant ToDo queue must not read empty (release raised the Workflow Setup ToDo)').toBeGreaterThan(0);
});

// ═════════ B2 · Workflow Setup: Accept & Start + per-task PATCH ═════════

test('B2 · workflow review → Accept & Start; task PATCH reschedules; bogus role → 422', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const wfGet = await page.request.get(`/api/portal/${SLUG}/portals/${PORTAL}/workflow`);
  expect(wfGet.status(), await wfGet.text()).toBe(200);
  const wf = (await wfGet.json()).data;
  const config = wf.portal?.config ?? wf.config ?? wf;
  expect(Array.isArray(config.stages), 'the guardrail config must carry stages').toBe(true);

  const setupStatus = config?._setup?.status ?? 'pending';
  if (setupStatus !== 'accepted') {
    // Recommend-but-require (TW-3): Accept demands a COMPLETE plan — a gate date + an owned
    // ToDo per stage. Author it exactly as the tenant Workflow Setup page would.
    const day = 24 * 3600 * 1000;
    const authored = {
      ...config,
      stages: (config.stages as Array<Record<string, unknown>>).map((s, i) => ({
        ...s,
        dueDate: new Date(Date.now() + (i + 1) * 7 * day).toISOString().slice(0, 10),
        todos: (Array.isArray(s.todos) && (s.todos as unknown[]).length > 0) ? s.todos : [
          { type: 'acknowledge', title: `${s.label ?? s.key}: confirm the stage plan`, assigneeRole: 'tenant_admin' },
        ],
      })),
    };
    const acc = await page.request.patch(`/api/portal/${SLUG}/portals/${PORTAL}/workflow`, {
      data: { config: authored, accept: true },
    });
    expect(acc.status(), await acc.text()).toBe(200);
  }
  const after = (await (await page.request.get(`/api/portal/${SLUG}/portals/${PORTAL}/workflow`)).json()).data;
  expect((after.portal?.config ?? after.config ?? after)?._setup?.status).toBe('accepted');

  // Day-to-day reassign/reschedule rides the per-task PATCH (the row-driven sweeper contract).
  const tasks = ((await (await page.request.get(`/api/portal/${SLUG}/tasks`)).json()).data?.tasks ?? []) as Array<{ id: string }>;
  expect(tasks.length).toBeGreaterThan(0);
  const t = tasks[0];
  const due = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
  const patch = await page.request.patch(`/api/portal/${SLUG}/tasks/${t.id}`, { data: { dueAt: due } });
  expect(patch.status(), await patch.text()).toBe(200);

  // ADVERSARIAL: a typo'd role must be a clean 422 — not a ToDo that vanishes from every queue.
  const bad = await page.request.patch(`/api/portal/${SLUG}/tasks/${t.id}`, { data: { assigneeRole: 'Tenant Admin' } });
  expect(bad.status(), await bad.text()).toBe(422);
});

// ═════════ B3 · section save: numbering + non-destructive 409 ═════════

test('B3 · canvas save advances the version; a stale baseVersion is refused 409', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const doc = await getDoc(page);
  const sections = doc.sections as Array<{ id: string; title: string; version: number; canvas: Record<string, unknown> | null; editable: boolean; isLocked: boolean }>;
  const tech = sections.find((s) => /approach/i.test(s.title) && !s.isLocked) ?? sections.find((s) => !s.isLocked)!;
  expect(tech, 'an unlocked section must exist').toBeTruthy();
  TECH_SECTION = tech.id;
  // The document GET serves each section's canvas RULES frame (content stays in the editor);
  // authoring = writing a full CanvasDocument into that frame — exactly what the editor saves.
  expect(tech.canvas && typeof tech.canvas === 'object', 'the section must carry its canvas frame').toBeTruthy();
  NODE_ID = '11111111-2222-4333-8444-555555555555';

  const now = new Date().toISOString();
  const edited = {
    document_id: TECH_SECTION,
    canvas: tech.canvas,
    nodes: [
      {
        id: NODE_ID,
        type: 'text_block',
        content: { text: 'Kate: our team routinely fields cUAS payloads in GPS-denied environments.' },
        style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
      },
      {
        id: '22222222-3333-4444-8555-666666666666',
        type: 'text_block',
        content: { text: 'We will meet every Volume 1 requirement with flight-proven hardware.' },
        style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
      },
    ],
    metadata: {
      title: tech.title, volume_id: '', required_item_id: '', proposal_id: PROPOSAL,
      solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: 'kate',
      version_number: tech.version, status: 'in_progress',
    },
  };
  const save = await page.request.put(
    `/api/portal/${SLUG}/proposals/${PROPOSAL}/sections/${TECH_SECTION}/save`,
    { data: { content: edited, source: 'human_edit', baseVersion: tech.version } },
  );
  expect(save.status(), await save.text()).toBe(200);

  const doc2 = await getDoc(page);
  const tech2 = (doc2.sections as typeof sections).find((s) => s.id === TECH_SECTION)!;
  expect(tech2.version, 'version must ADVANCE on save').toBeGreaterThan(tech.version);

  // Non-destructive conflict: re-sending the ORIGINAL baseVersion must 409, never overwrite.
  const stale = await page.request.put(
    `/api/portal/${SLUG}/proposals/${PROPOSAL}/sections/${TECH_SECTION}/save`,
    { data: { content: edited, source: 'human_edit', baseVersion: tech.version } },
  );
  expect(stale.status(), await stale.text()).toBe(409);
});

// ═════════ B4 · node-anchored comments ═════════

test('B4 · a node-anchored comment posts and lists', async ({ page }) => {
  test.setTimeout(90_000);
  await asKate(page);
  expect(NODE_ID, 'B3 must have captured a node id').toBeTruthy();

  // The comments contract: top-level nodeId = the SECTION; the optional BLOCK anchor
  // carries the canvas node + highlighted span (SPINE-T7).
  const post = await page.request.post(`/api/portal/${SLUG}/proposals/${PROPOSAL}/comments`, {
    data: {
      nodeId: TECH_SECTION,
      text: 'Tighten this paragraph to the evaluator language (kate).',
      anchor: { nodeId: NODE_ID, quote: 'cUAS' },
    },
  });
  expect(post.status(), await post.text()).toBe(200);

  const list = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/comments?nodeId=${TECH_SECTION}`);
  expect(list.status(), await list.text()).toBe(200);
  const body = (await list.json()).data;
  const comments = (body.comments ?? body.threads ?? body) as Array<unknown>;
  expect(Array.isArray(comments) ? comments.length : 0).toBeGreaterThan(0);
});

// ═════════ B5 · emulated AI compliance review (AI-gated flow, no live key) ═════════

test('B5 · AI compliance review runs through the emulator', async ({ page }) => {
  test.setTimeout(180_000);
  await asKate(page);
  const r = await page.request.post(`/api/portal/${SLUG}/proposals/${PROPOSAL}/ai/compliance`, {
    data: { sectionId: TECH_SECTION },
  });
  expect(r.status(), await r.text()).toBe(200);
  const data = (await r.json()).data;
  expect(data, 'the review must return a payload').toBeTruthy();
});

// ═════════ B6 · lock → matrix satisfied ═════════

test('B6 · locking the section flips its compliance matrix row to satisfied', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const lock = await page.request.post(
    `/api/portal/${SLUG}/proposals/${PROPOSAL}/sections/${TECH_SECTION}/lock`, { data: {} },
  );
  expect([200, 409]).toContain(lock.status()); // 409/already = resume

  const comp = (await (await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/compliance`)).json()).data;
  const rows = (comp.items ?? []) as Array<{ sectionId?: string | null; status: string }>;
  const mine = rows.filter((r) => r.sectionId === TECH_SECTION);
  expect(mine.length, 'the section must have a matrix row').toBeGreaterThan(0);
  expect(mine.every((r) => r.status === 'satisfied'), 'lock must advance the matrix').toBe(true);
});

// ═════════ B7 · lock everything + advance to submitted ═════════

test('B7 · all sections lock; the proposal advances to submitted', async ({ page }) => {
  test.setTimeout(240_000);
  await asKate(page);

  const doc = await getDoc(page);
  for (const s of doc.sections as Array<{ id: string; isLocked: boolean }>) {
    if (s.isLocked) continue;
    const r = await page.request.post(`/api/portal/${SLUG}/proposals/${PROPOSAL}/sections/${s.id}/lock`, { data: {} });
    expect([200, 409]).toContain(r.status());
  }

  const readiness = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/readiness`);
  expect(readiness.status(), await readiness.text()).toBe(200);

  // draft → … → submitted (acknowledge advisory blockers; adopt CONFLICT on rerun).
  for (let i = 0; i < 3; i++) {
    const adv = await page.request.post(`/api/portal/${SLUG}/proposals/${PROPOSAL}/advance`, {
      data: { acknowledgeBlockers: true, notes: 'build-collab drive advance' },
    });
    if (adv.status() !== 200) {
      console.log('advance stopped:', adv.status(), (await adv.text()).slice(0, 300));
      expect([409, 422]).toContain(adv.status());
      break;
    }
    const stage = String((await adv.json()).data?.stage ?? '');
    if (stage === 'submitted' || stage === 'archived') break;
  }
  const propBody = (await (await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}`)).json()).data;
  const prop = (propBody?.proposal ?? propBody) as { stage?: string; isLocked?: boolean };
  expect(['submitted', 'archived'].includes(String(prop.stage)) || prop.isLocked === true,
    `proposal must reach an export-eligible state (got stage=${prop.stage} locked=${prop.isLocked})`).toBe(true);
});

// ═════════ B8 · package docx + pdf + zip (native cost xlsx, $#,##0 cells, floor header) ═════════

test('B8 · package downloads in all formats; zip carries the NATIVE cost workbook', async ({ page }) => {
  test.setTimeout(300_000);
  await asKate(page);

  for (const fmt of ['docx', 'pdf'] as const) {
    const r = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/package?format=${fmt}`);
    expect(r.status(), `${fmt}: ${r.status()}`).toBe(200);
    expect(r.headers()['x-compliance-violations'], `${fmt} must carry the advisory floor header`).toBeDefined();
    expect((await r.body()).length).toBeGreaterThan(1000);
  }

  const rz = await page.request.get(`/api/portal/${SLUG}/proposals/${PROPOSAL}/package?format=zip`);
  expect(rz.status(), await rz.text()).toBe(200);
  expect(rz.headers()['x-compliance-violations'], 'zip must carry the advisory floor header').toBeDefined();
  const zip = await JSZip.loadAsync(await rz.body());
  const names = Object.keys(zip.files);
  const xlsxName = names.find((n) => n.endsWith('.xlsx'));
  expect(xlsxName, `the cost volume must export as NATIVE xlsx (got: ${names.join(', ')})`).toBeTruthy();

  // The computed workbook's currency format must survive to the wire: the inner xlsx's
  // styles carry the $#,##0 numFmt written by the burden engine's money cells.
  const inner = await JSZip.loadAsync(await zip.files[xlsxName!].async('nodebuffer'));
  const styles = await inner.files['xl/styles.xml']?.async('string');
  expect(styles, 'xl/styles.xml must exist in the cost workbook').toBeTruthy();
  expect(styles!.includes('$#,##0'), 'the $#,##0 currency numFmt must be present').toBe(true);
});
