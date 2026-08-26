// Browser drive of the provisioning cockpit (PV-6): log in as rfp_admin, open the cockpit for a
// curation_pending portal, screenshot it (readiness bar + SLA + overlay picker), click "Complete &
// Release", and screenshot the released state. Proves the PAGE renders + the admin ROUTE works over HTTP.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const PORTAL = process.env.PORTAL || 'c55c409b-8302-4c2f-8588-da706834cf10';
const OUT = process.env.OUT || '.';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [browser console.error]', m.text()); });

try {
  // Log in as rfp_admin.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'eric@rfppipeline.com');
  await page.fill('input[name="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log('logged in ->', page.url());

  // Open the cockpit.
  await page.goto(`${BASE}/admin/provisioning/${PORTAL}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Master build-out readiness', { timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/cockpit-before.png`, fullPage: true });
  console.log('screenshot: cockpit-before.png');

  // Verify the key surfaces rendered.
  const hasReadiness = await page.getByText('Master build-out readiness').count();
  const hasSla = await page.getByText('72h SLA').count();
  const hasBtn = await page.getByRole('button', { name: /Complete & Release/i }).count();
  console.log(`surfaces: readiness=${hasReadiness} sla=${hasSla} releaseBtn=${hasBtn}`);

  // Click Complete & Release and wait for the released state (router.refresh re-renders the page).
  await page.getByRole('button', { name: /Complete & Release/i }).click();
  await page.waitForSelector('text=This workspace has been released', { timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/cockpit-after.png`, fullPage: true });
  console.log('screenshot: cockpit-after.png  (RELEASED)');

  console.log('BROWSER DRIVE OK');
} catch (e) {
  console.error('BROWSER DRIVE FAILED', e?.message || e);
  await page.screenshot({ path: `${OUT}/cockpit-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
