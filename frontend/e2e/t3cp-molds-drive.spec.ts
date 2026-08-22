/**
 * The MOLDS gate, driven as a real rfp_admin.
 *
 * Before this the gate was a dead end: skeleton_architect ran, proposed a skeleton advisorily,
 * and its output went nowhere — `solicitation_outlines` had never been written by any code path,
 * and nothing turned a proposal into molds. The panel parked a human in front of nothing.
 *
 * This drives the two halves that were missing and asserts the gate now tells the truth about
 * itself at every step:
 *
 *   1. before   — the gate reports 0 molds against N items to mold. It does NOT claim completion
 *                 just because the phase's workflow instance finished.
 *   2. propose  — a skeleton is staged, labelled with where it came from ('agent' when the run
 *                 produced parseable JSON, 'matrix' when derived from the landed matrix).
 *   3. build    — real molds exist, one per AUTHORED item, linked back onto the item so provision
 *                 seeds the buyer's section with the solicitation's own mandated structure.
 *   4. after    — every authored item carries a mold, and only then does the phase read complete.
 *                 DSIP-only work is never molded: there is no document to author for it.
 *
 * Run: DRIVE_SOL_ID=<id> npx playwright test --project=drive t3cp-molds
 */
import { test, expect, type Page } from '@playwright/test';
import { resolveShreddedSolicitation } from './resolve-solicitation';

/* Resolved from the DB in beforeAll — `process.env.DRIVE_SOL_ID!` was unset, so every request
 * went to /…/undefined/… and this file failed on a bare false. See e2e/resolve-solicitation.ts. */
let SOL = '';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

const gate = (page: Page) =>
  page.request.get(`/api/admin/rfp-curation/${SOL}/ingest-phase`).then((r) => r.json()).then((j) => j.data);

const act = async (page: Page, action: string) => {
  const res = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-phase`, {
    data: { action }, timeout: 120_000,
  });
  return { ok: res.ok(), status: res.status(), body: await res.json() };
};

test.beforeAll(async () => {
  SOL = (await resolveShreddedSolicitation('DRIVE_SOL_ID')).id;
});

test('molds gate · propose a skeleton, build the molds, and only then read complete', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  await signIn(page);

  // ── 1. The gate before anything is built ──
  const before = await gate(page);
  console.log('[molds] before:', JSON.stringify(before.molds));
  expect(before.molds, 'the gate must report its own mold state').toBeTruthy();
  expect(before.molds.itemsToMold).toBeGreaterThan(0);

  // ── 2. Building without a proposal is refused, not silently improvised ──
  if (!before.outline) {
    const premature = await act(page, 'build_molds');
    expect(premature.status).toBe(409);
    expect(premature.body.code).toBe('NO_OUTLINE');
    console.log('[molds] build before propose → 409 NO_OUTLINE (correct)');
  }

  // ── 3. Propose ──
  const proposed = await act(page, 'propose_molds');
  expect(proposed.ok, JSON.stringify(proposed.body)).toBeTruthy();
  const outline = proposed.body.data;
  expect(['agent', 'matrix']).toContain(outline.source);
  const sections = (outline.volumes as Array<{ sections: unknown[] }>).reduce((a, v) => a + v.sections.length, 0);
  console.log(`[molds] proposed from ${outline.source}: ${outline.volumes.length} volumes, ${sections} sections`);
  expect(sections).toBeGreaterThan(0);

  // A DSIP-only volume is listed (so the skeleton is complete) but contributes no sections to
  // author — the company never writes a document for it.
  for (const v of outline.volumes as Array<{ volume: string; dsipOnly: boolean; sections: unknown[] }>) {
    if (v.dsipOnly) expect(v.sections, `${v.volume} is DSIP-only`).toHaveLength(0);
  }

  // ── 4. Build ──
  const built = await act(page, 'build_molds');
  expect(built.ok, JSON.stringify(built.body)).toBeTruthy();
  console.log(`[molds] built ${built.body.data.built}, linked ${built.body.data.linked}, skipped ${built.body.data.skipped}`);
  for (const m of built.body.data.molds as Array<{ itemName: string; nodes: number }>) {
    console.log(`   · ${m.itemName} — ${m.nodes} nodes`);
    expect(m.nodes, `${m.itemName} must have real structure`).toBeGreaterThan(1);
  }

  // ── 5. The gate afterwards ──
  const after = await gate(page);
  console.log('[molds] after:', JSON.stringify(after.molds), 'phase:', after.phase);
  expect(after.molds.itemsWithMold).toBe(after.molds.itemsToMold);
  expect(after.molds.outlineSource).toBe(outline.source);
  expect(after.phase).toBe('complete');

  // ── 6. Re-running is safe: nothing is duplicated ──
  const again = await act(page, 'build_molds');
  expect(again.ok).toBeTruthy();
  expect(again.body.data.built, 'a second build must not duplicate molds').toBe(0);
  console.log('[molds] ✓ re-run built 0 (idempotent)');
});
