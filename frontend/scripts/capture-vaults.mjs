/**
 * Capture the two-sided collaboration-vault ("nook") UI for the manuals (P8.9/P8.7/P8.8):
 *   TENANT side  — eric@immobileyes → /portal/immobileyes/vaults (index + create modal)
 *                  and the nook detail (members panel · artifacts · harvest · add-artifact
 *                  sharing copy).
 *   COLLABORATOR — partner@acme.test → lands on /vaults (dispatcher route) + the nook detail
 *                  (whole-only downloads, no members panel, collaborator sharing copy).
 * Shots → docs/manuals/img/shots/tenant/ · crops → .../crops/tenant/
 *   DATABASE_URL=... node scripts/capture-vaults.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.CAP_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/govwin';
const SH = path.join(ROOT, 'docs/manuals/img/shots/tenant');
const CR = path.join(ROOT, 'docs/manuals/img/crops/tenant');
fs.mkdirSync(SH, { recursive: true }); fs.mkdirSync(CR, { recursive: true });
const TENANT = { email: 'eric@immobileyes.com', pw: 'Sandbox2026!' };
const COLLAB = { email: 'partner@acme.test', pw: 'Sandbox2026!' };
const ok = (m) => console.log('  ✓', m);
const warn = (m) => console.log('  ·', m);
async function settle(p, ms = 1400) { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); }
async function full(p, n) { try { await p.screenshot({ path: path.join(SH, n + '.png'), fullPage: true }); ok('shot ' + n); } catch { warn('shot FAIL ' + n); } }
async function el(p, n, sel) { try { const l = p.locator(sel).first(); if (await l.count() === 0) { warn('absent ' + n); return; } await l.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(250); await l.screenshot({ path: path.join(CR, n + '.png') }); ok('el ' + n); } catch { warn('el FAIL ' + n); } }

async function login(ctx, who) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  // domcontentloaded (NOT networkidle — Next 15 RSC streaming can starve networkidle),
  // then explicitly wait for the credential field to attach before filling.
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // Let React hydration finish BEFORE grabbing the field — waitForSelector alone can catch
  // the pre-hydration node, which hydration then detaches, hanging the subsequent fill.
  await p.waitForTimeout(2500);
  await p.waitForSelector('#email', { state: 'visible', timeout: 20000 });
  await p.locator('#email').click();
  await p.locator('#email').fill(who.email);
  await p.locator('#password').fill(who.pw);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  console.log(`login ${who.email} →`, p.url());
  return p;
}

async function main() {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  // ── TENANT side ──
  const tctx = await b.newContext();
  const t = await login(tctx, TENANT);
  await t.goto(`${BASE}/portal/immobileyes/vaults`, { waitUntil: 'networkidle' });
  await settle(t, 1600);
  await full(t, 'vaults-tenant-index');
  await el(t, 'vaults-tenant-nook-card', 'text=/Acme Robotics/i');
  // create-a-nook modal
  try {
    await t.click('text=/New nook/i');
    await t.waitForTimeout(700);
    await el(t, 'vaults-tenant-create-modal', 'div.max-w-md');
    await t.click('button:has-text("Cancel")').catch(() => {});  // close cleanly (Escape doesn't)
    await t.waitForTimeout(400);
  } catch { warn('create modal FAIL'); }
  // nook detail (tenant): navigate + wait for the client data to load
  await t.click('a:has-text("Open nook")').catch(() => {});
  await t.waitForURL(/\/vaults\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {});
  await t.waitForSelector('text=/Partner access/i', { timeout: 20000 }).catch(() => {});
  await settle(t, 2500);
  await full(t, 'vaults-tenant-detail');
  await el(t, 'vaults-tenant-members', 'section:has-text("Partner access")');
  await el(t, 'vaults-tenant-artifacts', 'section:has-text("Artifacts")');
  // add-artifact form + P8.8 sharing copy
  try {
    await t.click('button:has-text("Add artifact")');
    await t.waitForTimeout(800);
    await el(t, 'vaults-tenant-add-artifact', 'text=/copying a COPY into the nook/i');
  } catch { warn('add-artifact FAIL'); }
  await tctx.close();

  // ── COLLABORATOR side ──
  const cctx = await b.newContext();
  const c = await login(cctx, COLLAB);   // dispatcher should land on /vaults
  await c.waitForURL(/\/vaults(\/|$|\?)/, { timeout: 20000 }).catch(() => {});
  await settle(c, 1500);
  await full(c, 'vaults-collab-landing');   // the /vaults list they land on at sign-in
  await c.goto(`${BASE}/vaults`, { waitUntil: 'domcontentloaded' });
  await settle(c, 1500);
  await full(c, 'vaults-collab-index');
  await el(c, 'vaults-collab-nook-card', 'li:has-text("Open nook")');
  await c.click('a:has-text("Open nook")').catch(() => {});
  await c.waitForURL(/\/vaults\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {});
  await c.waitForSelector('section:has-text("Artifacts")', { timeout: 20000 }).catch(() => {});
  await settle(c, 2500);
  await full(c, 'vaults-collab-detail');
  await el(c, 'vaults-collab-artifacts', 'section:has-text("Artifacts")');
  try {
    await c.click('text=/Add artifact/i');
    await c.waitForTimeout(600);
    await el(c, 'vaults-collab-add-artifact', 'text=/comfortable with the customer using/i');
  } catch { warn('collab add-artifact FAIL'); }
  await cctx.close();

  await b.close();
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
