/** Drive the OPP bridge and the bucket ranking spine — one chain, driven as one.
 *
 * An opportunity the admin approves has to reach every customer who should see it, and land in an
 * order that reflects what THAT customer cares about. Those are two subsystems with one seam:
 *
 *   BRIDGE   admin publish → a forward-only opportunity_bridge event → a denormalized
 *            tenant_opportunity_cards row per activated tenant. Forward-only means an update is a
 *            NEW event at a higher version, never a mutation of the one before it — that is what
 *            makes the fan-out replayable and a late-joining tenant backfillable.
 *
 *   BUCKETS  a tenant's spotlight buckets are their own lens. Creating one scores every card they
 *            hold; a card arriving later is scored against every bucket they already have. The cap
 *            is a platform setting, enforced atomically so two concurrent creates cannot both win.
 *
 * And the seam that matters most: a bucket is a TENANT's, so it must never rank, score, or even see
 * another tenant's cards — proven at the API and again in RLS.
 *
 * Run: cd frontend && . ../scripts/sandbox-env.sh && node scripts/drive-bridge-buckets.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { clientHeaders } from './lib/client-ip.mjs';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const sql = postgres(process.env.DATABASE_URL_OWNER, {
  max: 4,
  transform: { column: { from: (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) } },
});
let bad = 0;
const check = (ok, s, extra = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`); };
const note = (s) => console.log(`  · ${s}`);

async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

/**
 * TWO tenants, both RESOLVED — this drive proves the bridge fans a card to every holder AND that
 * each tenant sees only its own, so it genuinely needs a second tenant. It used to pin
 * `lighthouse` / eric@lighthouse.com, which does not exist on a rebuilt database: the drive exited
 * 1 with "tenant lighthouse missing", which the suite counted as a failure of the BRIDGE.
 *
 * Resolved by "has an active tenant_admin", newest-first, so a re-seed cannot rot it. Fewer than
 * two such tenants means the isolation half cannot be tested at all — that is CANNOT-RUN (exit 2),
 * not a pass and not a finding.
 */
const candidates = await sql`
  SELECT t.slug, t.id, u.email
  FROM tenants t
  JOIN users u ON u.tenant_id = t.id AND u.is_active AND u.role = 'tenant_admin'
  WHERE t.archived_at IS NULL AND t.slug NOT IN ('rfp-pipeline')
  ORDER BY t.created_at`;
const seen = new Set();
const picks = candidates.filter((c) => (seen.has(c.slug) ? false : seen.add(c.slug)));
if (picks.length < 2) {
  console.error('\n⛔ CANNOT RUN — this is not a finding and not a pass.');
  console.error(`   the bridge isolation half needs TWO tenants with an active tenant_admin; this box has ${picks.length}`);
  console.error(`   (found: ${picks.map((p) => p.slug).join(', ') || 'none'})`);
  process.exit(2);
}
const TPW = process.env.TENANT_PW || 'DemoPass123!';
const A = { slug: picks[0].slug, email: picks[0].email, pw: process.env.FOUNDATION_PW || TPW, tenantId: picks[0].id };
const B = { slug: picks[1].slug, email: picks[1].email, pw: TPW, tenantId: picks[1].id };
console.log(`tenants: A=${A.slug} (${A.email})  B=${B.slug} (${B.email})`);

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const pageA = await (await browser.newContext({ extraHTTPHeaders: clientHeaders() })).newPage();
const pageB = await (await browser.newContext({ extraHTTPHeaders: clientHeaders() })).newPage();
const admin = await (await browser.newContext({ extraHTTPHeaders: clientHeaders() })).newPage();
await login(pageA, A.email, A.pw);
await login(pageB, B.email, B.pw);
await login(admin, 'eric@rfppipeline.com', process.env.RFP_ADMIN_PW || 'RFPAdmin2026!');

// ════════════════════════════════════════════════════════════════════ BRIDGE ═══
console.log('\n══ BRIDGE ══');

const bridgeShape = await sql`
  SELECT event_type, count(*)::int AS n, max(version)::int AS maxv
  FROM opportunity_bridge GROUP BY event_type ORDER BY 2 DESC`;
note(`events: ${bridgeShape.map((r) => `${r.eventType}=${r.n}(v≤${r.maxv})`).join(' · ')}`);

// 1 · forward-only: no bridge row is ever rewritten, so (opportunity, version) is unique and an
// update always appears as a HIGHER version rather than an edit of the row before it.
const dupes = await sql`
  SELECT opportunity_id, version, count(*)::int AS n FROM opportunity_bridge
  GROUP BY 1,2 HAVING count(*) > 1`;
check(dupes.length === 0, 'the bridge never holds two rows at one (opportunity, version)',
  dupes.length ? `${dupes.length} collision(s)` : '');

const multi = await sql`
  SELECT opportunity_id, count(*)::int AS versions, min(version)::int AS lo, max(version)::int AS hi
  FROM opportunity_bridge GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 3`;
if (multi.length) {
  note(`re-published opportunities: ${multi.map((m) => `${m.versions} versions (v${m.lo}→v${m.hi})`).join(', ')}`);
  check(multi.every((m) => m.hi >= m.versions), 'versions advance rather than being reused');
} else {
  note('no opportunity has been re-published yet — the update path is untested by existing data');
}

// 2 · every event that fanned out reached a card, and every card traces to an event.
// Fixture tenants are seeded card-first (no bridge event), so scope this to product-made tenants:
// a card with no event behind it means a write that skipped the bridge, which is the thing worth
// catching — an update to that opportunity would never reach the holder.
const orphanCards = await sql`
  SELECT t.slug, count(*)::int AS n
  FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
  WHERE NOT EXISTS (SELECT 1 FROM opportunity_bridge b WHERE b.opportunity_id = c.opportunity_id)
    -- A card CLAIMING a bridge version must have one. bridge_version is NOT NULL DEFAULT 0, and 0
    -- is the schema's own way of saying "no bridge event produced me" - a directly-placed fixture
    -- card declaring 0 is not lying about anything, and this check is about the write that skipped
    -- the bridge WHILE PRETENDING IT DID NOT. Scoping to > 0 reads the column's existing semantics
    -- rather than widening the exclusion list, and keeps the check strict for every real card.
    -- (No backticks in this comment: it sits inside a tagged template literal, and a backtick here
    --  terminates the SQL string - which is exactly how the first version of it crashed the drive.)
    AND c.bridge_version > 0
    AND t.slug NOT IN ('ubihere', 'rfp-pipeline', 'youngstown-business-incubator')
  GROUP BY t.slug`;
check(orphanCards.length === 0, 'no product-made card exists without a bridge event behind it',
  orphanCards.map((o) => `${o.slug}=${o.n}`).join(' ') || '');

// 3 · the fan-out is COMPLETE for tenants the PRODUCT created.
//
// Seeded fixtures are excluded deliberately, and this is not a loophole: scripts/seed_dev_accounts
// and seed_e2e_fixtures insert tenants with direct SQL, bypassing createTenant() and therefore
// backfillTenant(). `ubihere` is the clearest case — its own seed comment says it is the cold-start
// fixture and that "nothing else may seed work into it". Counting those as fan-out failures reports
// a product bug that does not exist; the real check is that every tenant born through a product
// path is whole.
const gaps = await sql`
  SELECT t.slug, count(*)::int AS missing
  FROM tenants t
  CROSS JOIN (SELECT DISTINCT opportunity_id FROM opportunity_bridge) b
  WHERE t.archived_at IS NULL
    AND EXISTS (SELECT 1 FROM tenant_opportunity_cards c2 WHERE c2.tenant_id = t.id)
    AND t.slug NOT IN ('ubihere', 'rfp-pipeline', 'youngstown-business-incubator')
    AND NOT EXISTS (
      SELECT 1 FROM tenant_opportunity_cards c
      WHERE c.tenant_id = t.id AND c.opportunity_id = b.opportunity_id)
  GROUP BY t.slug ORDER BY 2 DESC LIMIT 5`;
// A GAP HERE IS NOT YET A FINDING, because the completeness the product promises is LAZY.
//
// The bridge is forward-only, and `backfillTenant` runs once at creation inside a try/catch that
// only console.errors — so a tenant can legitimately be behind. What makes that safe is
// `reconcileTenant`, the self-healing consumer, whose own docstring names this exact case: a tenant
// "created after [a push], suspended, or whose creation-time backfill silently failed" catches up on
// its next /cards read. `immobileyes` was six short here, and all six were pushed three weeks before
// that company existed — asserting eager completeness against a lazily-reconciled design is
// asserting a contract the system does not have.
//
// So the gap is the SETUP and the reconcile is the TEST. Calling the product's own catch-up and
// re-asking turns "the fan-out left gaps" — which was never quite true — into "the self-healing
// consumer does not heal", which would be a real finding, and which nothing else in the suite
// checks. (Seeded fixtures stay excluded and are NOT reconciled: `ubihere`'s seed comment says
// nothing may seed work into it, and honouring that matters more than a tidier check.)
if (gaps.length === 0) {
  check(true, 'every card-holding tenant has a card for every published opportunity');
} else {
  note(`behind the bridge before catch-up: ${gaps.map((g) => `${g.slug}(${g.missing})`).join(' · ')}`);
  // Through the ADMIN ROUTE, as an rfp_admin, rather than by importing the function. That exercises
  // the auth gate and the route contract alongside the catch-up itself, and it is the action a real
  // operator takes when a company reports a missing opportunity.
  for (const g of gaps) {
    const [t] = await sql`SELECT id FROM tenants WHERE slug = ${g.slug}`;
    const r = await admin.request.post(`${BASE}/api/admin/tenants/${t.id}/backfill-cards`);
    const j = await r.json().catch(() => ({}));
    note(`  backfill-cards(${g.slug}) → HTTP ${r.status()} applied=${j?.data?.applied ?? '?'}`);
  }
  const after = await sql`
    SELECT t.slug, count(*)::int AS missing
    FROM tenants t
    CROSS JOIN (SELECT DISTINCT opportunity_id FROM opportunity_bridge) b
    WHERE t.archived_at IS NULL
      AND EXISTS (SELECT 1 FROM tenant_opportunity_cards c2 WHERE c2.tenant_id = t.id)
      AND t.slug NOT IN ('ubihere', 'rfp-pipeline', 'youngstown-business-incubator')
      AND NOT EXISTS (
        SELECT 1 FROM tenant_opportunity_cards c
        WHERE c.tenant_id = t.id AND c.opportunity_id = b.opportunity_id)
    GROUP BY t.slug ORDER BY 2 DESC LIMIT 5`;
  check(after.length === 0,
    'a tenant behind the bridge CATCHES UP — the admin backfill route brings it to every published opportunity',
    after.length ? `still short: ${after.map((g) => `${g.slug}(${g.missing})`).join(' · ')}` : 'all caught up');
}

// 4 · a tenant cannot read another tenant's cards
const crossCards = await pageB.request.get(`${BASE}/api/portal/${A.slug}/cards?limit=5`);
check([403, 404].includes(crossCards.status()), 'tenant B is refused tenant A\'s cards', `HTTP ${crossCards.status()}`);

// ═══════════════════════════════════════════════════════════════════ BUCKETS ═══
console.log('\n══ BUCKETS ══');

const listA = await pageA.request.get(`${BASE}/api/portal/${A.slug}/buckets`);
const jA = await listA.json().catch(() => ({}));
const cap = jA?.data?.cap;
const bucketsA = jA?.data?.buckets ?? [];
check(listA.ok() && typeof cap === 'number', `the cap is a platform setting the UI can read`, `cap=${cap}`);
note(`tenant A holds ${bucketsA.length} bucket(s)`);

// 5 · create a bucket → it scores what the tenant already holds
const NAME = `Drive probe ${Date.now().toString(36)}`;
const created = await pageA.request.post(`${BASE}/api/portal/${A.slug}/buckets`, {
  data: {
    name: NAME,
    description: 'Additive manufacturing for defense infrastructure',
    criteria: { keywords: ['additive', '3d printing', 'construction', 'concrete'], agencies: ['Navy', 'Army'] },
  },
});
const cj = await created.json().catch(() => ({}));
const newId = cj?.data?.bucket?.id ?? cj?.data?.id;
const atCap = created.status() === 409;
if (atCap) {
  note(`tenant A is already at the cap of ${cap} — exercising the limit instead of a create`);
  check(cj?.code === 'BUCKET_LIMIT', 'the cap refuses with a named code, not a generic 500', cj?.code ?? '?');
} else {
  check(created.ok() && !!newId, 'a tenant_admin can author a bucket', created.ok() ? '' : `${created.status()} ${JSON.stringify(cj).slice(0, 90)}`);
}

if (newId) {
  // Scoring on create — the bucket is useless until it has ranked what the tenant holds.
  await new Promise((r) => setTimeout(r, 1500));
  const scored = await sql`
    SELECT count(*)::int AS n, round(max(score)::numeric, 3) AS top
    FROM tenant_bucket_scores WHERE bucket_id = ${newId}::uuid`;
  check(scored[0].n > 0, 'creating a bucket scores the cards the tenant already holds',
    `${scored[0].n} scored, top=${scored[0].top}`);

  // Every score belongs to THIS tenant — a bucket must never reach across.
  const foreign = await sql`
    SELECT count(*)::int AS n FROM tenant_bucket_scores s
    WHERE s.bucket_id = ${newId}::uuid AND s.tenant_id <> ${A.tenantId}::uuid`;
  check(foreign[0].n === 0, 'no score under tenant A\'s bucket belongs to another tenant', `${foreign[0].n}`);

  const notHeld = await sql`
    SELECT count(*)::int AS n FROM tenant_bucket_scores s
    WHERE s.bucket_id = ${newId}::uuid
      AND NOT EXISTS (SELECT 1 FROM tenant_opportunity_cards c
                      WHERE c.tenant_id = ${A.tenantId}::uuid AND c.opportunity_id = s.opportunity_id)`;
  check(notHeld[0].n === 0, 'a bucket only scores opportunities the tenant actually holds', `${notHeld[0].n} stray`);

  // 6 · the ranked view comes back through the API, ordered
  const ranked = await pageA.request.get(`${BASE}/api/portal/${A.slug}/buckets/${newId}`);
  const rj = await ranked.json().catch(() => ({}));
  const rows = rj?.data?.ranked ?? [];
  check(ranked.ok() && Array.isArray(rows), 'the bucket returns a ranked list', ranked.ok() ? `${rows.length} rows` : String(ranked.status()));
  if (rows.length > 1) {
    const scores = rows.map((r) => Number(r.score ?? 0));
    check(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'the ranking is actually ordered, best first',
      `top=${scores[0]} … last=${scores.at(-1)}`);

    // A ranking of all zeros is trivially "ordered", and this check passed on exactly that for
    // months: every stored score was 0 because the timeline signal was dead, so the list a customer
    // saw was 42 cards in arbitrary order. Sortedness is not the property that matters —
    // DISCRIMINATION is. Assert the ranking actually separates the cards.
    const levels = new Set(scores).size;
    check(levels > 1, 'the ranking DISCRIMINATES rather than scoring everything the same',
      `${levels} distinct score level(s) across ${scores.length} cards`);
    const withTimeline = rows.filter((r) => r.factors && Object.prototype.hasOwnProperty.call(r.factors, 'timeline')).length;
    check(withTimeline > 0, 'the close-date timeline signal reached the scores',
      `${withTimeline}/${rows.length} carry a timeline factor`);
    note(`top pick: "${String(rows[0].title ?? rows[0].opportunityTitle ?? '').slice(0, 52)}"`);
  }

  // 7 · another tenant cannot read or re-rank it
  const crossRead = await pageB.request.get(`${BASE}/api/portal/${A.slug}/buckets/${newId}`);
  check([403, 404].includes(crossRead.status()), 'tenant B is refused tenant A\'s bucket', `HTTP ${crossRead.status()}`);
  const crossRank = await pageB.request.post(`${BASE}/api/portal/${A.slug}/buckets/${newId}?action=rank`, { data: {} });
  check([403, 404].includes(crossRank.status()), 'tenant B cannot force a re-rank of tenant A\'s bucket', `HTTP ${crossRank.status()}`);
  // B's OWN slug + A's bucket id. Every handler under this route scopes its query by
  // s.tenant_id = <the slug's tenant>, so this returns 200 with an EMPTY list rather than 404 —
  // no row of A's is reachable. Assert the property that matters (nothing of A's comes back), not
  // the status code: demanding 404 here would be asserting a contract the product never made.
  const crossId = await pageB.request.get(`${BASE}/api/portal/${B.slug}/buckets/${newId}`);
  const cj2 = await crossId.json().catch(() => ({}));
  check(crossId.ok() && Array.isArray(cj2?.data?.ranked) && cj2.data.ranked.length === 0,
    'A foreign bucket id under B\'s own slug yields nothing — scoped by tenant, not by id alone',
    `HTTP ${crossId.status()} · ${cj2?.data?.ranked?.length ?? '?'} rows`);

  // 8 · edit re-ranks
  const edited = await pageA.request.patch(`${BASE}/api/portal/${A.slug}/buckets/${newId}`, {
    data: { name: NAME, description: 'Narrowed', criteria: { keywords: ['concrete'], agencies: ['Navy'] } },
  });
  check(edited.ok(), 'editing the criteria succeeds', edited.ok() ? '' : String(edited.status()));
  if (edited.ok()) {
    await new Promise((r) => setTimeout(r, 1500));
    const after = await sql`
      SELECT count(*)::int AS n, max(computed_at) AS at FROM tenant_bucket_scores WHERE bucket_id = ${newId}::uuid`;
    check(after[0].n > 0 && after[0].at, 're-ranking recomputed the scores', `${after[0].n} rows, at ${after[0].at?.toISOString?.().slice(11, 19)}`);
  }

  // 9 · the cap is enforced atomically — fill to the limit and confirm the refusal
  const nowList = await (await pageA.request.get(`${BASE}/api/portal/${A.slug}/buckets`)).json();
  const held = (nowList?.data?.buckets ?? []).length;
  const room = Math.max(0, cap - held);
  const extra = [];
  for (let i = 0; i < room; i++) {
    const r = await pageA.request.post(`${BASE}/api/portal/${A.slug}/buckets`, {
      data: { name: `${NAME} fill ${i}`, description: 'cap fill', criteria: { keywords: ['x'] } },
    });
    const b = await r.json().catch(() => ({}));
    if (r.ok()) extra.push(b?.data?.bucket?.id ?? b?.data?.id);
  }
  const overflow = await pageA.request.post(`${BASE}/api/portal/${A.slug}/buckets`, {
    data: { name: `${NAME} overflow`, description: 'one too many', criteria: { keywords: ['x'] } },
  });
  const oj = await overflow.json().catch(() => ({}));
  check(overflow.status() === 409 && oj?.code === 'BUCKET_LIMIT',
    `the ${cap}-bucket cap refuses the next one with BUCKET_LIMIT`, `${overflow.status()} ${oj?.code ?? ''}`);

  // clean up everything this drive created
  const mine = [newId, ...extra].filter(Boolean);
  await sql`DELETE FROM tenant_bucket_scores WHERE bucket_id = ANY(${mine}::uuid[])`;
  await sql`DELETE FROM tenant_spotlight_buckets WHERE id = ANY(${mine}::uuid[])`;
  note(`(removed ${mine.length} probe bucket(s))`);
}

// 10 · RLS, not just the app layer
const appUrl = process.env.DATABASE_URL;
if (appUrl) {
  const appSql = postgres(appUrl, { max: 1, transform: { column: { from: (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) } } });
  try {
    const rows = await appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${B.tenantId}, true)`;
      const b = await tx`SELECT count(*)::int AS n FROM tenant_spotlight_buckets WHERE tenant_id = ${A.tenantId}::uuid`;
      const s = await tx`SELECT count(*)::int AS n FROM tenant_bucket_scores WHERE tenant_id = ${A.tenantId}::uuid`;
      const c = await tx`SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${A.tenantId}::uuid`;
      return { b: b[0].n, s: s[0].n, c: c[0].n };
    });
    check(rows.b === 0 && rows.s === 0 && rows.c === 0,
      'under tenant B\'s RLS context, tenant A\'s buckets, scores and cards are all invisible',
      `buckets=${rows.b} scores=${rows.s} cards=${rows.c}`);
  } catch (e) {
    check(false, 'RLS probe failed', String(e).slice(0, 90));
  } finally { await appSql.end(); }
}

console.log(bad === 0 ? '\n✓ the bridge fans out completely and buckets rank only their own tenant' : `\n✗ ${bad} check(s) failed`);
await browser.close();
await sql.end();
process.exit(bad === 0 ? 0 : 1);
