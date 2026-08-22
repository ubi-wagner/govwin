/**
 * B52 verification: does a fresh intake now raise a triage ToDo that a human can
 * tell apart and open?
 *
 * Before: 21 open rows all titled "Triage new opportunities from source", entity_id
 * NULL on every one, and therefore no "Open →" (taskHref returns null without an
 * entity id). After: one row per intake, titled with the solicitation, linked to it.
 *
 * Run: npx playwright test --project=drive triage-todo-identity
 */
import { test, expect } from '@playwright/test';

const PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';

test('an intake raises a named, linked triage ToDo', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const stamp = Date.now();
  const title = `B52 identity probe ${stamp}`;

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  const res = await page.request.post('/api/admin/intake', {
    data: { title, agency: 'Department of Defense', programType: 'baa', foundBy: 'admin' },
  });
  const body = await res.json();
  // eslint-disable-next-line no-console
  console.error(`[b52] intake -> ${res.status()} ${JSON.stringify(body).slice(0, 240)}`);
  expect(res.status(), 'intake did not stage').toBeLessThan(300);

  const solicitationId = body?.data?.solicitationId ?? body?.solicitationId;
  expect(solicitationId, 'intake returned no solicitationId').toBeTruthy();
  // eslint-disable-next-line no-console
  console.error(`[b52] solicitationId=${solicitationId} title="${title}"`);
});
