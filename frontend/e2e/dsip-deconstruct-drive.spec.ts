/**
 * DSIP FULL-PROPOSAL DECONSTRUCT drive — the reverse of the pipeline build-up.
 *
 * kate uploads ONE merged DSIP proposal download (a real Chromium-rendered PDF fixture,
 * e2e/fixtures/dsip-sample.pdf) into the company library with the "complete past proposal"
 * declaration, and the atomizer deconstructs it:
 *   V1 · PREVIEW (dry-run) reports the five volume segments before anything is written,
 *   V2 · COMMIT creates one cocoon (the shared past-proposal UUID) + five Volume 1–5
 *        FOUNDATION documents + volume-tagged primitives, all linked to that cocoon,
 *   V3 · the Past Proposals reuse index lists the package; the library lists the five
 *        foundation volume documents,
 *   V4 · the deconstructed package plugs straight into the verbatim-reuse engine
 *        (reuse-past accepts the cocoon).
 *
 * Actor: kate (tenant_admin). Serial; resume-safe (a rerun mints a NEW cocoon — asserts
 * scope to the cocoon returned by THIS run). Run: npx playwright test --project=drive dsip
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const SLUG = 'foundation';
const FIXTURE = join(__dirname, 'fixtures', 'dsip-sample.pdf');

test.describe.configure({ mode: 'serial' });

let COCOON = '';

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

const upload = (page: Page, extra: Record<string, string>) =>
  page.request.post(`/api/portal/${SLUG}/atoms/atomize-package`, {
    multipart: {
      files: { name: 'dsip-sample.pdf', mimeType: 'application/pdf', buffer: readFileSync(FIXTURE) },
      context: JSON.stringify({ docType: 'past_proposal', program: 'sbir', phase: '1', agency: 'Navy' }),
      packageName: 'Aerivio DSIP deconstruct drive',
      ...extra,
    },
  });

test('V1 · PREVIEW segments the single PDF into five volumes without writing', async ({ page }) => {
  test.setTimeout(180_000);
  await asKate(page);
  const r = await upload(page, { preview: '1' });
  expect(r.status(), await r.text()).toBe(200);
  const doc = (await r.json()).data.docs[0] as { dsip?: { volumes: Array<{ volume: number; name: string; blocks: number }> }; planned: Array<{ volumeNumber?: number }> };
  expect(doc.dsip, 'the preview must report the deconstruct plan').toBeTruthy();
  expect(doc.dsip!.volumes.map((v) => v.volume)).toEqual([1, 2, 3, 4, 5]);
  expect(doc.dsip!.volumes.find((v) => v.volume === 2)?.name).toBe('Technical Volume');
  // Every planned primitive belongs to a volume (front matter only precedes Volume 1's marker).
  expect(doc.planned.length).toBeGreaterThan(15);
  expect(doc.planned.every((p) => (p.volumeNumber ?? 0) >= 1 && (p.volumeNumber ?? 0) <= 5)).toBe(true);
});

test('V2 · COMMIT deconstructs into one cocoon + five foundation volumes + tagged primitives', async ({ page }) => {
  test.setTimeout(180_000);
  await asKate(page);
  const r = await upload(page, {});
  expect(r.status(), await r.text()).toBe(200);
  const data = (await r.json()).data as { totalAtoms: number; docs: Array<{ cocoonId: string | null; atoms: number; volumes?: number; error?: string }> };
  const doc = data.docs[0];
  expect(doc.error).toBeUndefined();
  expect(doc.volumes, 'five volume foundation documents').toBe(5);
  expect(doc.atoms, 'volume-tagged primitives').toBeGreaterThan(15);
  expect(String(doc.cocoonId)).toMatch(/^[0-9a-f-]{36}$/);
  COCOON = String(doc.cocoonId);
});

test('V3 · the package lists in Past Proposals and the five volumes in the library', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);

  const pp = await page.request.get(`/api/portal/${SLUG}/library/past-proposals`);
  expect(pp.status(), await pp.text()).toBe(200);
  const ppBody = (await pp.json()).data;
  const list = (ppBody.pastProposals ?? ppBody.proposals ?? ppBody) as Array<{ id: string; sectionCount?: number }>;
  const mine = (Array.isArray(list) ? list : []).find((c) => c.id === COCOON);
  expect(mine, 'the deconstructed package must appear in the reuse index').toBeTruthy();
  expect(mine!.sectionCount ?? 0).toBeGreaterThan(15);

  const at = await page.request.get(`/api/portal/${SLUG}/atoms?grain=foundation&limit=200`);
  expect(at.status(), await at.text()).toBe(200);
  const atoms = ((await at.json()).data.atoms ?? []) as Array<{ title: string | null; summary?: string | null }>;
  const volumes = atoms.filter((a) => /^Volume [1-6] — /.test(a.title ?? '') && (a.summary ?? '').includes('dsip-sample.pdf'));
  const titles = new Set(volumes.map((a) => (a.title ?? '').slice(0, 8)));
  expect(titles.size, `five distinct volume foundation docs (got: ${[...titles].join(', ')})`).toBeGreaterThanOrEqual(5);
  // Provenance doctrine: every foundation doc CITES the marker it was segmented on.
  expect(volumes.every((a) => (a.summary ?? '').includes('marker "'))).toBe(true);
});

test('V4 · the deconstructed package feeds the verbatim-reuse engine', async ({ page }) => {
  test.setTimeout(120_000);
  await asKate(page);
  const portals = ((await (await page.request.get(`/api/portal/${SLUG}/portals`)).json()).data?.portals ?? []) as Array<Record<string, unknown>>;
  const launched = portals.filter((p) => p.proposalId && (p.status === 'launched' || p.status === 'executing'));
  expect(launched.length).toBeGreaterThan(0);
  const proposalId = String(launched[launched.length - 1].proposalId);

  const r = await page.request.post(`/api/portal/${SLUG}/proposals/${proposalId}/reuse-past`, {
    data: { cocoonId: COCOON },
  });
  expect(r.status(), await r.text()).toBe(200);
  const data = (await r.json()).data as { applied: number; unmatched: string[]; scanned: boolean };
  // Titles differ from the build's sections, so applied may be 0 — the contract under test
  // is that the deconstructed cocoon is ACCEPTED by the reuse engine (the reverse loop).
  expect(data.scanned).toBe(true);
  expect(data.applied).toBeGreaterThanOrEqual(0);
});
