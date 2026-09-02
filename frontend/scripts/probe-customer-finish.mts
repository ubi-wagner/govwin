/**
 * FINISH — is what the customer sees actually finished, or merely correct?
 *
 * ── THE DIVISION THIS BELONGS TO ─────────────────────────────────────────────────────────────
 * The platform has two halves of one job. This side never trusts and always tests: it counts,
 * it red-tests itself, it refuses verdicts it cannot earn. The in-product companion
 * (`ops_companion`) reads the same evidence and applies judgement about recency, effectiveness
 * and finish — the things that make a system a luxury choice rather than merely a working one.
 * This is the arithmetic that keeps that judgement honest. docs/ADMIN_COMPANION_DESIGN.md §4a.
 *
 * ── WHY IT LOOKS AT PAGES AND NOT AT THE DATABASE ────────────────────────────────────────────
 * Two SQL-shaped versions of this were written first and both were phantom — see the header of
 * `scripts/lib/finish-measure.mts` for the receipts. Luxury is a property of the rendered page.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────────────────────
 *   brokenValue  NaN · undefined · null · [object Object] · Invalid Date in prose
 *   identifier   a UUID a customer can read
 *   jargon       a raw snake_case / dotted system token in prose
 *   deadEnd      a main region that says there is nothing here and offers no way forward
 *
 * ── THE SELF-TEST RUNS FIRST, AND IT CUTS BOTH WAYS ──────────────────────────────────────────
 * Before any real page is opened, the four detectors are driven against a fixture that is
 * DEFINITELY broken and must all fire, and against a CONTROL that is definitely fine and must all
 * stay silent. Either failure exits 2 as a harness defect, because:
 *
 *   · a detector that cannot see reports a clean run — worse than not running (B127, B131);
 *   · a detector that fires on everything trains the reader to skip the line, which is the same
 *     outcome by a longer road.
 *
 * The control is the sharp half. It contains a `<pre>` holding a real JSON payload with a literal
 * `null`, a `<code>` holding an event type, and a mono span holding a UUID — all three legitimate,
 * all three exactly what the naive version of each detector would have reported.
 *
 * ⚠️ READ-ONLY. It signs in, opens pages and reads the DOM. It posts nothing.
 *
 *   cd frontend && npx tsx scripts/probe-customer-finish.mts
 * Exit 0 clean · 1 findings · 2 the harness could not earn a verdict.
 */
import { chromium, type Page, type Browser } from 'playwright';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { measureFinish, type Finding } from './lib/finish-measure.mts';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const DB = process.env.DATABASE_URL_OWNER || process.env.GUIDE_DB;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const APP = path.resolve(new URL('..', import.meta.url).pathname, 'app');

/** A page that is definitely broken. Every detector must see its own defect here. */
const BROKEN_FIXTURE = `
  <main>
    <h1>Milestone variance</h1>
    <p>Finishing NaN days early against baseline.</p>
    <p>Owner: undefined</p>
    <p>Last export: Invalid Date</p>
    <p>Payload: [object Object]</p>
    <p>Opportunity 4137280f-796a-5af1-88dc-7601b74de61c is ready.</p>
    <p>Status: curation_pending</p>
  </main>`;

/** A page that is definitely fine — and that the naive version of each detector flagged. */
const CONTROL_FIXTURE = `
  <main>
    <h1>Event stream</h1>
    <p>Kate opened the proposal a moment ago. Nancy Nullingsworth approved it.</p>
    <pre>{"code":"NOT_FOUND","tenantId":null,"payload":{"sectionId":null}}</pre>
    <code>proposal:section_saved</code>
    <span style="font-family: ui-monospace, monospace">4137280f-796a-5af1-88dc-7601b74de61c</span>
    <p>Read the annual_report.pdf for details, or visit rfppipeline.com.</p>
    <p>No results for that filter.</p>
    <button>Clear filter</button>
  </main>`;

const KINDS: Finding['kind'][] = ['brokenValue', 'identifier', 'jargon', 'deadEnd'];

/** A dead end needs a THIRD fixture: an empty main with no control at all. */
const DEAD_END_FIXTURE = `<main><h1>Documents</h1><p>No documents yet.</p></main>`;

/**
 * Is the app on :3000 actually serving the build on disk?
 *
 * ⚠️ THIS GUARD EXISTS BECAUSE IT WAS NEEDED THE FIRST TIME IT WAS NOT THERE. A fix landed, the
 * build succeeded, the staging step was killed mid-chain, and the probe re-ran against the OLD
 * bundle. The counts moved — 99 jargon findings became 46 — purely because the activity feed shows
 * "the last N hours" and time had passed. That drift read exactly like a partial fix, and the
 * conclusion drawn from it was wrong in both directions: the fix had not shipped at all.
 *
 * `probe-interaction-mobile.mts` learned the same lesson from the other side (a stale server
 * serving no CSS produced 75 phantom findings). A measurement of an unknown build is not a weaker
 * measurement — it is a measurement of something else.
 */
async function servingCurrentBuild(browser: Browser): Promise<string | null> {
  const onDisk = path.join(APP, '..', '.next', 'BUILD_ID');
  let want: string;
  try { want = fs.readFileSync(onDisk, 'utf8').trim(); } catch { return null; } // no build to compare
  const page = await (await browser.newContext()).newPage();
  try {
    const res = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    if (!res || !res.ok()) return `the app at ${BASE} did not answer`;
    const html = await page.content();
    // Next embeds the build id in the flight/script payload; a match is proof enough that the
    // running server was started from this build directory.
    if (!html.includes(want)) {
      return `serving a DIFFERENT build than .next/BUILD_ID (${want}) — restage .next/static and `
        + 'restart, or every count below describes the previous build';
    }
    return null;
  } finally {
    await page.context().close();
  }
}

async function selfTest(browser: Browser): Promise<string | null> {
  const page = await (await browser.newContext()).newPage();
  try {
    await page.setContent(`<!doctype html><html><body>${BROKEN_FIXTURE}</body></html>`);
    const broken = await measureFinish(page);
    for (const k of KINDS.filter((k) => k !== 'deadEnd')) {
      if (!broken.some((f) => f.kind === k)) {
        return `detector "${k}" did not fire on a fixture built to trip it — every clean below would be unearned`;
      }
    }

    await page.setContent(`<!doctype html><html><body>${DEAD_END_FIXTURE}</body></html>`);
    if (!(await measureFinish(page)).some((f) => f.kind === 'deadEnd')) {
      return 'detector "deadEnd" did not fire on a main region with no control in it';
    }

    await page.setContent(`<!doctype html><html><body>${CONTROL_FIXTURE}</body></html>`);
    const control = await measureFinish(page);
    if (control.length) {
      return 'the CONTROL fired, so every finding below is suspect: '
        + control.map((f) => `${f.kind}: ${f.text.slice(0, 60)}`).join(' · ');
    }
    return null;
  } finally {
    await page.context().close();
  }
}

/** Every tenant portal `page.tsx`, as a route. Same walk as verify-surfaces, same exclusions. */
function tenantRoutes(): string[] {
  const root = path.join(APP, 'portal', '[tenantSlug]');
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel + '/' + e.name);
      else if (e.name === 'page.tsx') out.push(('/portal/[tenantSlug]' + rel).replace(/\/\(.*?\)/g, ''));
    }
  };
  walk(root, '');
  return out.sort();
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', TENANT_PW);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) throw new Error('login failed');
}

async function main() {
  if (!DB) { console.error('HARNESS DEFECT: DATABASE_URL_OWNER required'); process.exit(2); }

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    // ── the instrument before the finding ────────────────────────────────────────────────────
    const stale = await servingCurrentBuild(browser);
    if (stale) { console.error(`HARNESS DEFECT — ${stale}`); process.exit(2); }

    const bad = await selfTest(browser);
    if (bad) { console.error(`HARNESS DEFECT — ${bad}`); process.exit(2); }
    console.log('✓ self-test: all four detectors fire on a planted defect, the control stays silent,\n'
      + '  and the app is serving the build on disk\n');

    // ── bind the routes ─────────────────────────────────────────────────────────────────────
    const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });
    const [tenant] = await sql<{ id: string; slug: string }[]>`
      SELECT id, slug FROM tenants WHERE slug = 'foundation' LIMIT 1`;
    if (!tenant) { console.error('HARNESS DEFECT: the foundation tenant is missing'); await sql.end(); process.exit(2); }
    const [user] = await sql<{ email: string }[]>`
      SELECT u.email FROM users u
        JOIN user_memberships m ON m.user_id = u.id
       WHERE m.tenant_id = ${tenant.id}::uuid AND u.is_active AND u.role = 'tenant_admin'
       ORDER BY u.created_at LIMIT 1`;
    // A resolver must select for what its consumer NEEDS: the oldest tenant_admin is the stable
    // seeded account, not whichever row a fixture created most recently (B146/B147).
    if (!user) { console.error('HARNESS DEFECT: no tenant_admin for foundation'); await sql.end(); process.exit(2); }

    const bindings: Record<string, string | null> = { '[tenantSlug]': tenant.slug };
    for (const [seg, q] of [
      ['[proposalId]', sql`SELECT id::text v FROM proposals WHERE tenant_id=${tenant.id}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`],
      ['[opportunityId]', sql`SELECT opportunity_id::text v FROM tenant_opportunity_cards WHERE tenant_id=${tenant.id}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`],
      ['[projectId]', sql`SELECT id::text v FROM projects WHERE tenant_id=${tenant.id}::uuid ORDER BY created_at LIMIT 1`],
      ['[portalId]', sql`SELECT id::text v FROM proposal_portals WHERE tenant_id=${tenant.id}::uuid ORDER BY created_at LIMIT 1`],
      ['[vaultId]', sql`SELECT id::text v FROM collaboration_vaults WHERE tenant_id=${tenant.id}::uuid ORDER BY created_at LIMIT 1`],
    ] as const) {
      const [row] = await (q as unknown as Promise<{ v: string }[]>);
      bindings[seg] = row?.v ?? null;
    }
    await sql.end();

    const routes = tenantRoutes();
    const addressable: string[] = [];
    const unbound: string[] = [];
    for (const r of routes) {
      const segs = r.match(/\[[^\]]+\]/g) ?? [];
      if (segs.every((s) => bindings[s])) addressable.push(segs.reduce((acc, s) => acc.replace(s, bindings[s]!), r));
      else unbound.push(r);
    }

    // ── walk ────────────────────────────────────────────────────────────────────────────────
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    await login(page, user.email);

    const findings: Array<Finding & { route: string }> = [];
    for (const route of addressable) {
      try {
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(700);
        for (const f of await measureFinish(page)) findings.push({ ...f, route });
      } catch (e) {
        // Reported, never skipped: a route the probe could not open is uncovered, not clean.
        unbound.push(`${route} — could not open: ${String(e).slice(0, 60)}`);
      }
    }
    await ctx.close();

    // ── report ──────────────────────────────────────────────────────────────────────────────
    console.log(`${addressable.length} customer-facing route(s) read as ${user.email}\n`);
    for (const kind of KINDS) {
      const hits = findings.filter((f) => f.kind === kind);
      console.log(`${hits.length ? '✗' : '✓'} ${kind.padEnd(12)} ${hits.length}`);
      for (const h of hits.slice(0, 8)) console.log(`     ${h.route}  ·  ${h.text}  [${h.where}]`);
      if (hits.length > 8) console.log(`     … and ${hits.length - 8} more`);
    }

    if (unbound.length) {
      console.log(`\n${unbound.length} route(s) NOT read — uncovered, not passing:`);
      for (const u of unbound) console.log(`  · ${u}`);
    }
    console.log('\nWhat this CANNOT see: copy that is wrong rather than malformed, a layout that is '
      + 'ugly, a flow that asks for something twice, or anything behind a click. It reads prose on '
      + 'a page at rest — that is the half a machine can count.');

    process.exit(findings.length ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('probe failed:', e); process.exit(2); });
