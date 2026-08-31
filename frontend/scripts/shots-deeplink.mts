/**
 * Screenshot capture for the deep-link identity states (manual: getting-started.md
 * "Following a notification link"). Reuses the verified fixtures. Non-asserting — it
 * just drives each state and snaps it. Cleans up its seeded task.
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const PW = 'DemoPass123!';
const EXPERT = 'expert@beacon-labs.test';
const OUT = '/home/user/govwin/docs/user-guides/img';
mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL!, { max: 2 });

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log(`📸 ${name}.png  (${page.url()})`);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 })).newPage();
let taskId = '';
try {
  const [ex] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email=${EXPERT}`;
  const [beacon] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug='beacon-labs'`;
  const [t] = await sql<{ id: string }[]>`
    INSERT INTO tasks (tenant_id, assignee_user_id, assignee_role, task_type, title, status, completed_at)
    VALUES (${beacon.id}::uuid, ${ex.id}::uuid, 'tenant_admin', 'review', 'Notification link fixture', 'completed', now())
    RETURNING id`;
  taskId = t.id;

  // 1. SWITCH gate — pinned to Acme, link points at Beacon.
  await login(page, EXPERT);
  await page.locator('form:has-text("Acme") button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000);
  await page.goto(`${BASE}/go?tenant=beacon-labs`, { waitUntil: 'networkidle' });
  await shot(page, 'deeplink-switch');

  // 2. Login "signed out of X, into Y" notice (take the switch).
  await page.locator('button:has-text("Sign in to Beacon Labs")').click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
  await shot(page, 'deeplink-login-notice');

  // 3. HERE ack — now signed into Beacon; a link to Beacon just confirms.
  await page.fill('input[name="email"]', EXPERT);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1400);
  await page.goto(`${BASE}/go?tenant=beacon-labs`, { waitUntil: 'networkidle' });
  await shot(page, 'deeplink-here');

  // 4. Dead-link ack — completed task.
  await page.goto(`${BASE}/go?task=${taskId}`, { waitUntil: 'networkidle' });
  await shot(page, 'deeplink-donetask');

  console.log('deep-link screenshots captured.');
} catch (e) {
  console.error('SHOT ERROR', e);
  process.exitCode = 1;
} finally {
  if (taskId) { try { await sql`DELETE FROM tasks WHERE id=${taskId}::uuid`; } catch { /* ignore */ } }
  await browser.close();
  await sql.end();
}
