/**
 * Trace Paul Jackson's login from the public pages through to his landing — and confirm the
 * shadow-admin (tenant_admin) permissions: buckets, ranked pipeline, and DOWNLOAD all work
 * on a NORMAL login (no /api/enter shortcut). Screenshots + redirect chain logged.
 */
import { test, expect } from '@playwright/test';

const SHOTS = '/home/user/govwin/docs/proposals/foundation-tvsf/ui-walkthrough';
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const PID = process.env.PROPOSAL_ID || 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';

test('trace Paul login (public → login → shadow-admin landing)', async ({ page }) => {
  test.setTimeout(90_000);
  const nav: string[] = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) nav.push(f.url().replace('http://localhost:3000', '')); });

  await page.context().clearCookies();
  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/paul_login_00_public.png`, fullPage: true });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'pjackson@ecinnovates.com');
  await page.fill('input[name="password"]', PW);
  await Promise.all([
    page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('\n▶ REDIRECT CHAIN:', JSON.stringify(nav));
  console.log('▶ FINAL URL:', page.url().replace('http://localhost:3000', ''));
  await page.screenshot({ path: `${SHOTS}/paul_login_01_landing.png`, fullPage: true });

  // session role after login
  const sess = await (await page.request.get('/api/auth/session')).json();
  console.log('▶ SESSION:', JSON.stringify({ email: sess?.user?.email, role: sess?.user?.role, tenantSlug: sess?.user?.tenantSlug, pinned: sess?.user?.membershipPinned }));

  // shadow-admin permissions on a NORMAL login
  const b = await page.request.get('/api/portal/foundation/buckets');
  const c = await page.request.get('/api/portal/foundation/cards');
  const dl = await page.request.post(`/api/portal/foundation/proposals/${PID}/package?format=docx`);
  console.log('▶ PERMISSIONS: buckets', b.status(), '· cards', c.status(), '· download', dl.status());

  expect(page.url()).not.toContain('/login'); // did NOT bounce back
  expect(b.status(), 'buckets').toBe(200);
  expect(c.status(), 'cards').toBe(200);
  expect(dl.status(), 'download').toBe(200);
  console.log('✓ Paul lands clean + buckets/pipeline/download all authorized');
});
