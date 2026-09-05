/**
 * FINISH — is what a person sees actually finished, or merely correct?
 *
 * ── THE DIVISION THIS BELONGS TO ─────────────────────────────────────────────────────────────
 * The platform has two halves of one job. This side never trusts and always tests: it counts, it
 * red-tests itself, it refuses verdicts it cannot earn. The in-product companion (`ops_companion`)
 * reads the same evidence and applies judgement about recency, effectiveness and finish — the
 * things that make a system a luxury choice rather than merely a working one. This is the
 * arithmetic that keeps that judgement honest. docs/ADMIN_COMPANION_DESIGN.md §4c.
 *
 * ── WHY IT LOOKS AT PAGES AND NOT AT THE DATABASE ────────────────────────────────────────────
 * Two SQL-shaped versions were written first and both were phantom — the receipts are in the
 * header of `scripts/lib/finish-measure.mts`. Luxury is a property of the rendered page.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────────────────────
 *   brokenValue       NaN · undefined · null · [object Object] · Invalid Date in prose
 *   identifier        a UUID a person can read
 *   jargon            a raw snake_case / dotted system token in prose
 *   rawTimestamp      a machine timestamp where a date belongs
 *   unlabeledControl  a visible button or link with no accessible name
 *   deadEnd           a main region that says there is nothing here and offers no way forward
 *   brokenLink        an internal href that does not answer
 *
 * ── THE LANE DECIDES THE SEVERITY, AND THAT IS NOT A SOFTENING ───────────────────────────────
 * `/admin/events` exists to show you `proposal.section_saved` and a row id. Grading that the same
 * way as a customer's activity feed would bury the real findings under the consoles built to
 * display exactly this, and teach whoever runs it to skip the line — the same failure mode
 * `probe-project-mobile` records for touch targets, and the one B127 records for error text.
 *
 * So: `identifier` · `jargon` · `rawTimestamp` are DEFECTS on a customer surface and INFORMATIONAL
 * on an operator console. `brokenValue`, `deadEnd`, `unlabeledControl` and `brokenLink` are defects
 * everywhere — nobody, at any privilege level, benefits from `NaN`, a link that 404s, or a button
 * with no name.
 *
 * ── AND IT OPENS THINGS ──────────────────────────────────────────────────────────────────────
 * A page at rest is not the UI (docs/UI_STATES.md). Every route is measured twice: at rest, and
 * again with every disclosure, panel and read-only modal opened, using the SAME curated
 * `openEverything` the phone probes use — one definition, and one that is known not to write.
 *
 * ⚠️ READ-ONLY. It signs in, opens read-only things, and reads the DOM. It posts nothing.
 *
 *   cd frontend && npx tsx scripts/probe-customer-finish.mts [--lane=tenant|admin|partner]
 * Exit 0 clean · 1 findings · 2 the harness could not earn a verdict.
 */
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { measureFinish, internalLinks, type Finding } from './lib/finish-measure.mts';
import { openEverything } from './lib/mobile-measure.mts';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const DB = process.env.DATABASE_URL_OWNER || process.env.GUIDE_DB;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const APP = path.resolve(new URL('..', import.meta.url).pathname, 'app');
const ONLY = (process.argv.find((a) => a.startsWith('--lane=')) || '').split('=')[1] || null;

/** Kinds that are defects no matter who is looking. */
const UNIVERSAL: Finding['kind'][] = ['brokenValue', 'deadEnd', 'unlabeledControl', 'brokenLink'];
/** Kinds that are defects only where a CUSTOMER reads them. */
const CUSTOMER_ONLY: Finding['kind'][] = ['identifier', 'jargon', 'rawTimestamp'];
const ALL_KINDS = [...UNIVERSAL, ...CUSTOMER_ONLY];

interface Lane {
  id: string;
  /** Is this a surface a paying customer reads, or a console we operate? */
  customerFacing: boolean;
  root: string;
  prefix: string;
  email: string;
  pw: string;
  /** Per-lane bindings — a tenant lane can only address its OWN rows. */
  bindings: Record<string, string | null>;
  /**
   * When set, walk only the routes containing one of these params. A top-up tenant exists to
   * cover what the primary one could not address; re-walking the other 32 routes as a second
   * customer measures the same components again and buries the new coverage in duplicates.
   */
  onlyParams?: string[];
}

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
    <p>Updated 2026-09-02T00:01:33.433Z</p>
    <button>✕</button>
  </main>`;

/** A page that is definitely fine — and that the naive version of each detector flagged. */
const CONTROL_FIXTURE = `
  <main>
    <h1>Event stream</h1>
    <p>Kate opened the proposal a moment ago. Nancy Nullingsworth approved it.</p>
    <pre>{"code":"NOT_FOUND","tenantId":null,"payload":{"sectionId":null},"at":"2026-09-02T00:01:33.433Z"}</pre>
    <code>proposal:section_saved</code>
    <span style="font-family: ui-monospace, monospace">4137280f-796a-5af1-88dc-7601b74de61c</span>
    <p>Read the annual_report.pdf for details, or visit rfppipeline.com.</p>
    <p>Closed 2026-09-02, three days after it opened.</p>
    <p>No results for that filter.</p>
    <button>Clear filter</button>
    <button aria-label="Dismiss">✕</button>
  </main>`;

/** A dead end needs its own fixture: an empty main with no control at all. */
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
 * A measurement of an unknown build is not a weaker measurement — it is a measurement of
 * something else.
 */
async function servingCurrentBuild(browser: Browser): Promise<string | null> {
  const onDisk = path.join(APP, '..', '.next', 'BUILD_ID');
  let want: string;
  try { want = fs.readFileSync(onDisk, 'utf8').trim(); } catch { return null; }
  const page = await (await browser.newContext()).newPage();
  try {
    const res = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    if (!res || !res.ok()) return `the app at ${BASE} did not answer`;
    if (!(await page.content()).includes(want)) {
      return `serving a DIFFERENT build than .next/BUILD_ID (${want}) — restage .next/static and `
        + 'restart, or every count below describes the previous build';
    }
    return null;
  } finally {
    await page.context().close();
  }
}

/**
 * THE INSTRUMENT BEFORE THE FINDING, and it cuts both ways.
 *
 * Each detector must fire on a fixture built to trip it, AND stay silent on a control that is
 * genuinely fine. Either failure exits 2: a detector that cannot see reports a clean run, and a
 * detector that fires on everything trains the reader to skip the line — the same outcome by a
 * longer road.
 *
 * The control is the sharp half. It holds a `<pre>` with a real JSON payload containing a literal
 * `null` and an ISO stamp, a `<code>` with an event type, a mono span with a UUID, a person named
 * Nullingsworth, a readable date, and an icon button that carries an aria-label. Every one of
 * those was reported by an earlier version of the detector beside it.
 */
async function selfTest(browser: Browser): Promise<string | null> {
  const page = await (await browser.newContext()).newPage();
  try {
    await page.setContent(`<!doctype html><html><body>${BROKEN_FIXTURE}</body></html>`);
    const broken = await measureFinish(page);
    for (const k of ALL_KINDS.filter((k) => k !== 'deadEnd' && k !== 'brokenLink')) {
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
        + control.map((f) => `${f.kind}: ${f.text.slice(0, 70)}`).join(' · ');
    }
    return null;
  } finally {
    await page.context().close();
  }
}

/** Every `page.tsx` under a root, as a route. Same walk as verify-surfaces, same exclusions. */
function routesUnder(root: string, prefix: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel + '/' + e.name);
      else if (e.name === 'page.tsx') out.push((prefix + rel).replace(/\/\(.*?\)/g, '') || prefix);
    }
  };
  walk(root, '');
  return out.sort();
}

async function login(page: Page, email: string, pw: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) throw new Error(`login failed for ${email}`);
}

interface LaneResult {
  lane: Lane;
  read: number;
  findings: Array<Finding & { route: string; opened: boolean }>;
  unreachable: string[];
  openedTotal: number;
  candidateTotal: number;
}

async function walkLane(ctx: BrowserContext, lane: Lane): Promise<LaneResult> {
  const page = await ctx.newPage();
  await login(page, lane.email, lane.pw);

  const bindings = lane.bindings;
  const routes = routesUnder(lane.root, lane.prefix);
  const addressable: string[] = [];
  const unreachable: string[] = [];
  for (const r of routes) {
    const segs = r.match(/\[[^\]]+\]/g) ?? [];
    if (lane.onlyParams && !segs.some((x) => lane.onlyParams!.includes(x))) continue;
    if (segs.every((x) => bindings[x])) addressable.push(segs.reduce((a, x) => a.replace(x, bindings[x]!), r));
    else unreachable.push(`${r} — no value for ${segs.filter((x) => !bindings[x]).join(', ')}`);
  }

  const findings: LaneResult['findings'] = [];
  const seenLinks = new Set<string>();
  const linkQueue: Array<{ href: string; from: string }> = [];
  let openedTotal = 0, candidateTotal = 0;

  for (const route of addressable) {
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);

      // 1 — at rest.
      for (const f of await measureFinish(page)) findings.push({ ...f, route, opened: false });
      for (const href of await internalLinks(page)) {
        if (!seenLinks.has(href)) { seenLinks.add(href); linkQueue.push({ href, from: route }); }
      }

      // 2 — with everything open. A page at rest is not the UI.
      const { opened, candidates } = await openEverything(page);
      openedTotal += opened; candidateTotal += candidates;
      if (opened > 0) {
        for (const f of await measureFinish(page)) findings.push({ ...f, route, opened: true });
      }
    } catch (e) {
      unreachable.push(`${route} — could not open: ${String(e).slice(0, 70)}`);
    }
  }

  // 3 — do the links go anywhere? Same context, so the session travels with the request.
  for (const { href, from } of linkQueue) {
    try {
      const res = await page.request.get(BASE + href, { maxRedirects: 5, timeout: 15_000 });
      if (res.status() >= 400) {
        findings.push({ kind: 'brokenLink', text: `${href} → HTTP ${res.status()}`, where: 'a[href]', route: from, opened: false });
      }
    } catch (e) {
      findings.push({ kind: 'brokenLink', text: `${href} → ${String(e).slice(0, 50)}`, where: 'a[href]', route: from, opened: false });
    }
  }

  await page.close();
  return { lane, read: addressable.length, findings, unreachable, openedTotal, candidateTotal };
}

async function main() {
  if (!DB) { console.error('HARNESS DEFECT: DATABASE_URL_OWNER required'); process.exit(2); }

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const stale = await servingCurrentBuild(browser);
    if (stale) { console.error(`HARNESS DEFECT — ${stale}`); process.exit(2); }
    const bad = await selfTest(browser);
    if (bad) { console.error(`HARNESS DEFECT — ${bad}`); process.exit(2); }
    console.log('✓ self-test: every detector fires on a planted defect, the control stays silent,\n'
      + '  and the app is serving the build on disk\n');

    // ── bind ────────────────────────────────────────────────────────────────────────────────
    //
    // A TENANT LANE CAN ONLY ADDRESS ITS OWN ROWS, so the tenant is chosen by coverage, not
    // hardcoded. The first version pinned `foundation` and reported three routes as "no value for
    // [documentId] / [vaultId] / [foundationId]" — and every one of those rows existed, in a
    // different tenant. "Uncovered" was true and the reason was wrong, which is the kind of
    // finding that gets closed as a fixture problem and never looked at again.
    //
    // So: bind every tenant-scoped param for EVERY tenant that has a signed-in-able admin, walk
    // the one that covers the most, and add a TOP-UP lane per remaining param — walking only the
    // routes that param appears in, because re-walking 32 shared routes as a second customer
    // measures the same components again and buries the new coverage in duplicates.
    const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

    const TENANT_PARAMS = ['[proposalId]', '[opportunityId]', '[projectId]', '[portalId]',
      '[vaultId]', '[contractId]', '[spotlightId]', '[sectionId]', '[documentId]', '[foundationId]'];

    const candidates = await sql<{ id: string; slug: string; email: string }[]>`
      SELECT DISTINCT ON (t.id) t.id, t.slug, u.email
        FROM tenants t
        JOIN user_memberships m ON m.tenant_id = t.id
        JOIN users u ON u.id = m.user_id
       WHERE u.is_active AND u.role = 'tenant_admin'
       ORDER BY t.id, u.created_at`;
    if (!candidates.length) { console.error('HARNESS DEFECT: no tenant has a signed-in-able admin'); await sql.end(); process.exit(2); }

    const one = async (q: Promise<{ v: string }[]>) => (await q)[0]?.v ?? null;
    const perTenant: Record<string, Record<string, string | null>> = {};
    for (const c of candidates) {
      const T = c.id;
      perTenant[c.slug] = {
        '[tenantSlug]': c.slug,
        '[proposalId]': await one(sql`SELECT id::text v FROM proposals WHERE tenant_id=${T}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`),
        '[opportunityId]': await one(sql`SELECT opportunity_id::text v FROM tenant_opportunity_cards WHERE tenant_id=${T}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`),
        '[projectId]': await one(sql`SELECT id::text v FROM projects WHERE tenant_id=${T}::uuid ORDER BY created_at LIMIT 1`),
        '[portalId]': await one(sql`SELECT id::text v FROM proposal_portals WHERE tenant_id=${T}::uuid ORDER BY created_at LIMIT 1`),
        '[vaultId]': await one(sql`SELECT id::text v FROM collaboration_vaults WHERE tenant_id=${T}::uuid ORDER BY created_at LIMIT 1`),
        '[contractId]': await one(sql`SELECT id::text v FROM contracts WHERE tenant_id=${T}::uuid ORDER BY created_at LIMIT 1`),
        '[spotlightId]': await one(sql`SELECT opportunity_id::text v FROM tenant_opportunity_cards WHERE tenant_id=${T}::uuid AND archived_at IS NULL ORDER BY created_at LIMIT 1`),
        '[sectionId]': await one(sql`SELECT s.id::text v FROM proposal_sections s JOIN proposals p ON p.id=s.proposal_id WHERE p.tenant_id=${T}::uuid ORDER BY s.created_at LIMIT 1`),
        '[documentId]': await one(sql`SELECT id::text v FROM tenant_documents WHERE tenant_id=${T}::uuid ORDER BY created_at LIMIT 1`),
        '[foundationId]': await one(sql`SELECT id::text v FROM library_atoms WHERE tenant_id=${T}::uuid AND grain='foundation' ORDER BY created_at LIMIT 1`),
      };
    }
    const covers = (slug: string) => TENANT_PARAMS.filter((k) => perTenant[slug][k]).length;
    const ranked = [...candidates].sort((a, b) => covers(b.slug) - covers(a.slug)
      // Ties break on creation order, not on slug: a scenario tenant created by an earlier drive
      // always wins an alphabetical sort, which is how a probe once signed in as the wrong
      // customer entirely (B147).
      || candidates.indexOf(a) - candidates.indexOf(b));
    const primary = ranked[0];

    const stillMissing = TENANT_PARAMS.filter((k) => !perTenant[primary.slug][k]);
    const topUps: Array<{ slug: string; email: string; params: string[] }> = [];
    for (const k of stillMissing) {
      const owner = ranked.find((c) => c.slug !== primary.slug && perTenant[c.slug][k]);
      if (!owner) continue;
      const existing = topUps.find((t) => t.slug === owner.slug);
      if (existing) existing.params.push(k); else topUps.push({ slug: owner.slug, email: owner.email, params: [k] });
    }

    // ── platform-scope bindings, shared by the admin lane ────────────────────────────────────
    const adminBindings: Record<string, string | null> = {
      '[tenantSlug]': primary.slug,
      '[id]': await one(sql`SELECT id::text v FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`),
      '[solId]': await one(sql`SELECT id::text v FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`),
      // A multi-topic solicitation's topic. `parent_id` does not exist on this table — the shape is
      // `solicitation_type='multi_topic'` plus rows in `solicitation_topics`; checked against the
      // live schema rather than assumed (docs/SCHEMA_MAP.md).
      '[topicId]': await one(sql`SELECT id::text v FROM curated_solicitations WHERE solicitation_type='multi_topic' ORDER BY created_at DESC LIMIT 1`),
      '[profileId]': await one(sql`SELECT id::text v FROM source_profiles ORDER BY created_at LIMIT 1`),
      '[tenantId]': primary.id,
      '[userId]': await one(sql`SELECT id::text v FROM users WHERE is_active ORDER BY created_at LIMIT 1`),
      '[noteId]': await one(sql`SELECT id::text v FROM working_notes ORDER BY created_at DESC LIMIT 1`),
      '[templateId]': await one(sql`SELECT id::text v FROM document_templates ORDER BY created_at LIMIT 1`),
      '[type]': 'blog_post',
      '[slug]': await one(sql`SELECT page_key v FROM content_pages WHERE content_type='blog_post' ORDER BY created_at LIMIT 1`),
      '[pageKey]': await one(sql`SELECT page_key v FROM content_pages WHERE content_type='page' ORDER BY created_at LIMIT 1`),
      '[instanceId]': await one(sql`SELECT id::text v FROM process_instances ORDER BY created_at DESC LIMIT 1`),
      '[p]': await one(sql`SELECT id::text v FROM proposals WHERE archived_at IS NULL ORDER BY created_at LIMIT 1`),
      '[portalId]': await one(sql`SELECT id::text v FROM proposal_portals ORDER BY created_at LIMIT 1`),
      '[documentId]': await one(sql`SELECT id::text v FROM tenant_documents ORDER BY created_at LIMIT 1`),
      '[companyId]': primary.id,
      '[findingId]': await one(sql`SELECT id::text v FROM scout_findings ORDER BY created_at DESC LIMIT 1`),
    };

    const [pa] = await sql<{ email: string }[]>`
      SELECT u.email FROM users u
       WHERE u.role = 'partner_admin' AND u.is_active ORDER BY u.created_at LIMIT 1`;
    await sql.end();

    const TENANT_ROOT = path.join(APP, 'portal', '[tenantSlug]');
    const lanes: Lane[] = [
      { id: `tenant:${primary.slug}`, customerFacing: true, root: TENANT_ROOT, prefix: '/portal/[tenantSlug]', email: primary.email, pw: TENANT_PW, bindings: perTenant[primary.slug] },
      ...topUps.map((t) => ({
        id: `tenant:${t.slug} (top-up ${t.params.join(' ')})`, customerFacing: true, root: TENANT_ROOT,
        prefix: '/portal/[tenantSlug]', email: t.email, pw: TENANT_PW,
        bindings: perTenant[t.slug], onlyParams: t.params,
      })),
      { id: 'admin', customerFacing: false, root: path.join(APP, 'admin'), prefix: '/admin', email: 'eric@rfppipeline.com', pw: ADMIN_PW, bindings: adminBindings },
    ];
    if (pa) lanes.push({ id: 'partner', customerFacing: true, root: path.join(APP, 'partner'), prefix: '/partner', email: pa.email, pw: ADMIN_PW, bindings: adminBindings });

    // ── walk ────────────────────────────────────────────────────────────────────────────────
    const results: LaneResult[] = [];
    for (const lane of lanes.filter((l) => !ONLY || l.id === ONLY || l.id.startsWith(ONLY + ':'))) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
      try { results.push(await walkLane(ctx, lane)); } finally { await ctx.close(); }
    }

    // ── report ──────────────────────────────────────────────────────────────────────────────
    let defects = 0;
    for (const r of results) {
      const grade = (k: Finding['kind']) =>
        UNIVERSAL.includes(k) || r.lane.customerFacing ? 'defect' : 'info';
      console.log(`\n══ ${r.lane.id.toUpperCase()} · ${r.read} route(s) as ${r.lane.email}`
        + `${r.lane.customerFacing ? ' · customer-facing' : ' · operator console'}`);
      console.log(`   opened ${r.openedTotal} of ${r.candidateTotal} candidate control(s) across the lane`);
      for (const kind of ALL_KINDS) {
        const hits = r.findings.filter((f) => f.kind === kind);
        const g = grade(kind);
        if (g === 'defect') defects += hits.length;
        const mark = hits.length === 0 ? '✓' : g === 'defect' ? '✗' : '·';
        console.log(`   ${mark} ${kind.padEnd(17)} ${String(hits.length).padStart(4)}${g === 'info' && hits.length ? '  (informational on a console)' : ''}`);
        const show = g === 'defect' ? 8 : 2;
        // Dedup by text+route so one repeated row does not crowd out a different finding.
        const uniq = [...new Map(hits.map((h) => [`${h.route}|${h.text}`, h])).values()];
        for (const h of uniq.slice(0, show)) {
          console.log(`        ${h.route}${h.opened ? ' [opened]' : ''}  ·  ${h.text.slice(0, 110)}`);
        }
        if (uniq.length > show) console.log(`        … and ${uniq.length - show} more distinct`);
      }
      if (r.unreachable.length) {
        console.log(`   ${r.unreachable.length} route(s) NOT read — uncovered, not passing:`);
        for (const u of r.unreachable) console.log(`      · ${u}`);
      }
    }

    console.log('\nWhat this CANNOT see: copy that is wrong rather than malformed, a layout that is '
      + 'ugly, a flow that asks for something twice, and any state behind a control `openEverything` '
      + 'declines to click because clicking it would write. That residue is the companion\'s half.');
    console.log(defects ? `\n✗ ${defects} defect(s)` : '\n✓ no defects in any graded lane');
    process.exit(defects ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('probe failed:', e); process.exit(2); });
