/**
 * B50 + B53 — two instruments that lied, checked by looking at them.
 *
 * B50: `/portal/[tenantSlug]/contracts` was a bare Next 404. The contract entity and its kickoff
 *      workflow shipped; the navigation did not, so the record of an AWARD — the best outcome the
 *      product has — was reachable only through one ToDo's deep-link. This asserts the index page
 *      renders, in both the empty and the populated state, and that the rail links to it.
 *
 *      What this does NOT check is that winning a bid creates the contract row; V1-10 covers that,
 *      and the populated case below uses a fixture so the table's own rendering is exercised.
 *      B50 is about REACHABILITY, and reachability is what is asserted.
 *
 * B53: `/admin/scouts` showed ACTIVE SOURCES 6 · HEALTHY 0 · DEGRADED 0 beside four completed
 *      runs, because `source_health` has no runtime writer and never had one. The fix derives
 *      status from what a scout pass actually writes. The check here is deliberately negative as
 *      well as positive: the two tiles that could only ever read zero must be GONE, not merely
 *      showing a different zero.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADMIN_PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';
const TENANT_EMAIL = 'kate.ulepic@foundation3dp.com';
const TENANT_PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const SLUG = 'foundation';
const OWNER_DB = process.env.DATABASE_URL_OWNER
  || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const SHOTS = path.join(process.cwd(), 'e2e-artifacts', 'b50-b53');

function q(sqlText: string): string[] {
  const flat = sqlText.replace(/\s+/g, ' ').trim();
  const out = execSync(`psql ${JSON.stringify(OWNER_DB)} -tAc ${JSON.stringify(flat)}`, {
    encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'changeme' },
  });
  return out.trim().split('\n').filter(Boolean);
}

async function signIn(page: Page, email: string, pw: string) {
  await page.context().clearCookies();
  await page.goto('about:blank');
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="password"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

const shot = async (page: Page, name: string) => {
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  } catch { /* a missing screenshot must not fail the assertion it illustrates */ }
};

test('B50 · a tenant can reach their contracts from the rail', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, TENANT_EMAIL, TENANT_PW);

  // ── Empty state. 0 contracts is the honest current state, and it must be a PAGE, not a 404. ──
  const before = Number(q(`SELECT count(*)::int FROM contracts c JOIN tenants t ON t.id=c.tenant_id
                           WHERE t.slug='${SLUG}'`)[0]);
  const resp = await page.goto(`/portal/${SLUG}/contracts`, { waitUntil: 'networkidle', timeout: 60_000 });
  expect(resp?.status(), 'the contracts index responds').toBeLessThan(400);
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible();
  if (before === 0) {
    await expect(page.getByText('No contracts yet')).toBeVisible();
  }
  await shot(page, 'contracts-empty');

  // The rail link is the actual fix — the page existing but unlinked is the same bug.
  await expect(
    page.locator('nav').getByRole('link', { name: 'Contracts' }),
    'the rail links to contracts',
  ).toHaveCount(1);

  // ── Populated state. A fixture row, so the table renders against real columns (bigint cents
  //    arrives as a STRING from postgres.js — a naive render would print it unformatted).
  const [tenantId] = q(`SELECT id FROM tenants WHERE slug='${SLUG}'`);
  // contracts.opportunity_id FKs to `opportunities`, NOT to the curated master — the mirror card's
  // opportunity, which is what an award is actually against.
  const [oppId] = q(`SELECT id FROM opportunities LIMIT 1`);
  expect(oppId, 'an opportunity exists to hang the fixture contract off').toBeTruthy();
  const [contractId] = q(`
    INSERT INTO contracts (tenant_id, opportunity_id, title, status, award_date,
                           award_amount_cents, pop_start, pop_end)
    VALUES ('${tenantId}'::uuid, '${oppId}'::uuid, 'B50 fixture — Ohio TVSF Round 45', 'active',
            now(), 27450000, current_date, current_date + 365)
    RETURNING id`);
  try {
    await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
    const row = page.getByRole('link', { name: /B50 fixture/ });
    await expect(row, 'the contract is listed').toHaveCount(1);
    // $274,500.00 from 27_450_000 cents — proves the bigint-as-string path is handled.
    await expect(page.getByText('$274,500')).toBeVisible();
    await shot(page, 'contracts-list');

    // And the row leads to the detail page it was always supposed to lead to.
    await row.click();
    await page.waitForURL(new RegExp(`/contracts/${contractId}`), { timeout: 30_000 });
    await expect(page.getByText(/B50 fixture/).first()).toBeVisible();
    await shot(page, 'contract-detail');
  } finally {
    q(`DELETE FROM contracts WHERE id='${contractId}'::uuid`);
  }
});

test('B53 · the scout monitor reports what a scout actually wrote', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'eric@rfppipeline.com', ADMIN_PW);
  const resp = await page.goto('/admin/scouts', { waitUntil: 'networkidle', timeout: 60_000 });
  expect(resp?.status()).toBeLessThan(400);
  await expect(page.getByRole('heading', { name: 'Scout Monitor' })).toBeVisible();
  await shot(page, 'scout-monitor');

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  // NEGATIVE: the two tiles bound to the write-less table are gone. A zero that can only ever be
  // zero is worse than no tile — it reads as a measurement.
  expect(body, 'the always-zero HEALTHY tile is gone').not.toMatch(/\bHEALTHY\b/i);
  expect(body, 'the always-zero DEGRADED / ERROR tile is gone').not.toMatch(/Degraded \/ error/i);

  // POSITIVE: the replacements are present, and the pool table reports per-source status.
  // Compare case-insensitively — the tile labels are uppercased in CSS, and innerText returns the
  // RENDERED casing, so a literal match here fails on styling rather than on substance.
  const flat = body.toLowerCase();
  for (const label of ['Active sources', 'Auto-crawled', 'Needs a look', 'Sources watched']) {
    expect(flat, `"${label}" is on the page`).toContain(label.toLowerCase());
  }

  // Every configured source appears with a status that is one of the derived vocabulary — never
  // the old 'unknown', which was what "no row in a table nobody writes" rendered as.
  const names = q(`SELECT name FROM source_profiles ORDER BY name`);
  expect(names.length, 'sources are configured in this sandbox').toBeGreaterThan(0);
  for (const n of names) expect(body, `${n} is listed`).toContain(n);
  expect(body, "no source reads 'unknown'").not.toMatch(/\bunknown\b/);
  expect(body).toMatch(/watched|overdue|never crawled|manual|paused/);
});
