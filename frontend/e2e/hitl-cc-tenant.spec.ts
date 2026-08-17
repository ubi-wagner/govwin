/**
 * Command Center — tenant live drive (verification, not a committed guide).
 * Logs in as Foundation's tenant_admin (Kate) and walks the 4 tabs of
 * /portal/foundation/command, asserting each renders (no /login bounce, no 500,
 * no error boundary) and screenshotting it. Run: npx playwright test --project=hitl hitl-cc-tenant
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const DIR = process.env.CC_SHOT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/cc-shots';

test.use({ viewport: { width: 1280, height: 1400 } });
test.beforeAll(() => { fs.mkdirSync(DIR, { recursive: true }); });

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

async function assertRendered(page: Page, name: string) {
  expect(new URL(page.url()).pathname, `${name} bounced to /login`).not.toMatch(/^\/login/);
  const body = (await page.textContent('body').catch(() => '')) || '';
  expect(body, `${name} shows an error boundary`).not.toMatch(/Application error|Internal Server Error|something went wrong/i);
}

test('tenant Command Center — 4 tabs render for Foundation admin', async ({ page }) => {
  await login(page, 'kate.ulepic@foundation3dp.com');

  // Land on the Command Center.
  await page.goto('/portal/foundation/command', { waitUntil: 'networkidle', timeout: 45_000 });
  await assertRendered(page, 'command');
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();

  // The 4 tabs are present.
  for (const t of ['Opportunities', 'To-dos', 'Workflows', 'Activity']) {
    await expect(page.getByRole('tab', { name: new RegExp(t) }), `${t} tab missing`).toBeVisible();
  }

  // Opportunities (default) — give PipelineCards a moment to self-load.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/01-opportunities.png`, fullPage: true });

  // To-dos.
  await page.getByRole('tab', { name: /To-dos/ }).click();
  await page.waitForTimeout(1200);
  await assertRendered(page, 'todos-tab');
  await page.screenshot({ path: `${DIR}/02-todos.png`, fullPage: true });

  // To-dos — open the compose affordance (admin-only) to prove it's wired.
  const compose = page.getByRole('button', { name: /New to-do \/ broadcast/ });
  if (await compose.isVisible().catch(() => false)) {
    await compose.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/03-todos-compose.png`, fullPage: true });
  }

  // Workflows — the process ledger.
  await page.getByRole('tab', { name: /Workflows/ }).click();
  await page.waitForTimeout(1200);
  await assertRendered(page, 'workflows-tab');
  await page.screenshot({ path: `${DIR}/04-workflows.png`, fullPage: true });

  // Activity — recent events feed.
  await page.getByRole('tab', { name: /Activity/ }).click();
  await page.waitForTimeout(1000);
  await assertRendered(page, 'activity-tab');
  await page.screenshot({ path: `${DIR}/05-activity.png`, fullPage: true });
});

test('tenant_user does NOT get the Command Center (redirected to dashboard)', async ({ page }) => {
  await login(page, 'connor.casey@foundation3dp.com');
  await page.goto('/portal/foundation/command', { waitUntil: 'networkidle', timeout: 45_000 });
  // Gate sends a base member to the cockpit.
  await expect(page, 'tenant_user was NOT redirected off /command').toHaveURL(/\/portal\/foundation\/(dashboard|proposals)/);
});
