/**
 * Comprehensive CUSTOMER-PORTAL screenshot capture for the Customer-Admin manual.
 * Full pages → docs/manuals/img/shots/tenant/  ·  crops → docs/manuals/img/crops/tenant/
 * Best-effort per target. Signs in as the seeded Immobileyes admin.
 *   DATABASE_URL=... node scripts/capture-tenant.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/govwin';
const SH = path.join(ROOT, 'docs/manuals/img/shots/tenant');
const CR = path.join(ROOT, 'docs/manuals/img/crops/tenant');
fs.mkdirSync(SH, { recursive: true });
fs.mkdirSync(CR, { recursive: true });

const USER = { email: 'eric@immobileyes.com', pw: 'Immobileyes2026!' };
const SLUG = 'immobileyes';
const PID = '62960c36-80ff-40ee-8879-9a72f42bb8eb';
const SID_REL = '9bc29bb7-3a23-4620-b945-f6f1249e2b32';   // Related Work (unlocked, draftable)
const SID_COST = '4962dd0e-fb30-4945-8da3-b6422d962c2b';  // Phase I Base Cost Proposal
const OPP = 'f1c36639-a1d0-4380-be57-37413e0cb8b4';

const ok = (m) => console.log('  ✓', m);
const warn = (m) => console.log('  ·', m);
async function settle(p, ms = 1400) { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); }
async function full(p, name) { try { await p.screenshot({ path: path.join(SH, name + '.png'), fullPage: true }); ok('shot ' + name); } catch (e) { warn('shot FAIL ' + name); } }
async function clip(p, name, box) { try { await p.screenshot({ path: path.join(CR, name + '.png'), clip: box }); ok('crop ' + name); } catch (e) { warn('crop FAIL ' + name); } }
async function el(p, name, locator) {
  try { const loc = typeof locator === 'string' ? p.locator(locator).first() : locator.first();
    if (await loc.count() === 0) { warn('el absent ' + name); return false; }
    await loc.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(250);
    await loc.screenshot({ path: path.join(CR, name + '.png') }); ok('el ' + name); return true;
  } catch (e) { warn('el FAIL ' + name); return false; }
}
const HEADER = { x: 256, y: 0, width: 1184, height: 340 };
const BAND = (y, h) => ({ x: 256, y, width: 1184, height: h });

async function login(p) {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', USER.email);
  await p.fill('input[name="password"]', USER.pw);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1600);
  console.log('login →', p.url());
}

const b = await chromium.launch({ executablePath: EXE });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

try {
  await login(p);
  await p.goto(`${BASE}/portal/${SLUG}/dashboard`, { waitUntil: 'networkidle' });
  await settle(p);
  await el(p, 'nav-sidebar', 'aside');

  const R = (s) => `/portal/${SLUG}${s}`;
  const routes = [
    ['dashboard', R('/dashboard'), async () => {
      await clip(p, 'dash-header', HEADER);
      await el(p, 'dash-todos', p.getByText(/To-?Dos/i).first().locator('xpath=ancestor::*[self::section or self::div][1]'));
    }],
    ['cards', R('/cards'), async () => {
      await clip(p, 'cards-header', HEADER);
      await el(p, 'card-first', p.locator('article, .rounded-lg, li').filter({ hasText: /Build|Pin|Phase|SBIR|Navy|C-UAS|DON/i }).first());
      await el(p, 'card-actions', p.getByRole('button', { name: /Pin|Build|Purchase/i }).first());
    }],
    ['card-detail', R(`/cards/${OPP}`), async () => { await clip(p, 'card-detail-header', HEADER); await clip(p, 'card-detail-body', BAND(80, 640)); }],
    ['buckets', R('/buckets'), async () => {
      await clip(p, 'buckets-header', HEADER);
      await el(p, 'bucket-first', p.locator('article, .rounded-lg, li').first());
      await el(p, 'bucket-add', p.getByRole('button', { name: /Add|New bucket|Create/i }).first());
    }],
    ['atoms', R('/atoms'), async () => {
      await clip(p, 'atoms-header', HEADER);
      await el(p, 'atom-upload', p.getByRole('button', { name: /Upload|Add|package/i }).first());
      await el(p, 'atom-filters', p.getByText(/volume|kind|agency|filter|taxonomy/i).first().locator('xpath=ancestor::*[self::div][1]'));
      await el(p, 'atom-first', p.locator('input[type="checkbox"]').first().locator('xpath=ancestor::*[self::div or self::li or self::tr][1]'));
      // select a few atoms to reveal the compose/group bar
      const boxes = p.locator('input[type="checkbox"]:not([disabled])');
      const n = await boxes.count();
      for (const i of [0, 1, 2]) { if (i < n) await boxes.nth(i).check().catch(() => {}); }
      await p.waitForTimeout(500);
      await el(p, 'atom-compose-bar', p.getByText(/selected|Compose|Group into/i).first().locator('xpath=ancestor::*[self::div][1]'));
      await clip(p, 'atoms-selected', BAND(80, 520));
    }],
    ['proposals', R('/proposals'), async () => { await clip(p, 'proposals-header', HEADER); await el(p, 'proposal-row', p.locator('a[href*="/proposals/"]').first()); }],
    ['matrix', R(`/proposals/${PID}`), async () => {
      await clip(p, 'matrix-header', HEADER);
      await el(p, 'matrix-volume', p.getByText(/Volume|Vol |Technical|Cost/i).first().locator('xpath=ancestor::*[self::section or self::div][1]'));
      await el(p, 'matrix-row', p.getByText(/satisfied|locked|pending|pages|\/10/i).first().locator('xpath=ancestor::*[self::tr or self::div or self::li][1]'));
      await el(p, 'matrix-export', p.getByRole('button', { name: /Download|Export|\.docx|\.xlsx/i }).first());
    }],
    ['canvas', R(`/proposals/${PID}/sections/${SID_REL}`), async () => {
      await settle(p, 2200);
      await clip(p, 'canvas-header', HEADER);
      await el(p, 'canvas-toolbar', p.getByRole('button', { name: /Draft|From Library|Add|Lock/i }).first().locator('xpath=ancestor::*[self::div][1]'));
      // open the "+ From Library" panel
      const fromLib = p.getByRole('button', { name: /From Library/i });
      if (await fromLib.count()) { await fromLib.first().click().catch(() => {}); await p.waitForTimeout(1400); await clip(p, 'canvas-library-panel', BAND(80, 700)); }
      await el(p, 'canvas-node', p.locator('[draggable="true"]').first());
      await el(p, 'canvas-lock', p.getByRole('button', { name: /Accept.*Lock|Complete.*Lock|Lock/i }).first());
    }],
    ['canvas-cost', R(`/proposals/${PID}/sections/${SID_COST}`), async () => { await settle(p, 2000); await clip(p, 'canvas-cost-body', BAND(80, 720)); }],
    ['documents', R('/documents'), async () => { await clip(p, 'documents-header', HEADER); await el(p, 'doc-new', p.getByRole('button', { name: /New Document|Create/i }).first()); }],
    ['documents-new', R('/documents/new'), async () => { await clip(p, 'documents-new-header', HEADER); await clip(p, 'documents-new-body', BAND(80, 560)); }],
    ['activity', R('/activity'), async () => { await clip(p, 'activity-header', HEADER); await el(p, 'activity-row', p.locator('table tbody tr, li').first()); }],
    ['processes', R('/processes'), async () => { await clip(p, 'processes-header', HEADER); }],
    ['automation', R('/automation'), async () => { await clip(p, 'automation-header', HEADER); await clip(p, 'automation-body', BAND(80, 520)); }],
    ['team', R('/team'), async () => { await clip(p, 'team-header', HEADER); await el(p, 'team-invite', p.getByRole('button', { name: /Invite|Add member|Add collaborator/i }).first()); }],
    ['profile', R('/profile'), async () => { await clip(p, 'profile-header', HEADER); }],
    ['billing', R('/billing'), async () => { await clip(p, 'billing-header', HEADER); }],
    ['portals', R('/portals'), async () => { await clip(p, 'portals-header', HEADER); }],
  ];

  for (const [name, url, extra] of routes) {
    console.log(`\n▶ ${name}  (${url})`);
    try {
      await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
      await settle(p);
      await full(p, name);
      if (extra) await extra();
    } catch (e) { warn('route FAIL ' + name + ' ' + e.message.slice(0, 60)); }
  }
  console.log('\n✅ tenant capture complete');
} catch (e) { console.error('FATAL', e); process.exitCode = 1; } finally { await b.close(); }
