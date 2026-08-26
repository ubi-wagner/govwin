import { test, expect } from '@playwright/test';
const PW = process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';
const DIR = process.env.WALK_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/actor-walk3';
test('photograph the new triage ToDo', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }), page.click('button[type="submit"]')]);
  await page.goto('/admin/dashboard', { waitUntil: 'networkidle', timeout: 45_000 });
  const title = page.getByText(/Triage new opportunity: B52 identity probe/).first();
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.scrollIntoViewIfNeeded();
  const box = await title.boundingBox();
  if (!box) throw new Error('no bounding box for the new ToDo title');
  // Photograph the whole card: the title plus the action row beneath it, which is
  // where the "Open →" deep link appears once the ToDo carries an entity id.
  await page.screenshot({
    path: `${DIR}/b52-new-todo.png`,
    clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 14), width: 1000, height: 110 },
  });
});
