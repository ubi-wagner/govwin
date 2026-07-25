/**
 * Focused capture of the NEW library surfaces for the Customer-Admin manual:
 * the /atoms library (starter catalog + Create Canvas + faceted browse + downloads)
 * and the Create-Canvas modal (Blank / Start-from-a-template). Signs in as the seeded
 * Immobileyes admin. Shots → docs/manuals/img/shots/tenant/ · crops → .../crops/tenant/
 *   DATABASE_URL=... node scripts/capture-library.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/govwin';
const SH = path.join(ROOT, 'docs/manuals/img/shots/tenant');
const CR = path.join(ROOT, 'docs/manuals/img/crops/tenant');
fs.mkdirSync(SH, { recursive: true }); fs.mkdirSync(CR, { recursive: true });
const USER = { email: 'eric@immobileyes.com', pw: 'Sandbox2026!' };
const SLUG = 'immobileyes';
const ok = (m) => console.log('  ✓', m);
const warn = (m) => console.log('  ·', m);
async function settle(p, ms = 1400) { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); }
async function full(p, n) { try { await p.screenshot({ path: path.join(SH, n + '.png'), fullPage: true }); ok('shot ' + n); } catch { warn('shot FAIL ' + n); } }
async function el(p, n, sel) { try { const l = p.locator(sel).first(); if (await l.count() === 0) { warn('absent ' + n); return; } await l.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(250); await l.screenshot({ path: path.join(CR, n + '.png') }); ok('el ' + n); } catch { warn('el FAIL ' + n); } }

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('#email', USER.email);
  await p.fill('#password', USER.pw);
  await p.click('button[type="submit"]');
  // Server-action login: wait for the client redirect off /login (generous), then settle.
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  console.log('login →', p.url());
  if (p.url().includes('/login')) { console.error('LOGIN FAILED'); }

  // 1) the library page (starter affordance + Create Canvas + faceted browse)
  await p.goto(`${BASE}/portal/${SLUG}/atoms`, { waitUntil: 'networkidle' });
  await settle(p, 1800);
  await full(p, 'library-atoms');
  await el(p, 'library-starter-affordance', 'text=/Add starter set/i');
  await el(p, 'library-browse', 'text=/Browse library/i');

  // 2) Create-Canvas modal — Blank tab, then the Template catalog tab
  try {
    await p.click('text=/Create canvas/i');
    await p.waitForTimeout(700);
    await el(p, 'create-canvas-blank', 'div.max-w-md');
    await p.click('text=/Start from a template/i').catch(() => {});
    await p.waitForTimeout(900);
    await el(p, 'create-canvas-templates', 'div.max-w-md');
    await p.keyboard.press('Escape').catch(() => {});
    ok('create-canvas modal');
  } catch { warn('create-canvas modal FAIL'); }

  await b.close();
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
