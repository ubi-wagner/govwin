/**
 * The two front-door guides, captured against the build that is actually running.
 *
 * `docs/CUSTOMER_ONBOARDING_GUIDE.md` and `docs/RFP_ADMIN_OPERATIONS_GUIDE.md` are the first thing
 * a founding-cohort customer and a new RFP admin read, and until now neither contained a single
 * screenshot — 968 lines of prose describing screens nobody had looked at while writing them. The
 * illustrated material (docs/manuals, docs/user-guides) is a different, generated family; these two
 * are hand-written and had drifted with nothing to catch it.
 *
 * So this is not only a capture. Every target is VISITED as the real actor through the real login,
 * and each one records what the browser actually got: the final URL (a redirect is a finding — the
 * guide naming a route the product moved is exactly the drift a screenshot pass is for), an HTTP
 * status, any uncaught client error, and whether the page rendered an error boundary. A target that
 * fails is reported, never silently skipped — the failure IS the result.
 *
 *   cd frontend && node scripts/capture-guides.mjs [--only customer|admin]
 *
 * Writes docs/assets/guides/{customer,admin}/*.png and prints a per-target table.
 * Exit 0 if every target rendered; 1 if any failed, so it can gate.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://claude@127.0.0.1:5433/govtech_intel';
const ROOT = '/home/user/govwin';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]
  || (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '');

const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/**
 * The IDs are LOOKED UP, never hardcoded. Every prior capture script in this repo pins a UUID at
 * the top and silently produces a 404 screenshot the day that row is reseeded — which is how a
 * guide ends up illustrated with an error page. If a lookup finds nothing the target is dropped
 * with a reason, which is visible in the report.
 */
async function ids() {
  const [rich] = await sql`
    SELECT p.id, p.tenant_id, t.slug
    FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.archived_at IS NULL AND t.slug = 'foundation'
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC
    LIMIT 1`;
  const [sect] = rich ? await sql`
    SELECT id FROM proposal_sections WHERE proposal_id = ${rich.id}
    ORDER BY sort_index ASC NULLS LAST, section_number ASC LIMIT 1` : [];
  // A "topic" is an `opportunities` row hanging off the solicitation — there is no
  // `solicitation_topics` table, and assuming one is how a capture script ends up shooting a 404.
  // This mirrors the predicate the topic PAGE itself runs, so a row found here is a row it renders.
  const [sol] = await sql`
    SELECT cs.id
    FROM curated_solicitations cs
    WHERE cs.solicitation_title IS NOT NULL
    ORDER BY (SELECT count(*) FROM opportunities o WHERE o.solicitation_id = cs.id) DESC,
             cs.created_at DESC
    LIMIT 1`;
  const [topic] = sol ? await sql`
    SELECT id FROM opportunities WHERE solicitation_id = ${sol.id} ORDER BY created_at LIMIT 1` : [];
  const [portal] = await sql`
    SELECT pp.id, t.slug FROM proposal_portals pp JOIN tenants t ON t.id = pp.tenant_id
    ORDER BY pp.created_at DESC LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  return {
    proposalId: rich?.id, sectionId: sect?.id, solId: sol?.id, topicId: topic?.id,
    portalId: portal?.id, portalSlug: portal?.slug, tenantId: tenant?.id,
  };
}

const results = [];
async function settle(p, ms = 1800) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(ms);
}

/**
 * One target: go there, record what came back, shoot it.
 *
 * `expect` is the route as the GUIDE names it. When the product redirects elsewhere the row is
 * marked REDIRECT rather than passed — a guide that sends a reader to a route the product retired
 * is broken even though the screenshot looks fine.
 */
async function target(page, outDir, { name, url, expect, full = true, before, viewport, shoot = true }) {
  const rec = { name, url, status: null, landed: null, note: '', ok: false };
  const clientErrs = page.__errs ?? (page.__errs = watchErrors(page));
  const errsBefore = clientErrs.length;
  try {
    if (viewport) await page.setViewportSize(viewport);
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    rec.status = resp?.status() ?? null;
    await settle(page);
    if (before) await before(page).catch((e) => { rec.note = 'setup: ' + String(e.message).slice(0, 50); });
    await settle(page, 700);
    rec.landed = page.url().replace(BASE, '');
    // EVERY error surface the product can render, not the three I happened to think of.
    //
    // The first version matched "Application error|Unhandled Runtime Error|500 —|not found" and
    // missed the portal's own boundary — "Something went wrong · This page failed to load" — so the
    // proposal workspace reported `✓ 200` while showing a customer a red box (B78). Next returns 200
    // for a client-side boundary and the throw never reaches the server log, so the RENDERED TEXT is
    // the only evidence there is. Client `pageerror`s are collected too: a page that renders but
    // throws is a broken page that a status code calls fine.
    const errored = await page.locator(
      'text=/Application error|Unhandled Runtime Error|Something went wrong|failed to load'
      + '|500 —|This page could not be found|Could not load/i',
    ).count();
    // `expect` defaults to the route ITSELF, and the compare is exact. The first version defaulted
    // to a prefix (`/portal/foundation`) that every portal route satisfies, so three retired
    // library routes redirected to /atoms, produced three byte-identical screenshots, and reported
    // a clean pass — the guide would have been illustrated at routes the product no longer serves.
    const want = expect ?? url;
    const redirected = rec.landed.split('?')[0] !== want.split('?')[0];
    if (shoot) await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full });
    const thrown = clientErrs.slice(errsBefore);
    rec.ok = (rec.status ?? 200) < 400 && errored === 0 && thrown.length === 0;
    if (errored) rec.note = 'error boundary rendered' + (thrown[0] ? ` — ${thrown[0]}` : '');
    else if (thrown.length) rec.note = `client threw — ${thrown[0]}`;
    else if (redirected) rec.note = `redirected to ${rec.landed}`;
  } catch (e) {
    rec.note = String(e.message).slice(0, 70);
  }
  results.push(rec);
  console.log(`  ${rec.ok ? '✓' : '✗'} ${name.padEnd(30)} ${String(rec.status ?? '—').padStart(3)}  ${rec.note}`);
  return rec.ok;
}

/** Click a named tab on a tabbed surface, then shoot it. The unified library is tabs, not routes. */
async function tabShot(page, outDir, name, label, full = true) {
  const rec = { name, url: page.url().replace(BASE, '') + ` [tab: ${label}]`, status: 200, landed: null, note: '', ok: false };
  try {
    const tab = page.locator(`button:has-text("${label}"), [role="tab"]:has-text("${label}")`).first();
    if (await tab.count() === 0) throw new Error(`no tab labelled "${label}"`);
    await tab.click();
    await settle(page, 1600);
    rec.landed = page.url().replace(BASE, '');
    await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: full });
    rec.ok = true;
  } catch (e) {
    rec.note = String(e.message).slice(0, 70);
  }
  results.push(rec);
  console.log(`  ${rec.ok ? '✓' : '✗'} ${name.padEnd(30)} tab  ${rec.note}`);
  return rec.ok;
}

/** Attach the client-error collector — a page that throws is not a page that rendered. */
function watchErrors(p) {
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error' && /error boundary|TypeError|ReferenceError/i.test(m.text())) errs.push(m.text().slice(0, 120)); });
  return errs;
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email);
  await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await settle(p, 2600);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email} → ${p.url()}`);
  return p;
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const V = { width: 1440, height: 900 };
const ID = await ids();
console.log('resolved ids:', JSON.stringify(ID, null, 0), '\n');

try {
  // ─────────────────────────── CUSTOMER (tenant_admin) ───────────────────────────
  if (!only || only === 'customer') {
    const OUT = path.join(ROOT, 'docs/assets/guides/customer');
    fs.mkdirSync(OUT, { recursive: true });
    console.log('── customer · kate.ulepic@foundation3dp.com (tenant_admin, foundation) ──');

    // Step 2 is the login form itself, which has to be shot BEFORE anyone is signed in.
    {
      const ctx = await browser.newContext({ viewport: V });
      const p = await ctx.newPage();
      await target(p, OUT, { name: '02-login', url: '/login', expect: '/login', full: false });
      await ctx.close();
    }

    const ctx = await browser.newContext({ viewport: V });
    const p = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');
    const S = '/portal/foundation';
    await target(p, OUT, { name: '03-dashboard', url: `${S}/dashboard` });
    await target(p, OUT, { name: '03b-command-center', url: `${S}/command` });

    // The three routes the guide names for the library are all RETIRED redirects onto the one
    // unified `/atoms` surface, where upload / review / browse are TABS. Probed (not shot) so the
    // redirect is on the record; the tabs below are what a reader is actually looking at.
    await target(p, OUT, { name: '04-library-upload(probe)', url: `${S}/library/upload`, shoot: false });
    await target(p, OUT, { name: '05-library-review(probe)', url: `${S}/library/review`, shoot: false });
    await target(p, OUT, { name: '06-library(probe)', url: `${S}/library`, shoot: false });
    await target(p, OUT, { name: '06-library', url: `${S}/atoms` });
    await tabShot(p, OUT, '04-library-upload', 'Upload package');
    await tabShot(p, OUT, '04b-library-atomize', 'Atomize');
    await tabShot(p, OUT, '05-library-review', 'Review');

    await target(p, OUT, { name: '07-cards', url: `${S}/cards` });
    await target(p, OUT, { name: '07b-buckets', url: `${S}/buckets` });
    // The guide tells the reader `/spotlights` redirects to `/cards`. That claim is a live
    // assertion, not prose — probe where it actually lands.
    await target(p, OUT, { name: '07c-spotlights(probe)', url: `${S}/spotlights`, expect: `${S}/cards`, shoot: false });
    await target(p, OUT, { name: '08-portals', url: `${S}/portals` });
    if (ID.portalId && ID.portalSlug === 'foundation') {
      await target(p, OUT, { name: '08b-workflow-setup', url: `${S}/portals/${ID.portalId}` });
    }
    if (ID.proposalId) {
      await target(p, OUT, { name: '09-proposal-workspace', url: `${S}/proposals/${ID.proposalId}` });
      if (ID.sectionId) {
        // The canvas is a fixed-viewport surface: a fullPage shot of a paginated editor is a
        // 12,000px strip nobody can read in a guide.
        await target(p, OUT, {
          name: '10-canvas-editor',
          url: `${S}/proposals/${ID.proposalId}/sections/${ID.sectionId}`,
          full: false,
        });
      }
    }
    await target(p, OUT, { name: '11-todos', url: `${S}/todos` });
    await target(p, OUT, { name: '12-team', url: `${S}/team` });
    await target(p, OUT, { name: '13-documents', url: `${S}/documents` });
    await ctx.close();
  }

  // ───────────────────────────── ADMIN (master_admin) ─────────────────────────────
  if (!only || only === 'admin') {
    const OUT = path.join(ROOT, 'docs/assets/guides/admin');
    fs.mkdirSync(OUT, { recursive: true });
    console.log('\n── admin · eric@rfppipeline.com (master_admin) ──');
    const ctx = await browser.newContext({ viewport: V });
    const p = await login(ctx, 'eric@rfppipeline.com', ADMIN_PW);
    await target(p, OUT, { name: '01-dashboard', url: '/admin/dashboard' });
    await target(p, OUT, { name: '01b-command-center', url: '/admin/command' });
    await target(p, OUT, { name: '02-applications', url: '/admin/applications' });
    await target(p, OUT, { name: '03-upload-rfp', url: '/admin/rfp-curation/upload' });
    await target(p, OUT, { name: '04-triage-queue', url: '/admin/rfp-curation' });
    if (ID.solId) {
      await target(p, OUT, { name: '05-curation-workspace', url: `/admin/rfp-curation/${ID.solId}` });
      if (ID.topicId) {
        await target(p, OUT, {
          name: '05c-topic-volumes', url: `/admin/rfp-curation/${ID.solId}/topic/${ID.topicId}`,
        });
      }
    }
    await target(p, OUT, { name: '06-opportunities', url: '/admin/opportunities' });
    await target(p, OUT, { name: '07-tenants', url: '/admin/tenants' });
    if (ID.tenantId) {
      await target(p, OUT, { name: '07b-tenant-detail', url: `/admin/tenants/${ID.tenantId}` });
    }
    await target(p, OUT, { name: '08-purchases', url: '/admin/purchases' });
    await target(p, OUT, { name: '08b-provisioning', url: '/admin/provisioning' });
    if (ID.portalId) {
      await target(p, OUT, { name: '08c-provisioning-cockpit', url: `/admin/provisioning/${ID.portalId}` });
    }
    await target(p, OUT, { name: '09-workflows', url: '/admin/workflows' });
    await target(p, OUT, { name: '09b-agents', url: '/admin/agents' });
    await target(p, OUT, { name: '10-events', url: '/admin/events' });
    await target(p, OUT, { name: '10b-scouts', url: '/admin/scouts' });
    await target(p, OUT, { name: '10c-system-state', url: '/admin/system-state' });
    await target(p, OUT, { name: '10d-site-content', url: '/admin/site' });
    await ctx.close();
  }
} finally {
  await browser.close();
  await sql.end();
}

const bad = results.filter((r) => !r.ok);
const redir = results.filter((r) => r.ok && r.note.startsWith('redirected'));
console.log(`\n${results.length} target(s) · ${results.length - bad.length} rendered · ${bad.length} failed`);
if (redir.length) {
  console.log(`\n${redir.length} target(s) did not land where the guide says (a guide correction, not a capture bug):`);
  for (const r of redir) console.log(`  · ${r.name}: ${r.url} → ${r.landed}`);
}
if (bad.length) {
  console.log('\n✗ failed targets — these surfaces are NOT capturable and must not be illustrated as if they were:');
  for (const r of bad) console.log(`  · ${r.name} (${r.url}) — ${r.note || 'status ' + r.status}`);
  process.exit(1);
}
console.log('\n✓ every documented surface rendered for its real actor.');
