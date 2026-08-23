/**
 * Lens 4 — RECONCILIATION. Is the number on the page the number in the table?
 *
 * The other three lenses each stop one step short of this. `verify-surfaces` proves a page renders;
 * a page can render a wrong number perfectly. `verify-api-contract` proves a route answers in the
 * right SHAPE; the shape says nothing about the value. `verify-db-crud` proves a WRITE lands; it
 * never looks at what the customer is shown afterwards. So a page can state "6 active builds" for a
 * tenant with twelve, and all three lenses stay green — which is exactly what was happening.
 *
 * Method, and the one rule that makes it trustworthy: **the expected value is the page's OWN query,
 * copied from its source, not a predicate I think is equivalent.** Earlier in this audit I predicted
 * a rendered count from a plausible-looking `SELECT count(*)` and was wrong — the page filtered
 * differently. Guessing the predicate produces confident, wrong findings. Every check below cites
 * the file and line its expectation came from, so the citation can be re-checked when the page
 * changes.
 *
 * Where a rendered number is legitimately a capped slice ("most recent 6"), that is fine — but then
 * the page must not present it as a total. That distinction is the whole point of this lens.
 *
 *   cd frontend && node scripts/verify-ui-vs-db.mjs
 * Exit 0 if every rendered number matches its source of truth; 1 otherwise.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });
const PROBE = 'uivdb-probe';

let ok = true;
const A = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  ok = ok && cond;
};

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

/** The visible text of the page, as a person reads it. */
async function text(page, url) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

const num = (body, re) => { const m = body.match(re); return m ? Number(m[1]) : null; };

console.log(`· serving ${BASE} · reading ${DB.replace(/:[^:@/]*@/, ':***@')}`);
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const scratch = [];

try {
  const [foundation] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  if (!foundation) throw new Error('no foundation tenant');
  const tid = foundation.id;

  // ══ 1 · TENANT COCKPIT summary line ══════════════════════════════════════
  // Source: app/portal/[tenantSlug]/dashboard/page.tsx (the three counts) rendered by
  // components/portal/cockpit.tsx `summary`.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');

  console.log('\n══ 1 · the cockpit summary line vs the tables it counts ══');
  {
    const body = await text(p, '/portal/foundation/dashboard');
    // dashboard/page.tsx: proposals WHERE tenant_id AND stage <> 'archived'
    const [{ n: dbBuilds }] = await sql`
      SELECT count(*)::int AS n FROM proposals WHERE tenant_id = ${tid} AND stage <> 'archived'`;
    // dashboard/page.tsx: tenant_opportunity_cards WHERE tenant_id AND lifecycle_status <> 'archived' AND archived_at IS NULL
    const [{ n: dbOpps }] = await sql`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards
      WHERE tenant_id = ${tid} AND lifecycle_status <> 'archived' AND archived_at IS NULL`;

    const uiBuilds = num(body, /(\d+) active builds?/);
    const uiOpps = num(body, /(\d+) opportunit(?:y|ies)/);
    A('"N active builds" equals the unarchived proposal count', uiBuilds === dbBuilds, `ui=${uiBuilds} db=${dbBuilds}`);
    A('"N opportunities" equals the live card count', uiOpps === dbOpps, `ui=${uiOpps} db=${dbOpps}`);
  }

  // ── The regression proof: push PAST the display cap ──────────────────────
  // The cockpit shows at most 6 builds. The summary used to count that capped ARRAY, so this is the
  // check that would have caught it: with more builds than the cap, does the sentence still tell the
  // truth? Without this the fix is unprovable — under the cap, right and wrong agree.
  console.log('\n── the cap · does the sentence still tell the truth above 6 builds? ──');
  {
    const [anyOpp] = await sql`SELECT id FROM opportunities ORDER BY id ASC LIMIT 1`;
    const [{ n: before }] = await sql`
      SELECT count(*)::int AS n FROM proposals WHERE tenant_id = ${tid} AND stage <> 'archived'`;
    const need = Math.max(0, 8 - before);
    if (!anyOpp) {
      console.log('  · SKIPPED — no opportunity row to hang scratch proposals off');
    } else {
      for (let i = 0; i < need; i += 1) {
        const [r] = await sql`
          INSERT INTO proposals (tenant_id, opportunity_id, title, stage, is_locked)
          VALUES (${tid}, ${anyOpp.id}, ${`${PROBE} build ${i + 1}`}, 'draft', false)
          RETURNING id`;
        scratch.push(r.id);
      }
      const [{ n: expected }] = await sql`
        SELECT count(*)::int AS n FROM proposals WHERE tenant_id = ${tid} AND stage <> 'archived'`;
      const body = await text(p, '/portal/foundation/dashboard');
      const uiBuilds = num(body, /(\d+) active builds?/);
      A(`with ${expected} builds (> the 6 shown) the summary still says ${expected}`,
        uiBuilds === expected, `ui=${uiBuilds} db=${expected}`);
    }
  }

  // ══ 1b · BUCKETS — the slot counter vs the rows and the configured cap ═══
  //
  // Flagged as UNCOVERED during the tri-lens audit and left that way, which by the rule in
  // TESTING_STRATEGY means it was not passing — it was unmeasured. #189 made it matter: with no
  // seeded buckets the counter starts at 0/N for every new tenant, and the cap moved 10 → 25.
  // Source: components/portal/spotlight-buckets.tsx renders `{buckets.length}/{cap} used`, where
  // cap comes from the buckets GET route (automation_framework.max_buckets_per_tenant).
  console.log('\n══ 1b · the bucket slot counter vs the rows and the cap ══');
  {
    const body = await text(p, '/portal/foundation/buckets');
    const m = body.match(/(\d+)\s*\/\s*(\d+) used/);
    const [uiUsed, uiCap] = m ? [Number(m[1]), Number(m[2])] : [null, null];
    const [{ n: dbUsed }] = await sql`
      SELECT count(*)::int AS n FROM tenant_spotlight_buckets
      WHERE tenant_id = ${tid} AND is_active`;
    const [{ cap: dbCap } = { cap: null }] = await sql`
      SELECT max_buckets_per_tenant::int AS cap FROM automation_framework WHERE id = 1`;
    A('the page found a slot counter to read', m !== null, m ? m[0] : 'no "N/M used" on the page');
    A('slots used equals the active bucket rows', uiUsed === dbUsed, `ui=${uiUsed} db=${dbUsed}`);
    A('the cap shown is the configured cap', uiCap === dbCap, `ui=${uiCap} db=${dbCap}`);
  }
  await ctx.close();

  // ══ 2 · ADMIN TENANT TABLE — three counts per row ════════════════════════
  // Source: app/admin/tenants/page.tsx — the three correlated subqueries, verbatim.
  console.log('\n══ 2 · the admin tenant table vs the rows it counts ══');
  const actx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ap = await login(actx, 'eric@rfppipeline.com', ADMIN_PW);
  {
    await ap.goto(BASE + '/admin/tenants', { waitUntil: 'domcontentloaded' });
    await ap.waitForLoadState('networkidle').catch(() => {});
    await ap.waitForTimeout(1200);
    const rendered = await ap.$$eval('table tbody tr', (trs) => trs.map((tr) => {
      const c = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
      return { slug: c[1], users: Number(c[3]), library: Number(c[4]), proposals: Number(c[5]) };
    }));
    A('the table rendered rows at all', rendered.length > 0, `${rendered.length} row(s)`);

    const expected = await sql`
      SELECT t.slug,
             (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS users,
             (SELECT COUNT(*)::int FROM library_atoms lu WHERE lu.tenant_id = t.id AND lu.status = 'approved') AS library,
             (SELECT COUNT(*)::int FROM proposals pr WHERE pr.tenant_id = t.id) AS proposals
      FROM tenants t ORDER BY t.created_at DESC LIMIT 50`;
    const byslug = new Map(expected.map((r) => [r.slug, r]));

    A('every tenant the DB holds is on the page', rendered.length === expected.length,
      `page=${rendered.length} db=${expected.length}`);
    let mismatches = 0;
    for (const r of rendered) {
      const e = byslug.get(r.slug);
      if (!e) { mismatches += 1; console.log(`      ✗ ${r.slug} is rendered but not in the DB result`); continue; }
      for (const k of ['users', 'library', 'proposals']) {
        if (r[k] !== e[k]) { mismatches += 1; console.log(`      ✗ ${r.slug}.${k}: page=${r[k]} db=${e[k]}`); }
      }
    }
    A('every rendered count matches its source query', mismatches === 0,
      `${rendered.length * 3} cell(s) checked`);
  }
  await actx.close();
} finally {
  if (scratch.length) {
    // Same catalog-driven teardown as the CRUD lens — a section save is not the only thing that
    // hangs rows off a proposal, and a hand-written child list is stale one migration later.
    const pc = await sql`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.confrelid = 'proposals'::regclass AND array_length(c.conkey, 1) = 1`;
    for (const id of scratch) for (const { child, col } of pc) {
      await sql.unsafe(`DELETE FROM ${child} WHERE ${col} = $1`, [id]).catch(() => {});
    }
    await sql`DELETE FROM proposals WHERE id = ANY(${scratch}::uuid[])`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM proposals WHERE title LIKE ${PROBE + '%'}`;
    console.log(`\n  ${n === 0 ? '✓' : '✗'} removed ${scratch.length} scratch build(s) — ${n} left`);
    ok = ok && n === 0;
  }
  await browser.close();
  await sql.end();
}

console.log(ok
  ? '\n✓ every number the UI states is the number the database holds.'
  : '\n✗ the UI and the database disagree — see above.');
process.exit(ok ? 0 : 1);
