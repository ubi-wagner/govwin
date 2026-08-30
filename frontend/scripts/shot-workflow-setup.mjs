// Browser drive of the tenant Workflow Setup page (TW-6): log in as a tenant_admin, open the required
// setup for a launched _setup:pending portal (recommender-prefilled), screenshot it, click Accept & Start.
import { chromium } from 'playwright';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const SLUG = process.env.SLUG || 'foundation';
const PORTAL = process.env.PORTAL || '72e4c91b-ca21-49c7-adc5-3c21c69c344c';
const OUT = process.env.OUT || '.';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [browser console.error]', m.text()); });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await page.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log('logged in ->', page.url());

  await page.goto(`${BASE}/portal/${SLUG}/portals/${PORTAL}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Workflow setup', { timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/setup-before.png`, fullPage: true });
  console.log('screenshot: setup-before.png');

  const stages = await page.getByText(/^STAGE \d/).count();
  const acceptBtn = page.getByRole('button', { name: /Accept & Start/i });
  console.log(`surfaces: stages=${stages} acceptBtn=${await acceptBtn.count()} disabled=${await acceptBtn.isDisabled().catch(() => 'n/a')}`);

  await acceptBtn.click();
  await page.waitForSelector('button:has-text("Save")', { timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/setup-after.png`, fullPage: true });
  console.log('screenshot: setup-after.png  (ACCEPTED → Save mode)');
  console.log('BROWSER DRIVE OK');
} catch (e) {
  console.error('BROWSER DRIVE FAILED', e?.message || e);
  await page.screenshot({ path: `${OUT}/setup-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally { await browser.close(); }
