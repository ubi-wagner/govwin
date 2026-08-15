/**
 * Opportunity ranking-spine live drive under the forced-RLS govtech_app role (serve with
 * DATABASE_URL=postgres://govtech_app:apppass@…). Proves the RANK-2/3/4/5 additions work end-to-end
 * when the app connects as NOBYPASSRLS: the bucket CAP, the per-bucket ranking of the single card list,
 * the bucket EDIT path, and the designee GRANT write. Companion to hitl-bucket-rls.spec.ts.
 * Run: npx playwright test --project=hitl hitl-ranking-spine
 */
import { test, expect, type Page } from '@playwright/test';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const BUCKETS = '/api/portal/foundation/buckets';

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

test('ranking spine: per-bucket ranking + cap + edit + designee grant under forced-RLS', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com');

  // ── RANK-5: the single mirror-OPP list carries the active-bucket catalog + a per-card score array ──
  let r = await page.request.get('/api/portal/foundation/cards');
  expect(r.ok(), 'list cards').toBeTruthy();
  const cardsBody = (await r.json()).data;
  expect(Array.isArray(cardsBody.buckets), 'cards route returns the active-bucket catalog').toBeTruthy();
  expect(cardsBody.buckets.length, 'Foundation has active buckets').toBeGreaterThan(0);
  const withRankings = (cardsBody.cards as Array<{ rankings?: unknown[] }>).find((c) => Array.isArray(c.rankings) && c.rankings.length > 0);
  expect(withRankings, 'at least one card carries a per-bucket rankings array').toBeTruthy();
  const rk = (withRankings!.rankings as Array<{ bucketId: string; score: number }>);
  expect(typeof rk[0].bucketId === 'string' && typeof rk[0].score === 'number', 'ranking entry is {bucketId, score}').toBeTruthy();

  // ── RANK-2: the cap is served, and creation is refused (409 BUCKET_LIMIT) at the ceiling ──
  r = await page.request.get(BUCKETS);
  const g = (await r.json()).data;
  const cap = g.cap as number;
  expect(typeof cap === 'number' && cap > 0, 'GET /buckets returns the platform cap').toBeTruthy();
  const startCount = (g.buckets as unknown[]).length;

  const created: string[] = [];
  let hit409 = false;
  try {
    // Create up to (cap - startCount + 1) buckets; the one that would exceed the cap must 409.
    for (let i = 0; i <= cap - startCount; i++) {
      const res = await page.request.post(BUCKETS, { data: { name: `Cap Probe ${i}`, criteria: { keywords: ['zzprobe'], useTimeline: false } } });
      if (res.status() === 409) {
        expect((await res.json()).code, 'over-cap create → BUCKET_LIMIT').toBe('BUCKET_LIMIT');
        hit409 = true;
        break;
      }
      expect(res.ok(), `create probe ${i}`).toBeTruthy();
      created.push((await res.json()).data.id as string);
    }
    expect(hit409, 'creation is refused once the tenant reaches the cap').toBeTruthy();

    // ── RANK-4: EDIT a bucket via PATCH (previously the UI had no edit path) ──
    if (created.length > 0) {
      const id = created[0];
      const pr = await page.request.patch(`${BUCKETS}/${id}`, { data: { name: 'Cap Probe Renamed' } });
      expect(pr.ok(), 'PATCH edit bucket name').toBeTruthy();
      const after = (await (await page.request.get(BUCKETS)).json()).data.buckets as Array<{ id: string; name: string }>;
      expect(after.find((b) => b.id === id)?.name, 'edit persisted').toBe('Cap Probe Renamed');
    }
  } finally {
    // Restore Foundation's bucket set exactly.
    for (const id of created) await page.request.delete(`${BUCKETS}/${id}`);
  }
  const restored = (await (await page.request.get(BUCKETS)).json()).data.buckets as unknown[];
  expect(restored.length, 'cap-probe buckets cleaned up').toBe(startCount);

  // ── RANK-3: the designee grant WRITE round-trips (tenant_admin delegates to a Contributor) ──
  r = await page.request.get('/api/portal/foundation/team');
  expect(r.ok(), 'list team').toBeTruthy();
  const members = (await r.json()).data as Array<{ id: string; role: string; canManageBuckets: boolean }>;
  const designee = members.find((m) => m.role === 'tenant_user');
  if (designee) {
    const grant = await page.request.patch(`/api/portal/foundation/team/${designee.id}`, { data: { canManageBuckets: true } });
    expect(grant.ok(), 'grant can_manage_buckets').toBeTruthy();
    expect((await grant.json()).data.canManageBuckets, 'grant returns true').toBe(true);
    const revoke = await page.request.patch(`/api/portal/foundation/team/${designee.id}`, { data: { canManageBuckets: false } });
    expect(revoke.ok(), 'revoke can_manage_buckets').toBeTruthy();
    expect((await revoke.json()).data.canManageBuckets, 'revoke returns false').toBe(false);
  }
});
