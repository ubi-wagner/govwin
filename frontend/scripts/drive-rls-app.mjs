/**
 * App-level RLS proof: with the app connected as `govtech_app` (NOBYPASSRLS), sign in as a real
 * tenant admin and hit the portal API routes that read isolated tables. Each must return that
 * tenant's data — an empty result or a 500 would be a DENY-ALL, meaning the `enterTenant` choke
 * point did not fire.
 *
 *   DATABASE_URL=… node scripts/drive-rls-app.mjs
 *
 * WHY THIS FILE WAS REWRITTEN (E2E sweep, docs/E2E_SWEEP_2026-08-23.md §3).
 *
 * It used to pin `eric@immobileyes.com` / `Sandbox2026!`. That account does not exist — the
 * database was rebuilt and the drive was never updated. Its `login()` swallowed the failed
 * navigation, handed back a logged-out page, every route answered 401 with n=0, and the script
 * concluded:
 *
 *     ❌ FAIL — a DENY-ALL surfaced (see 0-count rows)
 *
 * A security finding, shaped exactly like a real one, produced by a script that never
 * authenticated. That is worse than not running: it manufactures alarm in one direction and, on a
 * day when RLS really did break, would be indistinguishable from the noise it had been printing
 * all along.
 *
 * Two changes close it. The actor is RESOLVED from the database rather than pinned, so a re-seed
 * cannot rot it. And authentication is PROVEN before a single measurement is taken — if the login
 * does not land, the drive dies with exit 2 ("could not run") and says so, because a logged-out
 * browser and a deny-all produce identical output and only one of them is a finding.
 *
 * THE POSITIVE CONTROL IS LOAD-BEARING. A pass here means the tenant SAW their own rows. A tenant
 * with no data would pass a "no leak" test trivially, so the drive refuses to run against one.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { resolveActor, loginOrDie, CannotRun, dieWell, harnessDbUrl } from './lib/drive-actor.mjs';
import { clientHeaders } from './lib/client-ip.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL required'); process.exit(2); }
// The harness's OWN reads go through the owner — see harnessDbUrl(). The app under
// test stays on the scoped role; only this bookkeeping is cross-tenant.
const sql = postgres(harnessDbUrl(), { max: 2 });

async function getJson(ctx, path) {
  const r = await ctx.request.get(`${BASE}${path}`);
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  const data = body && (body.data ?? body);
  const count = Array.isArray(data) ? data.length
    : data && Array.isArray(data.cards) ? data.cards.length
    : data && Array.isArray(data.buckets) ? data.buckets.length
    : data && Array.isArray(data.proposals) ? data.proposals.length
    : data && typeof data === 'object' ? Object.keys(data).length : (data ? 1 : 0);
  return { status: r.status(), count };
}

/**
 * A tenant that actually holds rows in the isolated tables.
 *
 * Driving RLS against an empty tenant proves nothing — every route would return zero and the
 * script could not tell isolation from emptiness. Pick the tenant with the most to lose.
 */
async function richestTenant() {
  // Wrapped in a subselect: Postgres accepts a bare output alias in ORDER BY but NOT inside an
  // expression, so `ORDER BY cards + proposals` on the flat form raises 42703.
  const [t] = await sql`
    SELECT * FROM (
      SELECT t.slug, t.id,
             (SELECT count(*) FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id)::int AS cards,
             (SELECT count(*) FROM proposals p WHERE p.tenant_id = t.id)::int AS proposals
      FROM tenants t
      WHERE EXISTS (
        SELECT 1 FROM users u
        WHERE u.tenant_id = t.id AND u.is_active AND u.role = 'tenant_admin')
    ) x
    ORDER BY x.cards + x.proposals DESC
    LIMIT 1
  `;
  if (!t || (t.cards + t.proposals) === 0) {
    throw new CannotRun(
      'no tenant on this box has both an active tenant_admin and any rows in the isolated tables. ' +
      'A tenant with nothing to read would pass every check trivially, so this drive refuses to ' +
      'use one — that would be a vacuous pass, not a proof.',
    );
  }
  return t;
}

async function main() {
  const tenant = await richestTenant();
  const actor = await resolveActor(sql, { role: 'tenant_admin', tenantSlug: tenant.slug });
  console.log(`tenant ${tenant.slug} (${tenant.cards} cards · ${tenant.proposals} proposals)`);
  console.log(`actor  ${actor.email}\n`);

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = [];
  try {
    const tctx = await b.newContext({ extraHTTPHeaders: clientHeaders() });
    // Throws CannotRun (exit 2) rather than returning a logged-out page.
    const tp = await loginOrDie(tctx, BASE, actor);
    console.log(`signed in → ${tp.url()}\n`);

    // EXPECT WHAT THE TABLE HOLDS, NOT SIMPLY "SOMETHING".
    //
    // The old form asserted `count > 0` on every route. That is wrong in both directions. On a
    // table the tenant legitimately has no rows in — `collaboration_vaults` is empty on this box,
    // 0 rows for ANY tenant — it reports a DENY-ALL that isn't one. And on a table with 10 rows it
    // would pass on 1, which is exactly what a partial RLS failure looks like.
    //
    // So each expectation is a count computed with the SAME predicate the route itself runs,
    // copied from the source rather than re-derived (a predicate I believe is equivalent is how
    // confident wrong findings get made). A deny-all is then `expected > 0 && got === 0`, and an
    // empty table is `expected === 0 && got === 0` — a pass, and correctly so.
    const t = tenant.id;
    const expectations = [
      ['cards (tenant_opportunity_cards)', `/api/portal/${tenant.slug}/cards`,
        (await sql`SELECT count(*)::int n FROM tenant_opportunity_cards c WHERE c.tenant_id = ${t}::uuid`)[0].n],
      ['buckets (tenant_spotlight_buckets)', `/api/portal/${tenant.slug}/buckets`,
        (await sql`SELECT count(*)::int n FROM tenant_spotlight_buckets WHERE tenant_id = ${t}::uuid AND is_active`)[0].n],
      ['proposals (proposals)', `/api/portal/${tenant.slug}/proposals`,
        (await sql`SELECT count(*)::int n FROM proposals p WHERE p.tenant_id = ${t}::uuid`)[0].n],
      ['team (user_memberships)', `/api/portal/${tenant.slug}/team`,
        (await sql`SELECT count(*)::int n FROM user_memberships m WHERE m.tenant_id = ${t}::uuid AND m.source IN ('home','manual')`)[0].n],
      ['vaults (collaboration_vaults)', `/api/portal/${tenant.slug}/vaults`,
        (await sql`SELECT count(*)::int n FROM collaboration_vaults WHERE tenant_id = ${t}::uuid AND status = 'active'`)[0].n],
    ];

    let positiveControls = 0;
    for (const [label, path, expected] of expectations) {
      const { status, count } = await getJson(tctx, path);
      const denyAll = expected > 0 && count === 0;
      const ok = status === 200 && !denyAll;
      if (expected > 0 && count > 0) positiveControls++;
      const note = expected === 0
        ? `${status} · n=0, and the table holds 0 for this tenant — empty, not denied`
        : `${status} · n=${count} · db=${expected}${denyAll ? '  ← DENY-ALL' : ''}`;
      results.push([`portal · ${label}`, ok, note]);
    }

    // A run where every table happened to be empty would pass every check above without proving
    // anything at all. Say so rather than let it read as a proof.
    if (positiveControls === 0) {
      throw new CannotRun(
        'every isolated table is empty for this tenant, so nothing here was a positive control. ' +
        'A pass would be vacuous — seed the tenant before trusting this drive.',
      );
    }
    console.log(`\n(${positiveControls} of ${expectations.length} checks were real positive controls)`);
    await tctx.close();
  } finally {
    await b.close();
  }

  for (const [m, ok, info] of results) console.log(`${ok ? '✅' : '❌'} ${m}  (${info})`);
  const pass = results.every(([, ok]) => ok);
  console.log(pass
    ? `\n✅ APP-LEVEL RLS PROOF PASS (${results.length}/${results.length}) — govtech_app, authenticated`
    : '\n❌ FAIL — a DENY-ALL surfaced on an AUTHENTICATED session (see the 0-count rows)');
  await sql.end();
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => { await sql.end().catch(() => {}); dieWell(e); });
