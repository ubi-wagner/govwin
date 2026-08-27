/**
 * Lens 2 of 3 — the API CONTRACT. Does every GET route return the envelope the SOP promises?
 *
 * `verify-surfaces.mjs` asks whether a PAGE renders. This asks the question underneath it: when the
 * page calls its API, does the API answer in the shape the rest of the codebase is written to
 * expect. CLAUDE.md states the contract in two lines, and they are checkable:
 *
 *     Return consistent shapes: `{ data: T }` success, `{ error: string, code: string }` failure
 *     EVERY error response MUST include both `error` and `code` fields
 *
 * A route that 200s with a bare array, or 500s with `{error}` and no `code`, satisfies every test in
 * the suite and still breaks the caller that destructures `.data` or switches on `.code`. Nothing in
 * the repo checked it until now.
 *
 * Method, and the reason for it: every route is called THROUGH A REAL SESSION (a logged-in browser
 * context, `page.evaluate(fetch)`), not with a forged header. Auth and tenant scoping are part of
 * the contract — a route that answers differently to an anonymous caller is answering a different
 * question, and a 401 harness would grade the wrong thing.
 *
 * Dynamic segments are bound from real rows, and a route that cannot be addressed is REPORTED, not
 * skipped — the same rule the surface sweep learned the hard way.
 *
 *   cd frontend && node scripts/verify-api-contract.mjs
 * Exit 0 if every reachable GET honours the envelope; 1 otherwise.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const APP = '/home/user/govwin/frontend/app/api';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/**
 * Every route.ts under app/ that exports a GET, as a URL path.
 *
 * TWO THINGS THIS GOT WRONG, both the same class — a scope smaller than the claim:
 *
 * 1. **It walked two roots.** `app/api/portal` and `app/api/admin`, called from a hardcoded pair of
 *    actor lanes. Everything else under `app/api` was never enumerated, never called, and never
 *    listed as uncalled — so `/api/partner/*` (the whole partner-manager console), `/api/enter`,
 *    `/api/events`, `/api/invite`, `/api/health` and the public content routes sat outside a lens
 *    whose closing line reads "every reachable GET honours the response contract." Thirteen routes,
 *    invisible. The arithmetic gave it away: 104 called + 12 unbound ≠ the 130 GET routes on disk.
 *
 * 2. **It matched one export form.** `export const GET = withHandler({…})` is not
 *    `export function GET`, so `/api/admin/system` — the master_admin-only one — was skipped in
 *    silence. This is B74 exactly: a matcher that cannot see a construct reports the files
 *    containing it as clean.
 *
 * Now: walk everything, match both forms, and let the CALLER decide the actor lane. Every route
 * ends in exactly one bucket — called, unbound, or unreachable-by-any-configured-actor — and the
 * totals are asserted at the end so this cannot silently drift again.
 */
function getRoutes(root = path.join(APP, '..'), prefix = '') {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel + '/' + e.name);
      else if (/^route\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        const hasGet =
          /export\s+(async\s+)?function\s+GET\b/.test(src) ||
          /export\s+const\s+GET\s*[:=]/.test(src);
        if (hasGet) out.push((prefix + rel).replace(/\/\(.*?\)/g, ''));
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * Which signed-in actor (if any) can reach a route, mirroring middleware's PATH_MIN_ROLE plus its
 * PUBLIC_PATHS list. `null` means "call it with no session" — that is the route's REAL caller, and
 * grading a public route through a logged-in browser would answer a different question than the one
 * its users ask. The header's rule ("call it through a real session") is about not grading an AUTHED
 * route anonymously; it was never an argument for leaving public routes ungraded.
 */
const PUBLIC_PREFIXES = ['/api/health', '/api/waitlist', '/api/content', '/api/analytics', '/api/stripe/webhook', '/blog', '/api/uploads', '/api/invite'];
function laneFor(route) {
  if (PUBLIC_PREFIXES.some((p) => route === p || route.startsWith(p + '/'))) return 'anon';
  if (route.startsWith('/api/portal/')) return 'tenant';
  if (route.startsWith('/api/partner/')) return 'partner';
  if (route.startsWith('/api/admin/') || route.startsWith('/admin/')) return 'admin';
  // Authenticated but role-neutral (/api/enter, /api/events, /api/storage/local/…): any session
  // reaches them, so the tenant lane is a real caller.
  return 'tenant';
}

async function bindings() {
  const [prop] = await sql`
    SELECT p.id, p.opportunity_id, p.solicitation_id, t.slug
    FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.archived_at IS NULL AND t.slug = 'foundation'
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC LIMIT 1`;
  const [sect] = prop ? await sql`
    SELECT id FROM proposal_sections WHERE proposal_id = ${prop.id}
    ORDER BY sort_index ASC NULLS LAST LIMIT 1` : [];
  const [art] = prop ? await sql`SELECT id FROM proposal_artifacts WHERE proposal_id = ${prop.id} LIMIT 1` : [];
  const [atom] = await sql`
    SELECT la.id FROM library_atoms la JOIN tenants t ON t.id = la.tenant_id
    WHERE t.slug = 'foundation' AND la.archived_at IS NULL LIMIT 1`;
  const [bucket] = await sql`
    SELECT b.id FROM tenant_spotlight_buckets b JOIN tenants t ON t.id = b.tenant_id
    WHERE t.slug = 'foundation' LIMIT 1`;
  const [card] = await sql`
    SELECT c.id FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
    WHERE t.slug = 'foundation' AND c.archived_at IS NULL LIMIT 1`;
  // `[cardId]` names TWO different entities in this tree — an opportunity card under /cards, and a
  // TEMPLATE card under /template-cards. One binding for both fed a template route an opportunity
  // id, and its (correct) 404 read as a route that could not see its own data. A shared parameter
  // name is not a shared entity.
  const [tcard] = await sql`
    SELECT tc.id FROM tenant_template_cards tc JOIN tenants t ON t.id = tc.tenant_id
    WHERE t.slug = 'foundation' LIMIT 1`.catch(() => [undefined]);
  const [task] = await sql`SELECT id FROM tasks LIMIT 1`;
  // Scoped to `foundation`, like every other tenant-lane binding. It was `LIMIT 1` over the whole
  // table, which picked an `rfp-pipeline` instance — so the tenant lane graded a 404 that was
  // CORRECT ISOLATION and told us nothing about whether the route can see its own data.
  const [inst] = await sql`
    SELECT pi.id FROM process_instances pi JOIN tenants t ON t.id = pi.tenant_id
    WHERE t.slug = 'foundation' ORDER BY pi.created_at DESC LIMIT 1`;
  const [sol] = await sql`SELECT id FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`;
  const [opp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  const [portal] = await sql`SELECT id FROM proposal_portals ORDER BY created_at DESC LIMIT 1`;
  const [tmpl] = await sql`SELECT id FROM document_templates LIMIT 1`.catch(() => [undefined]);
  const [src] = await sql`SELECT id FROM source_profiles LIMIT 1`.catch(() => [undefined]);
  const [usr] = await sql`
    SELECT u.id FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.slug = 'foundation' LIMIT 1`;
  // Projects (migration 216). Without this the project GETs land in `unbound` — reported,
  // which is the honest outcome, but uncovered rather than passing. A seeded project binds them.
  const [proj] = await sql`
    SELECT d.id FROM projects d JOIN tenants t ON t.id = d.tenant_id
    WHERE t.slug = 'foundation' ORDER BY d.created_at LIMIT 1`.catch(() => [undefined]);
  return {
    projectId: proj?.id,
    tenantSlug: 'foundation', proposalId: prop?.id, sectionId: sect?.id, artifactId: art?.id,
    atomId: atom?.id, bucketId: bucket?.id, cardId: card?.id, taskId: task?.id,
    instanceId: inst?.id, solId: sol?.id, opportunityId: opp?.id, tenantId: tenant?.id,
    templateCardId: tcard?.id,
    portalId: portal?.id, templateId: tmpl?.id, profileId: src?.id, userId: usr?.id,
  };
}

const rows = [];

/**
 * Routes that are NOT JSON APIs and must not be graded as if they were. Both classes were found by
 * widening the walk and then checking every new red against the source — the first output of a
 * widened harness describes the harness, and four of its five findings were this.
 *
 *   · NAVIGATION endpoints emit `NextResponse.redirect` and never `NextResponse.json` (verified:
 *     6/8/4 redirects, 0 json each). `fetch()` from a page context follows the chain into HTML and
 *     reports "Failed to fetch" — a property of the probe, not of the product.
 *   · /api/health is THE ONE documented envelope exception (docs/API_CONVENTIONS.md §"Response
 *     shape", and again in its route-file header): load balancers read a top-level `ok`, so
 *     wrapping it in `{data}` would break every existing probe.
 *
 * Listed with the reason rather than filtered out of the walk, so the count still says what was
 * measured and what was deliberately not.
 */
const NOT_JSON_ROUTES = new Map([
  ['/api/enter', 'navigation — redirect-only, no JSON body to grade'],
  ['/api/partner/enter', 'navigation — redirect-only, no JSON body to grade'],
  ['/api/partner/exit', 'navigation — redirect-only, no JSON body to grade'],
  ['/api/health', 'the ONE documented envelope exception (docs/API_CONVENTIONS.md) — probes read a top-level `ok`'],
]);

/**
 * Grade one response against the SOP envelope.
 *
 * Deliberately NOT graded as a failure: a 401/403/404 with a correct `{error, code}` body. Those are
 * the contract working — a route refusing an actor it should refuse. Only the SHAPE is on trial.
 */
function grade(status, text, ctype = '') {
  if (status === 204 || text.trim() === '') return { ok: true, note: 'empty body' };
  // A FILE download is not an envelope violation — an export route returning docx/xlsx/pdf/zip
  // bytes is behaving correctly, and grading it against `{data}` would invent a defect.
  if (!/json/i.test(ctype)) return { ok: true, note: `binary/${(ctype.split(';')[0] || 'unknown').split('/').pop()}` };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, note: `content-type says JSON but body does not parse (${text.slice(0, 60)})` }; }
  if (status >= 400) {
    const hasErr = typeof body?.error === 'string';
    const hasCode = typeof body?.code === 'string';
    if (hasErr && hasCode) return { ok: true, note: `${status} ${body.code}` };
    return { ok: false, note: `${status} error body missing ${!hasErr ? 'error' : ''}${!hasErr && !hasCode ? '+' : ''}${!hasCode ? 'code' : ''}` };
  }
  if (body && typeof body === 'object' && 'data' in body) return { ok: true, note: 'data' };
  // A success that is not `{data}` — the caller destructuring `.data` gets undefined.
  const shape = Array.isArray(body) ? 'bare array' : body === null ? 'null' : `keys: ${Object.keys(body ?? {}).slice(0, 4).join(',')}`;
  return { ok: false, note: `200 without {data} — ${shape}` };
}

const exempted = [];

/**
 * ── REACHABILITY: a 404 AT A REAL ID IS A FINDING, NOT A PASS ────────────────────────────────
 * The envelope grader above is deliberately blind to status — a 404 with `{error, code}` is the
 * contract working. That blindness has a hole, and it swallowed an entire capability.
 *
 * `projectGate` entered the tenant context from inside an awaited function, where
 * `AsyncLocalStorage.enterWith` does not reach the caller's continuation. Every project route ran
 * with `app.tenant_id` unset, RLS matched nothing, and all twenty handlers answered:
 *
 *     GET   …/projects             → 200 {"data":{"projects":[]}}
 *     GET   …/projects/[id]/clins  → 404 {"error":"Project not found","code":"NOT_FOUND"}
 *
 * Textbook envelopes, every one. This lens graded them GREEN, and so did `verify-write-contract`,
 * whose whole assertion is that a client error answers 4xx with both fields. Five green lenses and
 * a dead API, found by looking at a screenshot of a red toast.
 *
 * The missing question is not about shape: **the ids in these URLs were bound from real rows this
 * actor owns.** A route that answers "not found" at an id its own tenant holds cannot see its own
 * data. Only the tenant lane is graded this way, because only its bindings are known to belong to
 * the actor (`bindings()` scopes proposals, atoms, buckets, cards, users and projects to
 * `foundation`); the admin lane binds platform-wide rows where a 404 can be legitimate.
 */
const REACHABILITY_EXEMPT = new Map([
  // Add a route here ONLY with a reason a 404 at a real, actor-owned id is CORRECT.
]);
const unreachable = [];

async function call(page, url, route, lane) {
  const why = NOT_JSON_ROUTES.get(route);
  if (why) { exempted.push({ route, why }); return true; }
  const r = { url, status: null, ok: false, note: '' };
  try {
    // Return the FULL body and the content-type. The first version sliced to 2000 chars BEFORE
    // parsing, so every response longer than that failed JSON.parse and was reported as "not JSON"
    // — 38 of them, every one a well-formed `{data:…}`. Truncation is for DISPLAY only; the grader
    // must see what the caller sees. (Same class as everything else this session: the instrument
    // lying, and the lie looking exactly like a product defect.)
    const res = await page.evaluate(async (u) => {
      const resp = await fetch(u, { headers: { accept: 'application/json' } });
      return { status: resp.status, ctype: resp.headers.get('content-type') ?? '', text: await resp.text() };
    }, url);
    r.status = res.status;
    const g = grade(res.status, res.text, res.ctype);
    r.ok = g.ok; r.note = g.note;
    // Reachability — see the block above. Dynamic segments only: a 404 on a STATIC route is a
    // route that does not exist for this actor, which is a different (and legitimate) fact.
    if (lane === 'tenant' && res.status === 404 && /\[/.test(route)
        && !REACHABILITY_EXEMPT.has(route)) {
      unreachable.push({ route, url, note: (() => {
        try { return JSON.parse(res.text)?.error ?? ''; } catch { return ''; }
      })() });
    }
  } catch (e) {
    r.note = String(e.message).slice(0, 60);
  }
  rows.push(r);
  if (!r.ok) console.log(`  ✗ ${url.padEnd(62)} ${String(r.status ?? '—').padStart(3)}  ${r.note}`);
  return r.ok;
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2500);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

console.log(`· serving ${BASE} · binding ids from ${DB.replace(/:[^:@/]*@/, ':***@')}`);
const B = await bindings();
// Per-route binding overrides, for parameter names that mean different entities in different
// subtrees. `[cardId]` is the only one so far; the collision cost a phantom finding.
const BIND_OVERRIDES = [[/^\/api\/portal\/\[tenantSlug\]\/template-cards\//, { cardId: 'templateCardId' }]];
const bind = (r) => {
  const over = BIND_OVERRIDES.find(([re]) => re.test(r))?.[1] ?? {};
  return r.replace(/\[(\.\.\.)?(\w+)\]/g, (_, __, k) => B[over[k] ?? k] ?? `[${k}]`);
};
const addressable = (r) => !/\[/.test(bind(r));
const unbound = [];

// One enumeration of the whole tree, partitioned into lanes. Every route lands in exactly one
// bucket and the arithmetic is asserted below — the check that would have caught the old scope gap.
const ALL_ROUTES = getRoutes();
const LANES = [
  ['anon', 'public · no session', null, null],
  ['tenant', 'tenant · tenant_admin', 'kate.ulepic@foundation3dp.com', 'DemoPass123!'],
  ['partner', 'partner · partner_admin', 'pjackson@ecinnovates.com', ADMIN_PW],
  ['admin', 'admin · master_admin', 'eric@rfppipeline.com', ADMIN_PW],
];
const noActor = [];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  for (const [lane, label, email, pw] of LANES) {
    const mine = ALL_ROUTES.filter((r) => laneFor(r) === lane);
    if (!mine.length) continue;
    console.log(`\n── ${label} ──`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let p;
    try {
      // The anonymous lane deliberately does NOT log in — a public route's real caller has no
      // session, and that is the only way its 401/404 envelope is ever graded.
      p = email ? await login(ctx, email, pw) : await ctx.newPage();
      if (!email) await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.log(`  ✗ lane unavailable — ${String(e.message).slice(0, 80)}`);
      for (const r of mine) noActor.push(`${r} (lane ${lane}: ${String(e.message).slice(0, 40)})`);
      await ctx.close();
      continue;
    }
    let n = 0;
    for (const route of mine) {
      if (!addressable(route)) { unbound.push(route); continue; }
      await call(p, bind(route), route, lane); n += 1;
    }
    console.log(`  (${n} route(s) called)`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await sql.end();
}

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length} GET route(s) called · ${rows.length - bad.length} honour the envelope · ${bad.length} do not`);
if (unbound.length) {
  console.log(`\n${unbound.length} route(s) NOT called — no row to bind their parameters:`);
  for (const r of unbound) console.log(`  · ${r}`);
}
if (noActor.length) {
  console.log(`\n${noActor.length} route(s) NOT called — no actor could be signed in for their lane:`);
  for (const r of noActor) console.log(`  · ${r}`);
}

// THE ACCOUNTING. Every GET on disk must end up called, unbound, or actor-less. The previous
// version could not have failed this, because it never counted what it had enumerated — and that
// is precisely how thirteen routes stayed outside a lens that reported on "every reachable GET".
// A coverage claim that does not reconcile against the tree is a claim about the harness.
const accounted = rows.length + unbound.length + noActor.length + exempted.length;
console.log(`\ncoverage: ${ALL_ROUTES.length} GET route(s) on disk · ${rows.length} graded · ${exempted.length} exempt · ${unbound.length} unbound · ${noActor.length} no actor`);
if (exempted.length) {
  console.log(`\n${exempted.length} route(s) EXEMPT — not JSON APIs, with the reason stated:`);
  for (const e of exempted) console.log(`  \u00b7 ${e.route} — ${e.why}`);
}
if (accounted !== ALL_ROUTES.length) {
  console.log(`\n✗ HARNESS DEFECT — ${ALL_ROUTES.length - accounted} route(s) enumerated but neither called nor reported.`);
  console.log('  Fix the lens before believing any verdict it prints.');
  process.exit(2);
}

if (unreachable.length) {
  console.log(`\n✗ ${unreachable.length} route(s) answered 404 AT AN ID THIS TENANT OWNS:`);
  for (const u of unreachable) console.log(`  · ${u.route}  →  ${u.url}  ${u.note ? `"${u.note}"` : ''}`);
  console.log('  Every id above was bound from a real `foundation` row. A route that cannot find its');
  console.log("  own tenant's data is not refusing a caller — it is not seeing the data. That is how");
  console.log('  twenty project handlers ran unscoped behind twenty textbook `{error,code}` envelopes.');
  console.log('  If a 404 here is genuinely correct, add the route to REACHABILITY_EXEMPT with a reason.');
}

if (bad.length) {
  console.log('\n✗ envelope violations (the SOP: {data} on success · {error,code} on failure):');
  for (const r of bad) console.log(`  · ${r.url} — ${r.note}`);
}
if (bad.length || unreachable.length) process.exit(1);
console.log('\n✓ every reachable GET honours the response contract, and answers at an id its tenant owns.');
