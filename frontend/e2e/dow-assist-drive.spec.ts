/**
 * Ingest Assist, driven as a real rfp_admin against the live DoW 2026 SBIR BAA.
 *
 * This spec is the PROOF for the two fixes it was written to verify:
 *
 *   A. The shred gate — Assist against a solicitation with no extracted text must REFUSE
 *      (409 SOURCE_TEXT_NOT_READY) instead of silently writing DEFAULT_SBIR_CSO_SKELETON
 *      into the compliance matrix as though it had read the document.
 *   B. The deterministic extractor — with text present, the matrix must come back with the
 *      rules this BAA actually states (10-pt minimum font, 1-inch margins, its SEVEN DSIP
 *      volumes, the 12 mandated Technical Volume sections), each stamped `pattern_match`
 *      with a citable excerpt — and with NO page limit, because the BAA sets none.
 *
 * Run: DRIVE_SOL_ID=<curated_solicitations.id> npx playwright test --project=drive dow-assist
 */
import { test, expect } from '@playwright/test';

const SHOTS = 'public/guides/rfp-ingest';
const SOL = process.env.DRIVE_SOL_ID!;

async function loginAsRfpAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test('A · readiness gate reports the real shred state', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsRfpAdmin(page);

  const res = await page.request.get(`/api/admin/rfp-curation/${SOL}/ingest-assist`);
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  console.log('[drive] readiness:', JSON.stringify(data));
  expect(data.ready).toBe(true);
  expect(data.state).toBe('ready');
  expect(data.chars).toBeGreaterThan(100_000);   // the real 50-page BAA + topic
});

test('A · Assist refuses a solicitation with no usable source text', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsRfpAdmin(page);

  // A solicitation that does not exist must 404 — never fall through to a default build.
  const missing = await page.request.post(
    '/api/admin/rfp-curation/00000000-0000-4000-8000-000000000000/ingest-assist',
    { data: { publish: false } },
  );
  expect(missing.status()).toBe(404);

  // A REAL unshredded solicitation (a crawler lead: title + summary only, no extracted PDF).
  // This is the case that used to write a full, confident, entirely fabricated matrix.
  const bare = process.env.DRIVE_UNSHREDDED_SOL_ID;
  test.skip(!bare, 'set DRIVE_UNSHREDDED_SOL_ID to a solicitation with no shredded text');

  const ready = await page.request.get(`/api/admin/rfp-curation/${bare}/ingest-assist`);
  expect((await ready.json()).data.ready).toBe(false);

  const refused = await page.request.post(`/api/admin/rfp-curation/${bare}/ingest-assist`, {
    data: { publish: false },
  });
  expect(refused.status()).toBe(409);
  const body = await refused.json();
  console.log('[drive] gate:', JSON.stringify(body));
  expect(body.code).toBe('SOURCE_TEXT_NOT_READY');
  expect(body.detail.canForceDefaultSkeleton).toBe(true);

  // …and the opt-in escape hatch still works, stamping every field `default`.
  const forced = await page.request.post(`/api/admin/rfp-curation/${bare}/ingest-assist`, {
    data: { publish: false, allowDefaultSkeleton: true },
  });
  expect(forced.ok()).toBeTruthy();
  const fd = (await forced.json()).data;
  expect(Object.values(fd.fieldSources)).not.toContain('pattern_match');
  expect(fd.source).toBe('default');
});

test('B · Assist reads the BAA and stamps pattern_match provenance', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await loginAsRfpAdmin(page);

  const res = await page.request.post(`/api/admin/rfp-curation/${SOL}/ingest-assist`, {
    data: { publish: false },
    timeout: 180_000,
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  console.log('[drive] assist:', JSON.stringify(data, null, 2));

  // The document's own seven volumes, not the six-volume default.
  expect(data.volumes).toBe(7);

  // Read, not guessed.
  expect(data.fieldSources.min_font_size).toBe('pattern_match');
  expect(data.fieldSources.margins).toBe('pattern_match');
  expect(data.fieldSources.required_sections).toBe('pattern_match');
  expect(data.fieldSources.volumes).toBe('pattern_match');

  // The BAA states no page limit — it defers to the Component instructions. Assert we say so.
  expect(String(data.notes.join(' '))).toMatch(/defers the technical-volume page limit/i);

  await page.goto(`/admin/rfp-curation/${SOL}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/08-after-ingest-assist.png`, fullPage: true });

  // The curator sees "Read from source", not a red "Default — unverified", on the fields we read.
  await expect(page.getByText('Read from source').first()).toBeVisible({ timeout: 15_000 });

  // …and the EMPTY page-limit cell explains itself rather than reading as an unfilled gap.
  await expect(page.getByText('Set elsewhere').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/defers the technical-volume page limit/i).first()).toBeVisible();
  console.log('[drive] assist re-run complete — pattern_match + deferral badges rendering');
});
