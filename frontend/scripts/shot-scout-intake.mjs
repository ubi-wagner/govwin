/** Screenshot the scout-intake candidate review→release queue + drive a real release via the UI.
 *  DATABASE_URL=… node scripts/shot-scout-intake.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = process.env.PW_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/govwin/docs/assets/scout';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = { email: 'eric@rfppipeline.com', pw: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!') };
const shot = async (p, name) => { await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); console.log('  ✓ shot', name); };
const settle = async (p, ms = 1600) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1900 } });
const p = await ctx.newPage();
try {
  // ── Login ──
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', ADMIN.email);
  await p.fill('#password', ADMIN.pw);
  await p.click('button[type="submit"]'); await settle(p, 2800);
  console.log('  logged in →', p.url());

  // ── 1. The candidate review→release queue (3 pending: 1 NEW, 2 UPDATE) ──
  await p.goto(`${BASE}/admin/scouts`); await settle(p, 2200);
  await shot(p, '01-candidate-queue');

  // ── 2. Release the NEW (Cislunar) candidate via the UI → intake ──
  const card = p.locator('div.border.border-gray-200.rounded-lg.p-4', { hasText: 'Cislunar Autonomous Refueling' }).first();
  if (await card.count()) {
    await card.getByRole('button', { name: 'Release as new' }).click();
    await p.waitForTimeout(600);
    await shot(p, '02-release-new-editor');
    await card.getByRole('button', { name: 'Stage into intake' }).click();
    await settle(p, 2200);
    await shot(p, '03-after-release');
  } else { console.log('  · Cislunar card not found (already released?)'); }

  // ── 3. It landed in the RFP Triage Queue ──
  await p.goto(`${BASE}/admin/rfp-curation`); await settle(p, 2200);
  await shot(p, '04-in-curation');

  console.log('DONE');
} catch (e) {
  console.error('SHOT ERROR', e.message);
  await p.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
} finally {
  await browser.close();
}
