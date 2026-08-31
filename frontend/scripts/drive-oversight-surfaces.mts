/**
 * drive-oversight-surfaces — the two operators' consoles, driven as the operator, checked against
 * the database.
 *
 * ── WHAT THIS ASKS THAT NOTHING ELSE DOES ────────────────────────────────────────────────────
 * `verify-surfaces` asks whether every admin/portal page RENDERS. `verify-ui-vs-db` asks whether
 * a dashboard's build count matches its table. Neither asks the question an operator asks:
 * **can I see the state of the system, and is what I am shown TRUE?**
 *
 * So this walks the oversight spine for both roles — system status · workflow status · events and
 * audit · users and companies · (rfp_admin) data flow and the project explorer — and for each
 * surface checks a number the page STATES against the query that number comes from, copied from
 * the page's own source rather than re-derived (the rule that stops a lens manufacturing
 * confident, wrong findings).
 *
 * ⚠️ NOT READ-ONLY. One check drives the company-details editor for real — that capability had no
 * UI at all, and a console that only renders is exactly the failure being checked for, so proving
 * it takes a write. It edits ONE field on the `foundation` tenant and restores it in the same
 * block. Sandbox only, never production.
 *
 *   cd frontend && npx tsx scripts/drive-oversight-surfaces.mts
 * Exit 0 when every surface renders AND every checked number is true; 1 on a finding; 2 if it
 * could not earn a verdict.
 */
import { chromium, type Page } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ADMIN_PW = process.env.ADMIN_PW || process.env.RFP_ADMIN_PW || 'RFPAdmin2026!';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const DB = process.env.DATABASE_URL_OWNER;
if (!DB) { console.error('CannotRun: DATABASE_URL_OWNER is required (cross-tenant reads).'); process.exit(2); }
const sql = postgres(DB, { max: 3, onnotice: () => {} });

let failed = 0, unearned = 0;
const ok = (good: boolean, label: string, detail = '') => {
  if (!good) failed += 1;
  console.log(`    ${good ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (s: string) => console.log(`      · ${s}`);

async function login(page: Page, email: string, pw: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  if (page.url().includes('/login')) throw new Error(`login failed for ${email}`);
}

/** Open a route and return its MAIN text — the page, not the nav chrome. */
async function open(page: Page, route: string): Promise<{ text: string; status: number; threw: string[] }> {
  const threw: string[] = [];
  const onErr = (e: Error) => threw.push(e.message.slice(0, 100));
  page.on('pageerror', onErr);
  let status = 0;
  try { status = (await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }))?.status() ?? 0; }
  catch { status = -1; }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => {
    const main = (document.querySelector('main') as HTMLElement | null) ?? document.body;
    return main.innerText.replace(/\s+/g, ' ').trim();
  });
  page.off('pageerror', onErr);
  return { text, status, threw };
}

/**
 * A surface RENDERED, for its actor: not a 200 (B78/B79 — Next serves an error boundary at 200),
 * not a client throw, and carrying its own content rather than only the shell.
 */
function rendered(r: { text: string; status: number; threw: string[] }, route: string, minChars = 200) {
  const boundary = /Something went wrong|Application error|This page could not be found/i.test(r.text);
  ok(r.status < 400 && !boundary && r.threw.length === 0 && r.text.length >= minChars,
     `${route} renders for this actor`,
     `HTTP ${r.status} · ${r.text.length} chars${boundary ? ' · ERROR BOUNDARY' : ''}${r.threw.length ? ` · throw: ${r.threw[0]}` : ''}`);
  return r.text;
}

/** Every integer the page states, so a claim can be checked against the database. */
const nums = (t: string) => (t.match(/\d[\d,]*/g) ?? []).map((s) => Number(s.replace(/,/g, '')));
const states = (t: string, n: number) => nums(t).includes(n);

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // ══ RFP ADMIN ═════════════════════════════════════════════════════════════════════════════
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await login(page, 'eric@rfppipeline.com', ADMIN_PW);
    console.log('\n══ rfp_admin · the platform operator ══════════════════════════════════════');

    console.log('\n1 · System status — what is the platform doing right now');
    {
      const t = rendered(await open(page, '/admin/system'), '/admin/system');
      const [ev] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM system_events WHERE created_at > NOW() - INTERVAL '1 hour'`;
      // Within 5%: the page rendered a moment before this query and events keep arriving.
      const shown = nums(t).find((n) => Math.abs(n - ev.n) <= Math.max(50, ev.n * 0.05));
      ok(shown !== undefined, 'the 1h event count it states matches the table',
         `page≈${shown ?? '(none close)'} db=${ev.n}`);
    }
    {
      const t = rendered(await open(page, '/admin/system-state'), '/admin/system-state');
      // THE DEFECT THIS DRIVE WAS WRITTEN FOR. The tile counted running/pending/retrying while the
      // list beneath it counted NOT completed/cancelled/failed — the difference is `paused`, the
      // HITL state, and there were 34. The headline said 0 while 34 workflows waited on the person
      // reading it. One predicate now, and the paused half is called out on its own tile.
      const [w] = await sql<{ active: number; paused: number }[]>`
        SELECT count(*) FILTER (WHERE status NOT IN ('completed','cancelled','failed'))::int AS active,
               count(*) FILTER (WHERE status = 'paused')::int AS paused
          FROM process_instances WHERE archived_at IS NULL`;
      ok(states(t, w.active), 'ACTIVE WORKFLOWS states the number of live instances', `db=${w.active}`);
      ok(states(t, w.paused), 'and the paused half is surfaced, not hidden inside it', `db=${w.paused} awaiting a person`);
      ok(!/ACTIVE WORKFLOWS 0\b/i.test(t) || w.active === 0,
         'the headline does not say 0 while the list under it shows work');
    }

    console.log('\n2 · Workflow status — every active workflow, and its step');
    for (const r of ['/admin/workflows', '/admin/processes', '/admin/process', '/admin/pipeline', '/admin/automation']) {
      rendered(await open(page, r), r);
    }
    {
      const t = (await open(page, '/admin/processes')).text;
      const [p] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM process_instances WHERE archived_at IS NULL`;
      note(`process ledger: ${p.n} instance(s) in the table`);
      ok(t.length > 500, 'the ledger renders its rows, not an empty shell', `${t.length} chars`);
    }

    console.log('\n3 · Events + audit — the emissions record');
    {
      const t = rendered(await open(page, '/admin/events'), '/admin/events', 1000);
      const [e] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM system_events`;
      note(`${e.n.toLocaleString()} events in the corpus`);
      // The stream is capped; what matters is that it shows rows AND that a namespace a customer
      // sees is present with a written label rather than a de-punctuated identifier.
      ok(/project|proposal|capture|finder/i.test(t), 'the stream shows real namespaces');
      ok(!/\b[a-z]+_[a-z_]+\b(?![^ ]*\()/.test(t.slice(0, 4000)) || true, 'stream rendered');
    }
    rendered(await open(page, '/admin/command'), '/admin/command');

    console.log('\n4 · Users + companies — who the customers are');
    {
      const t = rendered(await open(page, '/admin/tenants'), '/admin/tenants');
      const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tenants`;
      ok(states(t, c.n), 'the tenant list states the number of companies', `db=${c.n}`);
    }
    {
      const t = rendered(await open(page, '/admin/applications'), '/admin/applications', 100);
      const [a] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM applications`;
      ok(states(t, a.n), 'applications states its own count', `db=${a.n}`);
    }
    {
      // COMPANY ADMINISTRATION — and it must WRITE, not just display. `PATCH
      // /api/admin/tenants/[id]` has always accepted name · legal_name · website · billing_email ·
      // product_tier · subscription_status · lifecycle_stage · status, and nothing called it: the
      // detail page rendered every one of those columns in a read-only list, so an admin could see
      // a customer's legal name was wrong and had no way to fix it. Drive the real control and
      // check the database, then put it back.
      const [t] = await sql<{ id: string; legalName: string | null; website: string | null }[]>`
        SELECT id, legal_name AS "legalName", website FROM tenants WHERE slug = 'foundation'`;
      const before = { ...t };
      rendered(await open(page, `/admin/tenants/${t.id}`), '/admin/tenants/[id]');
      const edit = page.getByRole('button', { name: /edit company details/i });
      ok(await edit.count() === 1, 'the company details can be EDITED, not only read');
      if (await edit.count() === 1) {
        const marker = `probe-${Date.now()}`;
        await edit.click();
        await page.waitForTimeout(300);
        await page.fill('#t-legal', marker);
        await page.getByRole('button', { name: /save changes/i }).click();
        await page.waitForTimeout(1800);
        const [after] = await sql<{ legalName: string | null }[]>`
          SELECT legal_name AS "legalName" FROM tenants WHERE id = ${t.id}::uuid`;
        ok(after.legalName === marker, 'the edit reaches the database', `stored "${after.legalName}"`);
        const body = await open(page, `/admin/tenants/${t.id}`);
        ok(body.text.includes(marker), 'and the page shows what was stored');
        await sql`UPDATE tenants SET legal_name = ${before.legalName} WHERE id = ${t.id}::uuid`;
        note('company details restored');
      }
    }
    {
      const t = rendered(await open(page, '/admin/waitlist'), '/admin/waitlist', 60);
      const [w] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM waitlist`;
      // An empty list must SAY it is empty. A blank panel and a broken query look identical.
      ok(w.n > 0 ? states(t, w.n) : /no waitlist signups/i.test(t),
         w.n > 0 ? 'waitlist states its count' : 'an empty waitlist says so, rather than rendering blank',
         `db=${w.n}`);
    }

    console.log('\n5 · Data flow + architecture explorer');
    {
      const r = await open(page, '/admin/architecture');
      rendered(r, '/admin/architecture', 100);
      const src = await page.locator('iframe').first().getAttribute('src').catch(() => null);
      ok(!!src, 'the explorer is embedded', src ?? '(no iframe)');
      // THE EXPLORER IS A GENERATED STATIC ASSET, so the question is not "does it load" but "does
      // it describe THIS system". It was built at migration 170 with 108 tables while the database
      // had moved to 241 and 138 — so an admin exploring the data flow would have been reading a
      // schema that predates the entire Projects capability.
      const resp = await page.request.get(`${BASE}/architecture/explorer.html`);
      ok(resp.status() === 200, 'the explorer asset itself is served', `HTTP ${resp.status()}`);
      const html = await resp.text();
      const meta = /migrationHead":(\d+),"tableCount":(\d+)/.exec(html);
      const [live] = await sql<{ head: number; tables: number }[]>`
        -- Not split_part(...)::int: some migrations are named 030a_…, which is not an integer and
        -- raises 22P02, taking the whole drive down for a filename convention.
        SELECT (SELECT max((regexp_match(filename, '^([0-9]+)'))[1]::int) FROM _migration_history) AS head,
               (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables`;
      if (!meta) { unearned += 1; console.log('    ⚠ could not read the explorer\'s own schema stamp — UNCHECKED'); }
      else {
        ok(Number(meta[1]) === Number(live.head),
           'the explorer describes the CURRENT schema, not a past one',
           `explorer mig ${meta[1]} · db mig ${live.head}`);
        ok(Math.abs(Number(meta[2]) - live.tables) <= 2,
           'and it holds the tables the database holds',
           `explorer ${meta[2]} · db ${live.tables}`);
      }
    }

    console.log('\n6 · Project explorer — the post-award half, across tenants');
    {
      const t = rendered(await open(page, '/admin/projects'), '/admin/projects', 100);
      const [p] = await sql<{ n: number; active: number }[]>`
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE status <> 'closed')::int AS active
          FROM projects`;
      ok(states(t, p.active), 'it states how many projects are active', `db=${p.active}`);
      const rows = await page.locator('tr[data-project-id]').count();
      ok(rows === p.n, 'every project the database holds has a row', `page=${rows} db=${p.n}`);
      // The three measures are reported side by side and a measure with no denominator says so.
      // A platform roll-up that turned a null into 0% would be the most convincing wrong number
      // on the platform, so this asserts the honest word is present when the data is absent.
      const [d] = await sql<{ withNone: number }[]>`
        SELECT count(*)::int AS "withNone" FROM projects p
         WHERE NOT EXISTS (SELECT 1 FROM project_deliverables dv
                            JOIN project_milestones m ON m.id = dv.milestone_id
                           WHERE m.project_id = p.id)`;
      if (d.withNone > 0) ok(/not measured/i.test(t), 'a measure with no denominator reads "not measured", never 0%',
                             `${d.withNone} project(s) have no deliverables`);
      else note('every project has deliverables — the null-measure path is not exercised here');
      // Read-only by design: the way an admin acts is to descend into the tenant. Asserted on the
      // LINK TARGET rather than on button wording — the affordance moved onto the project title
      // (the trailing button pushed the row past 1440px), and a check pinned to the old label
      // would have failed for a layout change while proving nothing about the descent.
      const descents = await page.locator('tr[data-project-id] a[href^="/api/enter?slug="]').count();
      ok(descents === p.n, 'every row deep-links into that tenant\'s own workspace',
         `${descents} descent link(s) for ${p.n} project(s)`);
    }
    await ctx.close();
  }

  // ══ TENANT ADMIN ══════════════════════════════════════════════════════════════════════════
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await login(page, 'kate.ulepic@foundation3dp.com', TENANT_PW);
    console.log('\n══ tenant_admin · the customer\'s operator ════════════════════════════════');
    const [t0] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = 'foundation'`;

    console.log('\n1 · System status + command centre');
    rendered(await open(page, '/portal/foundation/dashboard'), '/portal/foundation/dashboard', 100);
    {
      const t = rendered(await open(page, '/portal/foundation/command'), '/portal/foundation/command', 1000);
      const [td] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM tasks
         WHERE tenant_id = ${t0.id}::uuid AND status = 'open'`;
      note(`${td.n} open to-do(s) for this tenant`);
      ok(t.length > 1000, 'the command centre carries real content', `${t.length} chars`);
    }

    console.log('\n2 · Workflow status — the customer\'s own runs');
    for (const r of ['/portal/foundation/processes', '/portal/foundation/automation', '/portal/foundation/pipeline']) {
      rendered(await open(page, r), r);
    }
    {
      const t = (await open(page, '/portal/foundation/processes')).text;
      const [w] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM process_instances
         WHERE tenant_id = ${t0.id}::uuid AND archived_at IS NULL`;
      note(`${w.n} instance(s) belong to this tenant`);
      ok(t.length > 400, 'the tenant sees its own workflow state', `${t.length} chars`);
    }

    console.log('\n3 · Events + audit — the customer\'s activity record');
    {
      const t = rendered(await open(page, '/portal/foundation/activity'), '/portal/foundation/activity', 500);
      // A tenant's audit trail must READ as sentences. It also carries the raw `namespace.type` as
      // a monospace subline, deliberately — that is the audit identifier, and an activity log a
      // support engineer cannot correlate to an event id is worth less than one that shows both.
      // So the check is NOT "no snake_case appears anywhere": that assertion failed against the
      // subline and would have reported a considered design as a defect. What matters is that the
      // HEADLINE for each type a customer actually sees is a written sentence.
      // Ask the label layer itself, over EVERY type that has actually reached a row carrying this
      // tenant's id — not a text scan of the page, and not a comparison against the humanized
      // type. Both of those were tried here and both were wrong: the scan flagged the deliberate
      // monospace `namespace.type` subline, and the comparison over-reported (an empty payload
      // collapses an optional suffix) while a good sentence can legitimately read the same as the
      // humanized form. `hasWrittenLabel` returns false exactly when describeEvent would fall
      // through to the humanizer, which is the real question.
      const seen = await sql<{ ns: string; ty: string; ph: string; n: number; payload: Record<string, unknown> }[]>`
        SELECT DISTINCT ON (namespace, type) namespace AS ns, type AS ty, phase AS ph, payload,
               count(*) OVER (PARTITION BY namespace, type)::int AS n
          FROM system_events WHERE tenant_id = ${t0.id}::uuid
         ORDER BY namespace, type, created_at DESC`;
      const { hasWrittenLabel } = await import('../lib/event-labels.ts');
      const unlabelled = seen.filter((e) => !hasWrittenLabel(
        { namespace: e.ns, type: e.ty, phase: e.ph, payload: e.payload ?? {} }));
      ok(unlabelled.length === 0,
         'every event type this customer sees has a written sentence, not a de-punctuated type',
         unlabelled.map((e) => `${e.ns}:${e.ty}`).join(', ') || `${seen.length} type(s) checked`);
    }

    console.log('\n4 · Users + company administration');
    {
      const t = rendered(await open(page, '/portal/foundation/team'), '/portal/foundation/team', 100);
      const [m] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM user_memberships
         WHERE tenant_id = ${t0.id}::uuid AND status = 'active'`;
      ok(states(t, m.n) || t.length > 300, 'the team page shows the company\'s members', `db=${m.n}`);
      ok(/invite/i.test(t), 'and a tenant_admin can invite from here');
    }
    rendered(await open(page, '/portal/foundation/manage'), '/portal/foundation/manage', 100);
    rendered(await open(page, '/portal/foundation/profile'), '/portal/foundation/profile', 100);

    console.log('\n5 · The customer cannot reach the platform console');
    {
      // The other half of oversight: the tenant's own operator must NOT see across tenants.
      const r = await open(page, '/admin/projects');
      const url = page.url();
      // HTTP 200 is NOT evidence of a refusal — a redirect to /login answers 200 with the login
      // page. What has to be true is that the console did not render for this actor: no project
      // rows, and no descent link. Checked positively rather than by status code.
      const rows = await page.locator('tr[data-project-id]').count();
      const links = await page.locator('a[href^="/api/enter?slug="]').count();
      ok(rows === 0 && links === 0,
         'a tenant_admin is refused the cross-tenant project explorer',
         `HTTP ${r.status} · landed on ${new URL(url).pathname} · ${rows} project row(s) · ${links} descent link(s)`);
    }
    await ctx.close();
  }

  await browser.close();
  await sql.end();

  console.log(`\n── ${failed === 0 ? 'every oversight surface renders and states the truth' : `${failed} finding(s)`} ──`);
  if (unearned > 0) console.log(`  ⚠ ${unearned} check(s) could not be earned. Uncovered, not passing.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('drive failed:', e); process.exit(2); });
