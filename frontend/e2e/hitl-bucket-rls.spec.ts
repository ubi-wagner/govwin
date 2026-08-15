/**
 * Spotlight bucket lock-down — live drive under the forced-RLS govtech_app role (serve with
 * DATABASE_URL=postgres://govtech_app:apppass@…). Proves the RLS-scoped bucket routes + scorer work
 * end-to-end when the app connects as NOBYPASSRLS: list → create → rank → edit(merge) → delete(prune).
 * Also folds in the CC RLS-verification caveat (all tenant reads go through withTenant/enterTenant).
 * Run: npx playwright test --project=hitl hitl-bucket-rls
 */
import { test, expect, type Page } from '@playwright/test';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const BASE = '/api/portal/foundation/buckets';

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced`).not.toHaveURL(/\/login/);
}

test('bucket lifecycle create→rank→edit→delete under forced-RLS', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com');

  // 1. LIST — a RLS-scoped read returns rows only because withTenant set app.tenant_id.
  let r = await page.request.get(BASE);
  expect(r.ok(), 'list buckets').toBeTruthy();
  const existing = (await r.json()).data.buckets as Array<{ id: string }>;
  expect(existing.length, 'Foundation has buckets (proves RLS context works under govtech_app)').toBeGreaterThan(0);

  // 2. CREATE with distinctive keywords (sanitized + synchronously ranked by rankBucket).
  //    useTimeline:false → keyword is the ONLY signal, so step 4 can prove a re-rank cleanly.
  r = await page.request.post(BASE, { data: { name: 'RLS Lock Test', criteria: { keywords: ['additive', 'concrete'], useTimeline: false, weights: { keyword: 1 } } } });
  expect(r.ok(), 'create bucket').toBeTruthy();
  const id = (await r.json()).data.id as string;

  // 3. RANKED — scores were computed under forced RLS (rankBucket writes via withTenant).
  r = await page.request.get(`${BASE}/${id}`);
  expect(r.ok(), 'get ranking').toBeTruthy();
  const ranked = (await r.json()).data.ranked as Array<{ score: number }>;
  expect(ranked.length, 'cards were scored (rankBucket ran under RLS)').toBeGreaterThan(0);
  expect(ranked.some((x) => x.score > 0), 'at least one real keyword match').toBeTruthy();

  // 4. EDIT — PATCH merges criteria (weights kept) + re-ranks synchronously. Switch to a keyword
  //    that matches nothing → keyword scores collapse to 0 while the row set stays.
  r = await page.request.patch(`${BASE}/${id}`, { data: { criteria: { keywords: ['zzznotarealkeyword'] } } });
  expect(r.ok(), 'edit bucket').toBeTruthy();
  r = await page.request.get(`${BASE}/${id}`);
  const reRanked = (await r.json()).data.ranked as Array<{ score: number }>;
  expect(reRanked.length, 'still ranked after edit').toBeGreaterThan(0);
  // Every score 0 proves BOTH the re-rank (keyword now matches nothing) AND that the partial PATCH
  // MERGED — useTimeline:false survived (a clobber would have dropped it → timeline re-inflates scores).
  expect(reRanked.every((x) => x.score === 0), 'nonexistent keyword + merged useTimeline:false → all scores 0').toBeTruthy();

  // 5. DELETE — deactivate + prune the score rows inline.
  r = await page.request.delete(`${BASE}/${id}`);
  expect(r.ok(), 'delete bucket').toBeTruthy();
  r = await page.request.get(`${BASE}/${id}`);
  const afterDelete = (await r.json()).data.ranked as unknown[];
  expect(afterDelete.length, 'score rows pruned on delete').toBe(0);
});
