#!/usr/bin/env node
/**
 * Screenshots for `docs/user-guides/projects.md` — the post-award guide.
 *
 * ── WHY THIS EXISTS SEPARATELY ───────────────────────────────────────────────────────────────
 * The illustrated user guides cover the whole pre-award arc and stop at the download. Every file
 * in `docs/user-guides/` scores ZERO on `post-award|/projects|milestone|deliverable|CLIN`, which
 * means a customer who WINS has no guide for what happens next — the half of their life the
 * product now spends the most code on.
 *
 * Same contract as `capture-guides.mjs`: every target is VISITED as the real actor through the
 * real login, and each records what the browser actually got. A target that fails is REPORTED, not
 * skipped — a guide illustrated with screenshots nobody checked is how a doc describes a screen
 * that no longer exists.
 *
 *   cd frontend && node scripts/capture-projects-guide.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const OUT = path.resolve('../docs/user-guides/img');

if (!DB) { console.error('HARNESS DEFECT: GUIDE_DB / DATABASE_URL_OWNER required'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const sql = postgres(DB, { max: 2, onnotice: () => {} });
// The project with the MOST built out on it — a guide shot of an empty workspace teaches nothing.
const [proj] = await sql`
  SELECT p.id, p.name, t.slug, u.email
    FROM projects p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN users u ON u.id = p.created_by
   WHERE p.status <> 'planning'
   ORDER BY (SELECT count(*) FROM project_milestones m WHERE m.project_id = p.id) DESC,
            p.created_at ASC
   LIMIT 1`;
await sql.end();
if (!proj) { console.error('HARNESS DEFECT: no project to illustrate. Uncovered, not passing.'); process.exit(2); }
console.log(`· illustrating "${proj.name}" (${proj.slug}) as ${proj.email}`);

const results = [];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));

async function shot(name, url, { full = true, wait = 1400 } = {}) {
  errs.length = 0;
  let status = 0;
  try {
    const r = await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    status = r?.status() ?? 0;
    await p.waitForTimeout(wait);
    const body = await p.innerText('body').catch(() => '');
    // NOT a bare `500`. The first version matched that, and the project workspace renders
    // "$500,000" in its billing panel — so a page that rendered perfectly was reported as an error
    // surface and the guide would have gone unillustrated on a working screen. Match the phrases
    // Next actually renders, not a number that happens to appear in correct output.
    const broke = /Application error|Something went wrong|Internal Server Error|This page could not be found/i
      .test(body.slice(0, 400));
    await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    const finalUrl = new URL(p.url()).pathname;
    const redirected = finalUrl !== url;
    results.push({ name, url, status, finalUrl, redirected, broke, errs: [...errs] });
    console.log(`  ${broke || errs.length ? '✗' : '✓'} ${name.padEnd(28)} ${status}${redirected ? ` → ${finalUrl}` : ''}${errs.length ? ` · ${errs.length} client error(s)` : ''}`);
  } catch (e) {
    results.push({ name, url, status, failed: String(e).slice(0, 90) });
    console.log(`  ✗ ${name.padEnd(28)} ${String(e).slice(0, 70)}`);
  }
}

await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await p.fill('#email', proj.email);
await p.fill('#password', TENANT_PW);
await p.click('button[type="submit"]');
await p.waitForTimeout(2200);
if (p.url().includes('/login')) { console.error(`HARNESS DEFECT: login failed for ${proj.email}`); process.exit(2); }

const P = `/portal/${proj.slug}/projects`;
await shot('projects-01-index', P);
await shot('projects-02-workspace', `${P}/${proj.id}`);

await browser.close();
const bad = results.filter((r) => r.broke || r.failed || (r.errs?.length ?? 0) > 0);
console.log(`\n${results.length} target(s) · ${results.length - bad.length} rendered · ${bad.length} failed`);
if (bad.length) { for (const b of bad) console.log(`  ✗ ${b.name} — ${b.failed ?? (b.broke ? 'error surface' : b.errs.join('; '))}`); }
console.log(bad.length ? '\n✗ do NOT illustrate a surface that did not render.' : '\n✓ every target rendered for its real actor.');
process.exit(bad.length ? 1 : 0);
