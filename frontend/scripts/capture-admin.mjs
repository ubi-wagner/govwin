/**
 * Comprehensive ADMIN screenshot capture for the RFP-Admin manual.
 * Full-page context shots → docs/manuals/img/shots/admin/<name>.png
 * Focused element / region crops → docs/manuals/img/crops/admin/<name>.png
 * Every target is best-effort: a failure on one never aborts the run.
 *
 *   DATABASE_URL=... node scripts/capture-admin.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/govwin';
const SH = path.join(ROOT, 'docs/manuals/img/shots/admin');
const CR = path.join(ROOT, 'docs/manuals/img/crops/admin');
fs.mkdirSync(SH, { recursive: true });

/**
 * Record WHICH RUN produced these pictures.
 *
 * A screenshot with no provenance is indistinguishable from a screenshot taken a year ago, which
 * is how the guides came to illustrate a product that had moved. The run id, the commit and the
 * base URL go into docs/manuals/guides/_revisions.json, and build_guides.py prints them in the
 * footer — so "are these current?" is answered by looking, not by re-reading the whole guide.
 *
 * Best-effort: a capture that cannot write its provenance still produced the shots, and failing
 * the run over bookkeeping would be worse than the gap it records.
 */
function recordCapture(slug, shots, crops) {
  try {
    // `require` does not exist in an ESM module — the first run reported
    // "provenance NOT recorded (require is not defined)", which is the best-effort design working:
    // it said what it failed to do instead of silently writing nothing.
    const { execSync } = createRequire(import.meta.url)('node:child_process');
    const commit = execSync('git -C /home/user/govwin rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const p = '/home/user/govwin/docs/manuals/guides/_revisions.json';
    const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { guides: {} };
    data.guides = data.guides || {};
    data.guides[slug] = data.guides[slug] || {};
    data.guides[slug].capture = {
      runId: `${slug}-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      base: BASE,
      commit,
      shots,
      crops,
    };
    fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`\n  provenance recorded — ${slug} · ${commit} · ${shots} shot(s) · ${crops} crop(s)`);
  } catch (e) {
    console.log(`\n  ⚠ provenance NOT recorded (${String(e.message).slice(0, 60)}) — the shots are fine, the record is not`);
  }
}

fs.mkdirSync(CR, { recursive: true });

const ADMIN = { email: 'eric@rfppipeline.com', pw: (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!') };
const SOL = '0fdf2ada-40e7-45e9-b993-c654b6ea3137';
const TENANT = 'dd831b77-2d6b-4b53-bb18-4d48569a2258'; // immobileyes
const WF_PAUSED = '70465b09-e79f-46f8-aa60-5db69740363b';
const SRC = '02a27d70-2833-4ab4-9a35-fa93a27bf3d5'; // SAM.gov source profile

const ok = (m) => console.log('  ✓', m);
const warn = (m) => console.log('  ·', m);

async function settle(p, ms = 1400) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(ms);
}
async function full(p, name) {
  try { await p.screenshot({ path: path.join(SH, name + '.png'), fullPage: true }); ok('shot ' + name); }
  catch (e) { warn('shot FAIL ' + name + ' ' + e.message.slice(0, 50)); }
}
async function clip(p, name, box) {
  try { await p.screenshot({ path: path.join(CR, name + '.png'), clip: box }); ok('crop ' + name); }
  catch (e) { warn('crop FAIL ' + name); }
}
async function el(p, name, locator) {
  try {
    const loc = typeof locator === 'string' ? p.locator(locator).first() : locator.first();
    if (await loc.count() === 0) { warn('el absent ' + name); return false; }
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(250);
    await loc.screenshot({ path: path.join(CR, name + '.png') });
    ok('el ' + name); return true;
  } catch (e) { warn('el FAIL ' + name + ' ' + e.message.slice(0, 50)); return false; }
}

// content band helpers (sidebar is 256px CSS wide)
const HEADER = { x: 256, y: 0, width: 1184, height: 340 };
const BAND = (y, h) => ({ x: 256, y, width: 1184, height: h });

async function login(p) {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', ADMIN.email);
  await p.fill('input[name="password"]', ADMIN.pw);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1500);
  console.log('login →', p.url());
}

const b = await chromium.launch({ executablePath: EXE });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

try {
  await login(p);

  // sidebar (global, reused across the guide)
  await p.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await settle(p);
  await el(p, 'nav-sidebar', 'aside');

  // ── Route list: [name, url, extra crops fn] ────────────────────────────────
  const routes = [
    ['dashboard', '/admin', async () => {
      await clip(p, 'dash-stats', HEADER);
      await el(p, 'dash-todos', p.getByText(/Your To-?Dos/i).locator('xpath=ancestor::*[self::section or self::div][1]'));
      await el(p, 'dash-todo-one', p.getByText(/Curate & release|Curation SLA|pinned a topic/i).first().locator('xpath=ancestor::*[self::div][2]'));
      await el(p, 'dash-events', p.getByText(/Recent Events/i).locator('xpath=ancestor::*[self::section or self::div][1]'));
      await el(p, 'dash-pending', p.getByText(/Pending Actions/i).locator('xpath=ancestor::*[self::section or self::div][1]'));
    }],
    ['sources', '/admin/sources', async () => { await clip(p, 'sources-header', HEADER); }],
    ['source-detail', `/admin/sources/${SRC}`, async () => { await clip(p, 'source-detail-header', HEADER); }],
    ['scouts', '/admin/scouts', async () => { await clip(p, 'scouts-header', HEADER); }],
    ['intake', '/admin/intake', async () => { await clip(p, 'intake-header', HEADER); }],
    ['curation', '/admin/rfp-curation', async () => {
      await clip(p, 'curation-header', HEADER);
      await el(p, 'curation-row', p.locator('table tbody tr, li').first());
    }],
    ['curation-detail', `/admin/rfp-curation/${SOL}`, async () => {
      await clip(p, 'curation-detail-header', HEADER);
      await el(p, 'curation-tabs', p.getByRole('tablist').first());
      await el(p, 'curation-triage', p.getByText(/Triage|Compliance|Topics|Skeleton|Outline/i).first().locator('xpath=ancestor::*[self::div][1]'));
    }],
    ['opportunities', '/admin/opportunities', async () => {
      await clip(p, 'opps-header', HEADER);
      await el(p, 'opp-push', p.getByRole('button', { name: /Push|Publish|Activate/i }).first());
    }],
    ['cards', '/admin/cards', async () => { await clip(p, 'admin-cards-header', HEADER); }],
    ['purchases', '/admin/purchases', async () => {
      await clip(p, 'purchases-header', HEADER);
      await el(p, 'purchase-release', p.getByRole('button', { name: /Release|Curate/i }).first());
    }],
    ['applications', '/admin/applications', async () => { await clip(p, 'applications-header', HEADER); }],
    ['templates', '/admin/templates', async () => {
      await clip(p, 'templates-header', HEADER);
      await el(p, 'template-new', p.getByRole('button', { name: /New Template|Create/i }).first());
      await el(p, 'template-card', p.locator('a[href*="templates/"], .grid > *').first());
    }],
    ['workflows', '/admin/workflows', async () => {
      await clip(p, 'workflows-header', HEADER);
      await el(p, 'workflow-catalog', p.getByText(/catalog|template/i).first().locator('xpath=ancestor::*[self::section or self::div][1]'));
      await el(p, 'workflow-toggle', p.locator('button[role="switch"], input[type="checkbox"]').first());
      await el(p, 'workflow-instance', p.getByText(/running|paused|failed|completed/i).first().locator('xpath=ancestor::*[self::tr or self::div][1]'));
    }],
    ['workflow-detail', `/admin/workflows?instance=${WF_PAUSED}`, async () => { await clip(p, 'workflow-detail-band', BAND(80, 600)); }],
    ['automation', '/admin/automation', async () => {
      await clip(p, 'automation-header', HEADER);
      await el(p, 'automation-rule', p.locator('table tbody tr, li').first());
    }],
    ['agents', '/admin/agents', async () => {
      await clip(p, 'agents-header', HEADER);
      await el(p, 'agent-roster', p.locator('table, .grid').first());
      await el(p, 'agent-row', p.getByText(/section_drafter|librarian|scoring_strategist|compliance/i).first().locator('xpath=ancestor::*[self::tr or self::div][1]'));
    }],
    ['guardrails', '/admin/guardrail-defaults', async () => { await clip(p, 'guardrails-header', HEADER); await clip(p, 'guardrails-form', BAND(80, 560)); }],
    ['events', '/admin/events', async () => {
      await clip(p, 'events-header', HEADER);
      await el(p, 'event-row', p.locator('table tbody tr').first());
    }],
    ['process', '/admin/process', async () => { await clip(p, 'process-header', HEADER); }],
    ['processes', '/admin/processes', async () => { await clip(p, 'processes-header', HEADER); }],
    ['system-state', '/admin/system-state', async () => { await clip(p, 'system-header', HEADER); await clip(p, 'system-band', BAND(80, 520)); }],
    ['analytics', '/admin/analytics', async () => { await clip(p, 'analytics-header', HEADER); }],
    ['storage', '/admin/storage', async () => { await clip(p, 'storage-header', HEADER); }],
    ['tenants', '/admin/tenants', async () => {
      await clip(p, 'tenants-header', HEADER);
      await el(p, 'tenant-row', p.getByText(/immobileyes|Immobileyes/i).first().locator('xpath=ancestor::*[self::tr or self::div][1]'));
    }],
    ['tenant-detail', `/admin/tenants/${TENANT}`, async () => {
      await clip(p, 'tenant-detail-header', HEADER);
      await el(p, 'tenant-shadow', p.getByRole('button', { name: /Shadow|Descend|Enter|Work in/i }).first());
    }],
    ['billing', '/admin/billing', async () => { await clip(p, 'billing-header', HEADER); }],
    ['waitlist', '/admin/waitlist', async () => { await clip(p, 'waitlist-header', HEADER); }],
    ['site', '/admin/site', async () => {
      await clip(p, 'site-header', HEADER);
      await el(p, 'site-page-row', p.locator('table tbody tr, a[href*="site/"]').first());
    }],
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

  // Count what actually landed on disk, not what we intended to write — the difference
  // is exactly the failure a best-effort capture is allowed to have.
  const _shots = fs.existsSync(SH) ? fs.readdirSync(SH).filter((f) => f.endsWith('.png')).length : 0;
  const _crops = fs.existsSync(CR) ? fs.readdirSync(CR).filter((f) => f.endsWith('.png')).length : 0;
  recordCapture('rfp-admin', _shots, _crops);
  console.log('\n✅ admin capture complete');
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 1;
} finally {
  await b.close();
}
