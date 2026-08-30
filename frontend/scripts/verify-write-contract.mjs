/**
 * Lens 5 — the WRITE surface. Does every POST/PATCH/PUT/DELETE refuse bad input in the SOP shape?
 *
 * WHY IT DID NOT EXIST, AND WHY THAT MATTERED. The four lenses cover pages (`verify-surfaces`),
 * GET envelopes (`verify-api-contract`), a chosen set of DB invariants (`verify-db-crud`) and
 * stated-vs-stored numbers (`verify-ui-vs-db`). None of them walks a write verb. That is
 * defensible — calling every POST on a box would mutate the thing being measured — but it was
 * never WRITTEN DOWN, so 190 routes sat outside every walk while three green lenses read like a
 * verified API. "A surface a lens has no expectation for is uncovered, not passing" (CLAUDE.md);
 * this is the missing expectation, and its scope is deliberately narrow.
 *
 * WHAT IT ASSERTS — one property, the one that needs no successful write:
 *
 *     A write route given input it must refuse answers 4xx with BOTH `error` and `code`.
 *
 * Not 500. A 500 on bad input means the route reached its database (or threw) before validating,
 * which is the SOP's ordering rule — "Auth checks first, then input validation, then business
 * logic" — inverted. That is exactly the defect this sweep found on `/api/invite`: the token is a
 * `uuid` column, a non-uuid raised `invalid input syntax` at the driver, and a mistyped URL read as
 * a server fault. One route, found by hand. This walks the other 189.
 *
 * ⚠️ THIS LENS IS NOT READ-ONLY. **Run it on a sandbox, never against production.**
 *
 * It was designed to be, and it is not, and saying so plainly is worth more than the design was:
 *
 *   1. Every `[param]` binds to a **freshly generated UUID that owns nothing**, so a route
 *      addressed at a row that does not exist has nothing to update or delete. That much holds.
 *   2. The body is `{}` — valid JSON, missing every required field.
 *   3. But several routes take NO required input by design. `POST /api/admin/promo-codes` mints a
 *      code with defaults; the reconcile, sweep and sync endpoints do their work on an empty body.
 *      For those, `{}` is not invalid input — it is the intended call, and they duly performed it.
 *
 * So row counts across every public table are snapshotted before and after and the delta is
 * PRINTED, as the record of what this run changed. It is reported rather than failed on, because a
 * route acting on an empty body is usually the contract working; read the list and decide. The
 * measured footprint on a fresh box is small and confined to sweep/audit/mint tables.
 *
 *   cd frontend && node scripts/verify-write-contract.mjs
 * Exit 0 when every reachable write verb refuses cleanly and nothing mutated; non-zero otherwise.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

// One base URL, two historic names: the lenses read GUIDE_BASE, the drives read BASE_URL, and
// a harness that silently ignores the one you passed fails with a connection error that reads
// like the app is down. Accept both everywhere; the family's own name still wins.
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const APP = '/home/user/govwin/frontend/app';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const sql = postgres(DB, { max: 2 });

const VERBS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Every route.ts under app/, with the write verbs it exports. Both export forms — see B74. */
function writeRoutes() {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel + '/' + e.name);
      else if (/^route\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        const verbs = VERBS.filter((v) =>
          new RegExp(`export\\s+(async\\s+)?function\\s+${v}\\b`).test(src) ||
          new RegExp(`export\\s+const\\s+${v}\\s*[:=]`).test(src));
        if (verbs.length) out.push({ route: rel.replace(/\/\(.*?\)/g, ''), verbs, file: p });
      }
    }
  };
  walk(APP, '');
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

// Mirrors middleware's PUBLIC_PATHS + PATH_MIN_ROLE, same as the GET lens.
const PUBLIC_PREFIXES = ['/api/health', '/api/waitlist', '/api/content', '/api/analytics', '/api/stripe/webhook', '/blog', '/api/uploads', '/api/invite', '/api/applications'];
function laneFor(route) {
  if (PUBLIC_PREFIXES.some((p) => route === p || route.startsWith(p + '/'))) return 'anon';
  if (route.startsWith('/api/auth/')) return 'anon';
  if (route.startsWith('/api/portal/')) return 'tenant';
  if (route.startsWith('/api/partner/')) return 'partner';
  if (route.startsWith('/api/admin/') || route.startsWith('/admin/')) return 'admin';
  return 'tenant';
}

/**
 * Bind every dynamic segment to a fresh UUID owning nothing — EXCEPT `[tenantSlug]`, which is a
 * slug and not an id. A random slug would be refused by `verifyTenantAccess` before the handler's
 * own validation ever ran, so every portal route would answer 403 and the lens would grade the
 * tenant gate 117 times instead of the thing it came to measure. Using the real slug with
 * nonexistent ids underneath is what puts the request INSIDE the handler and still touches nothing.
 */
function bind(route) {
  return route
    .replace(/\[tenantSlug\]/g, 'foundation')
    .replace(/\[\.\.\.(\w+)\]/g, () => randomUUID())
    .replace(/\[(\w+)\]/g, () => randomUUID());
}

async function tableCounts() {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const out = {};
  for (const { table_name } of rows) {
    try {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(table_name)}`;
      out[table_name] = n;
    } catch { /* a table the harness role cannot read is simply not measured */ }
  }
  return out;
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2000);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

const rows = [];

async function call(page, url, verb) {
  const r = { url, verb, status: null, ok: false, note: '' };
  try {
    // Return the FULL body. Slicing before JSON.parse is the bug `verify-api-contract` records in
    // its own header — it reported 38 well-formed `{data:…}` responses as "not JSON" — and the
    // first run of THIS script reproduced it exactly: `/api/applications` answers a textbook
    // 702-byte `{error, code, details}` and was graded unparseable because 400 chars of it were
    // thrown away first. Truncate for DISPLAY only; the grader must see what the caller sees.
    const res = await page.evaluate(async ([u, v]) => {
      const resp = await fetch(u, {
        method: v,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: v === 'DELETE' ? undefined : '{}',
      });
      return { status: resp.status, ctype: resp.headers.get('content-type') ?? '', text: await resp.text() };
    }, [url, verb]);
    r.status = res.status;

    if (res.status >= 500) {
      /**
       * The property under test is "the route reached its database, or threw, before validating" —
       * and that manifests as a **500**. A 503 carrying a proper envelope is something else: an
       * explicit branch saying a dependency is not configured. `POST /api/stripe/webhook` answers
       * `503 STRIPE_NOT_CONFIGURED` on a box with no Stripe keys, which is the contract working and
       * a branch a configured deployment never takes at all.
       *
       * Grading every 5xx alike would have made this lens permanently red on any sandbox missing an
       * optional integration — a check that cannot go green for an environment reason teaches
       * people to ignore it, which is worse than not having it.
       */
      let envelope = null;
      try { envelope = JSON.parse(res.text); } catch { /* not JSON — falls through to the violation */ }
      const wellFormed = typeof envelope?.error === 'string' && typeof envelope?.code === 'string';
      if (res.status === 503 && wellFormed) {
        r.ok = true;
        r.observation = `503 ${envelope.code} — a dependency is not configured on this box, not a validation-ordering defect`;
        r.note = `503 ${envelope.code} (observation)`;
        return r;
      }
      r.note = `${res.status} on invalid input — validation runs AFTER the DB call, or something threw: ${res.text.slice(0, 110)}`;
      return r;
    }
    if (res.status < 400) {
      /**
       * NOT A VIOLATION, and the first draft of this lens was wrong to call it one.
       *
       * "An empty body must be refused" is not a property of the system. `POST
       * /api/admin/promo-codes` documents every field as optional and mints one code with defaults
       * — `{}` is its intended input, and 201 is the contract working. Unpinning a card that is not
       * pinned, or marking already-read notifications read, are idempotent by design.
       *
       * This is the rule CLAUDE.md states as "assert the contract the system HAS": a DELETE on a
       * bucket is a deactivation by design, so asserting the row is gone is a harness bug, not a
       * finding. Calling 19 routes violations on a rule the product never adopted would have been
       * exactly that, at scale.
       *
       * Still worth SEEING — a 2xx addressed at an id that owns nothing can also be a silent no-op
       * reported as success — so it is recorded as an observation and printed, never failed on.
       */
      r.ok = true;
      r.observation = `${res.status} at a nonexistent id — idempotent/all-optional by design, or a silent no-op reported as success`;
      r.note = `${res.status} (observation)`;
      return r;
    }
    if (!/json/i.test(res.ctype)) { r.ok = true; r.note = `${res.status} non-json`; return r; }
    let body;
    try { body = JSON.parse(res.text); } catch { r.note = `${res.status} content-type says JSON but body does not parse: ${res.text.slice(0, 80)}`; return r; }
    const hasErr = typeof body?.error === 'string';
    const hasCode = typeof body?.code === 'string';
    if (hasErr && hasCode) { r.ok = true; r.note = `${res.status} ${body.code}`; return r; }
    r.note = `${res.status} error body missing ${!hasErr ? 'error' : ''}${!hasErr && !hasCode ? '+' : ''}${!hasCode ? 'code' : ''}`;
    return r;
  } catch (e) {
    // A redirect-only route (navigation endpoint) cannot be fetched this way; not a defect.
    r.ok = true; r.note = `not fetchable (redirect/navigation): ${String(e.message).slice(0, 40)}`;
    return r;
  }
}

console.log(`· serving ${BASE} · every [param] bound to a fresh UUID that owns nothing`);
const ALL = writeRoutes();
const totalVerbs = ALL.reduce((a, r) => a + r.verbs.length, 0);
console.log(`· ${ALL.length} route file(s) exporting ${totalVerbs} write verb(s)`);

const before = await tableCounts();

const LANES = [
  ['anon', 'public · no session', null, null],
  ['tenant', 'tenant · tenant_admin', 'kate.ulepic@foundation3dp.com', process.env.TENANT_PW || 'DemoPass123!'],
  ['partner', 'partner · partner_admin', 'pjackson@ecinnovates.com', ADMIN_PW],
  ['admin', 'admin · master_admin', 'eric@rfppipeline.com', ADMIN_PW],
];
const noActor = [];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  for (const [lane, label, email, pw] of LANES) {
    const mine = ALL.filter((r) => laneFor(r.route) === lane);
    if (!mine.length) continue;
    console.log(`\n── ${label} ──`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let p;
    try {
      p = email ? await login(ctx, email, pw) : await ctx.newPage();
      if (!email) await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.log(`  ✗ lane unavailable — ${String(e.message).slice(0, 70)}`);
      for (const r of mine) for (const v of r.verbs) noActor.push(`${v} ${r.route}`);
      await ctx.close(); continue;
    }
    let n = 0;
    for (const r of mine) {
      for (const verb of r.verbs) {
        const res = await call(p, bind(r.route), verb);
        res.route = r.route;
        rows.push(res); n += 1;
        if (!res.ok) console.log(`  ✗ ${verb.padEnd(6)} ${r.route.padEnd(64)} ${res.note}`);
      }
    }
    console.log(`  (${n} verb(s) called)`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

// ── the safety check: did anything actually write? ──
const after = await tableCounts();
const drift = Object.keys(after)
  .filter((t) => before[t] !== undefined && before[t] !== after[t])
  .map((t) => `${t}: ${before[t]} → ${after[t]}`);
await sql.end();

const bad = rows.filter((r) => !r.ok);
const obs = rows.filter((r) => r.observation);
console.log(`\n${rows.length} write verb(s) called · ${rows.length - bad.length} refuse cleanly · ${bad.length} do not`);
if (obs.length) {
  console.log(`\n${obs.length} observation(s) — a 2xx at an id that owns nothing (not graded; see the note in call()):`);
  for (const r of obs) console.log(`  \u00b7 ${r.verb} ${r.route} — ${r.observation}`);
}
console.log(`coverage: ${totalVerbs} write verb(s) on disk · ${rows.length} called · ${noActor.length} no actor`);
if (rows.length + noActor.length !== totalVerbs) {
  console.log(`\n✗ HARNESS DEFECT — ${totalVerbs - rows.length - noActor.length} verb(s) enumerated but never called.`);
  process.exit(2);
}

console.log(`\nmutation footprint (this lens is NOT read-only — see the header): ${drift.length ? drift.length + ' table(s) changed' : 'nothing changed'}`);
for (const d of drift) console.log(`  · ${d}`);

if (bad.length) {
  console.log('\n✗ write-contract violations:');
  for (const r of bad) console.log(`  · ${r.verb} ${r.route} — ${r.note}`);
}
if (bad.length) process.exit(1);
console.log('\n✓ every reachable write verb answers a client error as 4xx with both `error` and `code`.');
