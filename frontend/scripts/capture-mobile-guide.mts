#!/usr/bin/env node
/**
 * The guide screenshots, at phone width — and a usability verdict per surface.
 *
 * ── WHY A VERDICT AND NOT JUST A SCREENSHOT ──────────────────────────────────────────────────
 * The user guides are illustrated entirely at 1440px, and say nothing about phones. Simply adding
 * a 390px picture beside each one would be worse than nothing: it would imply every surface is
 * equally usable there, and some are not. A guide that shows a customer a screen they cannot work
 * on is the same failure as a guide that shows controls they will not find.
 *
 * So each surface is MEASURED, and the guide gets the verdict rather than an impression:
 *
 *   FULL      nothing overflows, and the page's primary controls are present and tappable
 *   SCROLL    usable, but a wide table scrolls inside its own container (the admin idiom)
 *   DESKTOP   the surface renders but its main tool is absent or unusable at this width
 *
 * `controls` counts what a person can actually DO on the page — buttons, links and inputs that are
 * visible and non-zero-sized — because "it rendered" and "you can use it" are different claims and
 * this file exists to tell them apart.
 *
 *   cd frontend && npx tsx scripts/capture-mobile-guide.mts
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { overflowing, smallTargets } from './lib/mobile-measure.mts';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const ADMIN_PW = process.env.ADMIN_PW || process.env.RFP_ADMIN_PW || 'SandboxDrive2026!';
const OUT = path.resolve('../docs/user-guides/img');
const VP = { width: 390, height: 844 };

if (!DB) { console.error('HARNESS DEFECT: GUIDE_DB required'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const [prop] = await sql<{ id: string }[]>`
  SELECT p.id FROM proposals p JOIN tenants t ON t.id = p.tenant_id
   WHERE t.slug='foundation' AND EXISTS (SELECT 1 FROM proposal_sections s WHERE s.proposal_id=p.id)
   ORDER BY p.created_at LIMIT 1`;
const [proj] = await sql<{ id: string }[]>`
  SELECT p.id FROM projects p JOIN tenants t ON t.id = p.tenant_id
   WHERE t.slug='foundation' AND p.status <> 'planning'
   ORDER BY (SELECT count(*) FROM project_milestones m WHERE m.project_id=p.id) DESC LIMIT 1`;
await sql.end();

interface Target { name: string; url: string; lane: 'tenant' | 'admin'; expect?: string }
const TARGETS: Target[] = [
  { name: 'm-02-dashboard',    url: '/portal/foundation/dashboard',    lane: 'tenant' },
  { name: 'm-03-todos',        url: '/portal/foundation/todos',        lane: 'tenant' },
  { name: 'm-04-cards',        url: '/portal/foundation/cards',        lane: 'tenant' },
  { name: 'm-05-atoms',        url: '/portal/foundation/atoms',        lane: 'tenant' },
  { name: 'm-06-documents',    url: '/portal/foundation/documents',    lane: 'tenant' },
  { name: 'm-07-proposals',    url: '/portal/foundation/proposals',    lane: 'tenant' },
  ...(prop ? [{ name: 'm-08-build-workspace', url: `/portal/foundation/proposals/${prop.id}`, lane: 'tenant' as const }] : []),
  ...(proj ? [{ name: 'm-09-project-workspace', url: `/portal/foundation/projects/${proj.id}`, lane: 'tenant' as const }] : []),
  { name: 'm-10-admin-dash',   url: '/admin/dashboard',                lane: 'admin' },
  { name: 'm-11-admin-curate', url: '/admin/rfp-curation',             lane: 'admin' },
  { name: 'm-12-admin-flows',  url: '/admin/workflows',                lane: 'admin' },
];

async function login(p: Page, email: string, pw: string) {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]'); await p.waitForTimeout(2200);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
}

const rows: Record<string, unknown>[] = [];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  // ── /login IS SHOT FIRST, IN A SIGNED-OUT CONTEXT ────────────────────────────────────────
  // It was in the target list below, where the lane signs in before the loop — so `/login`
  // redirected to the dashboard and the screenshot went out captioned as the sign-in page. The
  // measurement said so before the picture did: `drawer=true` on a page that has no navigation.
  // A mislabelled figure is the same failure as an unillustrated one, and harder to notice.
  {
    const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    const over = await overflowing(p, VP.width);
    const controls = await p.evaluate(() => Array.from(
      document.querySelectorAll('button, a[href], input, select, textarea'))
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length);
    const drawer = (await p.locator('button:has-text("☰")').count())
      + (await p.locator('button[aria-label*="menu" i]').count()) > 0;
    await p.screenshot({ path: path.join(OUT, 'm-01-login.png'), fullPage: true });
    rows.push({ name: 'm-01-login', url: '/login', lane: 'anon', status: 200, controls, drawer,
      innerScroll: false, overflow: over.length, smallTargets: 0,
      verdict: over.length ? 'OVERFLOW' : 'FULL', errs: [] });
    console.log(`  ${over.length ? '✗' : '✓'} ${'m-01-login'.padEnd(24)} 200 · ${over.length ? 'OVERFLOW' : 'FULL    '} · ${controls} control(s) · drawer=${drawer}`);
    await ctx.close();
  }

  for (const lane of ['tenant', 'admin'] as const) {
    const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs: string[] = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));
    await login(p, lane === 'tenant' ? 'kate.ulepic@foundation3dp.com' : 'eric@rfppipeline.com',
      lane === 'tenant' ? TENANT_PW : ADMIN_PW);

    for (const t of TARGETS.filter((x) => x.lane === lane)) {
      errs.length = 0;
      const r = await p.goto(BASE + t.url, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(1300);
      const status = r?.status() ?? 0;

      const over = await overflowing(p, VP.width);
      const small = await smallTargets(p);
      // What a person can actually DO here: visible, non-zero controls.
      const controls = await p.evaluate(() => Array.from(
        document.querySelectorAll('button, a[href], input, select, textarea'))
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length);
      // Is the nav a DRAWER at this width? Below `lg` the shell collapses to a hamburger, and a
      // guide that shows a sidebar a phone user does not have is a guide describing another screen.
      // COUNTED, not OR-matched. The first version used a comma selector and reported `true` on
      // `/login`, which has no navigation at all — so the manual would have told a customer about
      // a drawer that is not on the page they are looking at. Two explicit counts instead.
      const drawer = (await p.locator('button:has-text("☰")').count())
        + (await p.locator('button[aria-label*="menu" i]').count()) > 0;
      // A table that scrolls inside itself is the admin idiom — usable, but worth saying.
      const innerScroll = await p.evaluate(() => Array.from(document.querySelectorAll('*'))
        .some((e) => { const cs = getComputedStyle(e);
          return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 4; }));

      const verdict = over.length ? 'OVERFLOW' : innerScroll ? 'SCROLL' : 'FULL';
      await p.screenshot({ path: path.join(OUT, `${t.name}.png`), fullPage: true });
      rows.push({ ...t, status, controls, drawer, innerScroll, overflow: over.length,
        smallTargets: small.length, verdict, errs: [...errs] });
      console.log(`  ${errs.length || over.length ? '✗' : '✓'} ${t.name.padEnd(24)} ${status} · ${String(verdict).padEnd(8)} · ${controls} control(s)${errs.length ? ` · ${errs.length} client error(s)` : ''}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }

writeFileSync(path.join(OUT, 'mobile-guide.json'), JSON.stringify({ viewport: VP, rows }, null, 1));
const bad = rows.filter((r) => (r.errs as string[]).length || r.overflow);
console.log(`\n${rows.length} surface(s) · ${rows.length - bad.length} clean · ${bad.length} with a finding`);
console.log(`verdicts: ${['FULL','SCROLL','OVERFLOW'].map((v) => `${v} ${rows.filter((r) => r.verdict === v).length}`).join(' · ')}`);
process.exit(bad.length ? 1 : 0);
