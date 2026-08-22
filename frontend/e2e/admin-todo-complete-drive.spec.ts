/**
 * Can an rfp_admin actually COMPLETE a platform-scope ToDo?
 *
 * The question came out of the walk: 34 open admin ToDos and exactly one completed, ever. The
 * `tasks` RLS UPDATE policy is `tenant_id = app.tenant_id` with no `OR tenant_id IS NULL`, and
 * completeTask() runs that UPDATE on the context-aware `sql` as govtech_app — so a platform row
 * (tenant_id NULL) should match zero rows and come back 409 "Task is already closed".
 *
 * Reasoning about RLS is how you get this wrong. Click the button.
 *
 * Run: npx playwright test --project=drive admin-todo-complete
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const DIR = process.env.WALK_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/actor-walk';
const PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';

test('rfp_admin clicks Approve / Done on a platform ToDo', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  fs.mkdirSync(DIR, { recursive: true });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  // Capture what the server actually answers, not what the toast says.
  const answers: { status: number; body: string }[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/admin/tasks') && r.request().method() === 'POST') {
      answers.push({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 300) });
    }
  });

  await page.goto('/admin/dashboard', { waitUntil: 'networkidle', timeout: 45_000 });
  const before = await page.getByRole('button', { name: /Approve \/ Done/ }).count();
  expect(before, 'no completable admin ToDo on the dashboard to test with').toBeGreaterThan(0);

  await page.getByRole('button', { name: /Approve \/ Done/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/rfpadmin--todo-complete-result.png`, fullPage: false });

  // eslint-disable-next-line no-console
  console.error('[todo-complete] server answers:', JSON.stringify(answers));
  const after = await page.getByRole('button', { name: /Approve \/ Done/ }).count();
  // eslint-disable-next-line no-console
  console.error(`[todo-complete] Approve/Done buttons before=${before} after=${after}`);

  expect(answers.length, 'the button never called /api/admin/tasks').toBeGreaterThan(0);
  expect(answers[0].status, `POST /api/admin/tasks answered ${answers[0].status}: ${answers[0].body}`).toBe(200);
});
