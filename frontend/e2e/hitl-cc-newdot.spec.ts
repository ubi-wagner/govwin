/**
 * Command Center "new since you last looked" dot — live proof (mig 179 command_seen_state).
 * With Kate's watermarks pre-seeded (todos/activity in the past → items are newer → dot;
 * opp/workflows in the future → nothing newer → no dot), the tenant CC must light up exactly
 * To-dos + Activity, and viewing a tab must clear its dot. Re-seed the watermarks immediately
 * before running. Run: npx playwright test --project=hitl hitl-cc-newdot
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import postgres from 'postgres';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = process.env.CC_SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/cc-shots';
const KATE = 'kate.ulepic@foundation3dp.com';

test.use({ viewport: { width: 1280, height: 900 } });

/* SEED THE WATERMARKS HERE — the whole test rests on them.
 *
 * This spec's header used to say "Re-seed the watermarks immediately before running", and no script
 * in the repo did that: the fixture lived only as rows someone had once written on a long-lived box.
 * The moment ANY workflow was created after that stale watermark, the Workflows dot lit up and this
 * test failed — reporting a product defect where the only thing wrong was the fixture. (It failed
 * exactly that way here, off a process_instance a library atomization had just created.)
 *
 * The assertion is a RELATIVE one — "a watermark in the future means nothing is newer than it" — so
 * it is only meaningful if the watermark is in the future AT TEST TIME. Stamping them here makes
 * that true by construction and makes the test say what it means: past for todos/activity (items
 * are newer → dot), future for opp/workflows (nothing can be newer → no dot).
 *
 * markCommandSeen() can only ever write now(), so the API cannot express a future watermark and
 * this has to go through the DB. Owner role: command_seen_state is keyed by user_id and carries no
 * tenant column, so there is no tenant context to set.
 */
const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;

test.beforeAll(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  expect(DB, 'DATABASE_URL_OWNER must be set to seed the watermarks').toBeTruthy();
  const sql = postgres(DB!, { max: 1 });
  try {
    const [u] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${KATE}`;
    expect(u?.id, `no user ${KATE} — run scripts/seed_dev_accounts.mjs`).toBeTruthy();
    const [t] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = 'foundation'`;
    expect(t?.id, 'no foundation tenant').toBeTruthy();
    const scope = `tenant:${t.id}`;
    const stamp = async (tab: string, offset: string) => sql`
      INSERT INTO command_seen_state (user_id, scope, tab, last_seen_at, updated_at)
      VALUES (${u.id}, ${scope}, ${tab}, now() + ${offset}::interval, now())
      ON CONFLICT (user_id, scope, tab)
      DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, updated_at = now()`;
    await stamp('todos', '-30 days');      // items exist that are newer → dot
    await stamp('activity', '-30 days');   // ditto
    await stamp('opp', '+30 days');        // nothing can be newer → no dot
    await stamp('workflows', '+30 days');  // ditto
  } finally {
    await sql.end();
  }
});

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page, `${email} bounced to /login`).not.toHaveURL(/\/login/);
}

test('new-dot lights up todos+activity (past watermark), not opp+workflows (future)', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com');
  await page.goto('/portal/foundation/command', { waitUntil: 'networkidle', timeout: 45_000 });

  // The accent dot is the only sky-500 span in the tab list.
  const dot = (name: RegExp) => page.getByRole('tab', { name }).locator('span.bg-sky-500');

  await expect(dot(/To-dos/), 'To-dos should show a new dot (past watermark)').toBeVisible();
  await expect(dot(/Activity/), 'Activity should show a new dot (past watermark)').toBeVisible();
  await expect(dot(/Opportunities/), 'Opportunities should NOT (future watermark)').toHaveCount(0);
  await expect(dot(/Workflows/), 'Workflows should NOT (future watermark)').toHaveCount(0);

  await page.screenshot({ path: `${DIR}/08-new-dots.png`, fullPage: true });

  // Viewing a tab clears its dot optimistically (and POSTs the watermark).
  await page.getByRole('tab', { name: /To-dos/ }).click();
  await expect(dot(/To-dos/), 'To-dos dot clears on view').toHaveCount(0);
});
