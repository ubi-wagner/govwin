/**
 * #190 F1 — capture the new automation surfaces as manual screenshots.
 * Run from frontend/: node e2e/automation-190-shots.mts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/shots-190';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

async function login(page: any, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ]).catch(() => {});
  await page.waitForTimeout(1500);
}

const shots: string[] = [];
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
try {
  // ── Tenant admin: the Automation grammar editor ──
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const t = await ctxT.newPage();
  await login(t, 'admin@acme-navy.test', 'DrivePass123!');
  await t.goto(`${BASE}/portal/acme-navy-systems/automation`, { waitUntil: 'networkidle' });
  await t.waitForTimeout(2000);
  await t.screenshot({ path: `${OUT}/01-tenant-automation-grammar.png`, fullPage: true });
  shots.push('01-tenant-automation-grammar.png');
  await ctxT.close();

  // ── Master admin: the framework control plane ──
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const a = await ctxA.newPage();
  await login(a, 'eric@rfppipeline.com', 'DrivePass123!');
  await a.goto(`${BASE}/admin/automation-framework`, { waitUntil: 'networkidle' });
  await a.waitForTimeout(2000);
  await a.screenshot({ path: `${OUT}/02-rfp-framework-control-plane.png`, fullPage: true });
  shots.push('02-rfp-framework-control-plane.png');
  await ctxA.close();

  console.log('SHOTS_OK ' + shots.join(', '));
} catch (e) {
  console.error('SHOT_ERROR', e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}
