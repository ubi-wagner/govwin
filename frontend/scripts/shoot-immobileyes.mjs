/**
 * Reusable login + screenshot driver for the Immobileyes CUAS build.
 * Logs in as the Immobileyes tenant_admin and captures the routes passed as argv
 * (name=route pairs) OR a built-in STAGE set. Full-page PNGs → docs/proposals/immobileyes-cuas/img/.
 *   node scripts/shoot-immobileyes.mjs stage=<baseline|atoms|build|export> [name=/portal/...]
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.IMMO_EMAIL || 'admin@immobileyes.test';
const PW = process.env.IMMO_PW || 'DemoPass123!';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(process.cwd(), '..', 'docs', 'proposals', 'immobileyes-cuas', 'img');
fs.mkdirSync(OUT, { recursive: true });

const T = '/portal/immobileyes';
const STAGES = {
  baseline: [['01-cards', `${T}/cards`], ['02-atoms-empty', `${T}/atoms`], ['03-proposals-empty', `${T}/proposals`]],
  atoms: [['10-atoms-populated', `${T}/atoms`]],
  build: [['20-proposals', `${T}/proposals`]],
};

const args = process.argv.slice(2);
const kv = Object.fromEntries(args.map((a) => a.split('=').map((s, i) => (i === 0 ? s : a.slice(a.indexOf('=') + 1)))).map(([k, ...r]) => [k, r.join('=')]));
let routes = [];
if (kv.stage && STAGES[kv.stage]) routes = STAGES[kv.stage];
for (const a of args) if (a.includes('=') && !['stage', 'name'].includes(a.split('=')[0])) routes.push([a.split('=')[0], a.slice(a.indexOf('=') + 1)]);
if (kv.name) routes.push([`shot-${Date.now()}`, kv.name]);

const b = await chromium.launch({ executablePath: EXE });
const ctx = await b.newContext({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', EMAIL);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1500);
  console.log(`login → ${p.url()}`);
  for (const [name, route] of routes) {
    const res = await p.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);
    await p.waitForTimeout(2000);
    const h1 = await p.locator('h1,h2').first().textContent({ timeout: 3000 }).catch(() => '');
    await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log(`  ${name}: HTTP ${res?.status() ?? 'nav'} url=${p.url().replace(BASE, '')} h1="${(h1 || '').trim().slice(0, 48)}"`);
  }
} catch (e) { console.error('ERR', e); process.exitCode = 1; } finally { await b.close(); }
