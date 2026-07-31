/**
 * Live drive of this session's automation-UI surfaces (both roles). Proves they RENDER with
 * real data, not just that they compile. Run from frontend/: node e2e/automation-ui-shots.mts
 * (app must be serving on :3000 — node .next/standalone/server.js).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/shots-ui';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]).catch(() => {});
  await page.waitForTimeout(1500);
}

// A page "renders" if it 200s and shows a headline (not an error boundary / empty shell).
async function grab(page: any, url: string, file: string, expectText: string[]) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  const body = (await page.textContent('body')) ?? '';
  const found = expectText.filter((t) => body.includes(t));
  const ok = found.length > 0 && !/Application error|Unhandled Runtime|500|something went wrong/i.test(body);
  console.log(`${ok ? 'OK  ' : 'MISS'} ${file} — matched [${found.join(', ')}]`);
  return ok;
}

const results: Record<string, boolean> = {};
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
try {
  // ── Tenant admin: the "Your automation" overview ──
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const t = await ctxT.newPage();
  await login(t, 'admin@acme-navy.test', 'DrivePass123!');
  results['tenant-overview'] = await grab(t, `${BASE}/portal/acme-navy-systems/automation`, '01-tenant-overview.png',
    ['Your automation', 'Team ToDos', 'Automation', 'coverage', 'Discovery']);
  results['tenant-portals'] = await grab(t, `${BASE}/portal/acme-navy-systems/portals`, '02-tenant-portals.png', ['proposal', 'build', 'Portal', 'portals']);
  await ctxT.close();

  // ── RFP admin: Automation Health + firings, and the framework page (nav) ──
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const a = await ctxA.newPage();
  await login(a, 'eric@rfppipeline.com', 'DrivePass123!');
  results['admin-health'] = await grab(a, `${BASE}/admin/automation`, '03-admin-health.png',
    ['Automation health', 'Agent spend', 'Recent firings', 'Automation Rules']);
  results['admin-framework'] = await grab(a, `${BASE}/admin/automation-framework`, '04-admin-framework.png', ['Curation SLA', 'framework', 'Automation Framework', 'ceiling']);
  await ctxA.close();

  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k);
  console.log(`\nDRIVE_RESULT ${failed.length === 0 ? 'ALL_OK' : 'FAILED:' + failed.join(',')}`);
} catch (e) {
  console.error('DRIVE_ERROR', e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}
