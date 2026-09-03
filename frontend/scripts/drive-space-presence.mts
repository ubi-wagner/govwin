/**
 * SPACE PRESENCE — every way OUT of a customer's workspace, driven as the actor who leaves.
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────────────────────
 * Two actors enter a tenant space without belonging to it: an rfp_admin shadowing, and a
 * partner-manager descending into a company they manage. Both wrote an ENTER into the customer's
 * audit trail. Neither reliably wrote an EXIT.
 *
 *   partner   `partner.exited` was emitted with `tenantId: null` — it landed in NO customer's
 *             trail. Measured on the sandbox before the fix: 13 `finder:partner.entered` rows
 *             carrying a tenant_id, and zero exits carrying one.
 *   shadow    `shadow.ascended` came only from a "Return to platform" BUTTON, posted by a client
 *             component whose once-per-entry guard was `sessionStorage` — per TAB.
 *
 * So a company's trail accumulated "An RFP administrator opened your workspace" with no matching
 * close, permanently. The question that line exists to answer is not "did someone come in" but
 * "are they still here", and unmatched it answers the wrong one.
 *
 * ── WHAT IT ASSERTS THAT NOTHING ELSE DOES ───────────────────────────────────────────────────
 * That the bracket closes on ALL FOUR exits, and that each exit is scoped to the tenant it left:
 *
 *   explicit    the exit control was pressed
 *   left_space  they turned up on the platform/partner console without pressing anything
 *   moved       they went straight from company A into company B
 *   timeout     they shut the tab and the sweep closed it
 *
 * The first is the only one the old code could do at all, and even that one was unscoped for
 * partner. A drive that checked only the button would have passed against the broken build.
 *
 * ⚠️ NOT READ-ONLY. It descends as a real admin, moves between real companies, and writes
 * `space_presence` rows + `system_events`. Sandbox only. Its own rows are removed at the end; the
 * events are left, because an audit trail that a test can erase is not an audit trail.
 *
 *   cd frontend && npx tsx scripts/drive-space-presence.mts
 * Exit 0 every bracket closed and scoped · 1 a finding · 2 it could not earn a verdict.
 */
import postgres from 'postgres';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const DB = process.env.DATABASE_URL_OWNER;
if (!DB) { console.error('CannotRun: DATABASE_URL_OWNER is required.'); process.exit(2); }
// camelCase transform, matching lib/db.ts — a bare postgres() client has none, and a row type
// declaring `tenantId` then reads `undefined` for every row (it has shipped three times).
const sql = postgres(DB, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });

const ADMIN = 'eric@rfppipeline.com';
const ADMIN_PW = process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';

let bad = 0;
const ok = (m: string, x = '') => console.log(`  ✓ ${m}${x ? ` — ${x}` : ''}`);
const no = (m: string, x = '') => { console.error(`  ✗ ${m}${x ? ` — ${x}` : ''}`); bad += 1; };
const A = (c: unknown, m: string, x = '') => (c ? ok(m, x) : no(m, x));
const phase = (n: string) => console.log(`\n══ ${n} ${'═'.repeat(Math.max(0, 70 - n.length))}`);
const note = (m: string) => console.log(`  · ${m}`);

/** Open brackets this actor holds right now. */
async function openRows(userId: string) {
  return sql<{ id: string; tenantId: string; kind: string }[]>`
    SELECT id, tenant_id AS "tenantId", kind FROM space_presence
    WHERE user_id = ${userId}::uuid AND closed_at IS NULL`;
}

/** The bracket row for one (actor, tenant), newest first — closed or not. */
async function latest(userId: string, tenantId: string) {
  const [r] = await sql<{ id: string; closedAt: Date | null; closeReason: string | null }[]>`
    SELECT id, closed_at AS "closedAt", close_reason AS "closeReason" FROM space_presence
    WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
    ORDER BY entered_at DESC LIMIT 1`;
  return r ?? null;
}

/**
 * Events of one type for this actor+tenant since a watermark.
 *
 * THE TENANT SCOPE IS THE POINT. `partner.exited` used to be emitted with `tenantId: null`, which
 * is a row that exists and satisfies "an exit was emitted" while being invisible in the only place
 * it matters. Counting only rows that carry the tenant is what makes this able to fail.
 */
async function events(type: string, actorId: string, tenantId: string, since: Date) {
  // system_events.actor_id is TEXT and tenant_id is uuid — asked the database, not assumed. The
  // first version cast both to uuid and got `operator does not exist: text = uuid`. (This comment
  // lives OUT here because a backtick inside a tagged template TERMINATES it — which is how the
  // second version of this same line failed to parse at all.)
  const [r] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM system_events
    WHERE type = ${type} AND actor_id = ${actorId}
      AND tenant_id = ${tenantId}::uuid AND created_at >= ${since}`;
  return r?.n ?? 0;
}

/**
 * Reach "this actor holds nothing open", directly.
 *
 * Deliberately NOT via the sweep route: that needs a session or the cron bearer, and an
 * unauthenticated fetch would 401 into a silent catch — leaving a bracket open and making the
 * assertion that follows pass for the wrong reason. A fixture reaching a state is allowed to write
 * the state; only the assertions have to go through the product.
 */
async function closeAllFor(userId: string) {
  await sql`UPDATE space_presence SET closed_at = now(), close_reason = 'timeout'
             WHERE user_id = ${userId}::uuid AND closed_at IS NULL`;
}

const browser = await launch();
let adminId = '';
try {
  const [admin] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${ADMIN} LIMIT 1`;
  if (!admin) { console.error(`CannotRun: ${ADMIN} not on this box.`); process.exit(2); }
  adminId = admin.id;

  // Two tenants this admin is NOT a member of — shadow space, and enough of them to drive "moved".
  const targets = await sql<{ id: string; slug: string; name: string }[]>`
    SELECT t.id, t.slug, t.name FROM tenants t
    WHERE t.archived_at IS NULL
      AND t.slug NOT IN ('rfp-pipeline')
      AND NOT EXISTS (
        SELECT 1 FROM user_memberships m
        WHERE m.user_id = ${adminId}::uuid AND m.tenant_id = t.id AND m.status = 'active')
    ORDER BY t.created_at LIMIT 2`;
  if (targets.length < 2) {
    console.error(`CannotRun: need 2 tenants the admin is not a member of; found ${targets.length}.`);
    process.exit(2);
  }
  const [A1, A2] = targets;
  note(`shadow targets: ${A1.slug} · ${A2.slug}`);

  // Start from a clean slate for THIS actor so a leftover bracket cannot make a check pass.
  await sql`DELETE FROM space_presence WHERE user_id = ${adminId}::uuid`;

  const ctx = await signIn(browser, ADMIN, ADMIN_PW);
  const page = ctx.pages()[0];

  // ── 1 · DESCEND — the bracket opens, server-side, from the render ─────────────────────────
  phase('1 · descend into a customer workspace');
  let t0 = new Date();
  await page.goto(`${BASE}/portal/${A1.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  let rows = await openRows(adminId);
  A(rows.length === 1 && rows[0].tenantId === A1.id, 'one open bracket, for the company entered',
    `${rows.length} open · ${rows[0]?.kind ?? '—'}`);
  A(await events('shadow.descended', adminId, A1.id, t0) === 1,
    'shadow.descended reached THIS customer\'s audit trail');

  // Rendering again must not open a second bracket or emit a second arrival — this is the
  // per-tab sessionStorage bug, which a second page load reproduces exactly.
  t0 = new Date();
  await page.goto(`${BASE}/portal/${A1.slug}/proposals`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  rows = await openRows(adminId);
  A(rows.length === 1, 'a second page inside the same space does NOT open a second bracket', `${rows.length}`);
  A(await events('shadow.descended', adminId, A1.id, t0) === 0,
    'and does NOT emit a second arrival');

  // ── 2 · MOVED — straight into another company, no exit control in between ─────────────────
  phase('2 · moved — A → B with no exit in between');
  t0 = new Date();
  await page.goto(`${BASE}/portal/${A2.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const a1 = await latest(adminId, A1.id);
  A(a1?.closedAt && a1.closeReason === 'moved', 'the first company\'s bracket closed as "moved"',
    a1?.closeReason ?? 'still open');
  A(await events('shadow.ascended', adminId, A1.id, t0) === 1,
    'and THAT company was told they left — scoped to A, not to B');
  rows = await openRows(adminId);
  A(rows.length === 1 && rows[0].tenantId === A2.id, 'exactly one bracket remains, for B', `${rows.length}`);

  // ── 3 · LEFT_SPACE — back up to the platform console, pressing nothing ────────────────────
  phase('3 · traversed back up and out — no button pressed');
  t0 = new Date();
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const a2 = await latest(adminId, A2.id);
  A(a2?.closedAt && a2.closeReason === 'left_space', 'the remaining bracket closed as "left_space"',
    a2?.closeReason ?? 'still open');
  A(await events('shadow.ascended', adminId, A2.id, t0) === 1,
    'and B was told they left');
  A((await openRows(adminId)).length === 0, 'nothing is left open');

  // ── 4 · TIMEOUT — the tab that was simply shut ────────────────────────────────────────────
  phase('4 · timeout — the tab was closed and nobody pressed anything');
  await page.goto(`${BASE}/portal/${A1.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  A((await openRows(adminId)).length === 1, 'a bracket is open again');
  // Backdate the sighting rather than waiting — the sweep's input is `last_seen_at`, so this is
  // the same state an abandoned session reaches, without the wall-clock.
  await sql`UPDATE space_presence SET last_seen_at = now() - interval '3 hours'
             WHERE user_id = ${adminId}::uuid AND closed_at IS NULL`;
  t0 = new Date();
  const res = await page.request.post(`${BASE}/api/admin/space-presence/sweep`, {
    data: { idleMinutes: 30 },
  });
  A(res.status() === 200, 'the sweep route answers', `HTTP ${res.status()}`);
  const swept = (await res.json())?.data ?? {};
  note(`sweep closed ${swept.closed} at idleMinutes=${swept.idleMinutes}`);
  const a3 = await latest(adminId, A1.id);
  A(a3?.closedAt && a3.closeReason === 'timeout', 'the abandoned bracket closed as "timeout"',
    a3?.closeReason ?? 'still open');
  A(await events('shadow.ascended', adminId, A1.id, t0) === 1,
    'and the customer was told, even though nobody pressed anything');

  // ── 5 · SIGNED OUT — from INSIDE the workspace, which is where it matters ─────────────────
  phase('5 · signed out while still inside a customer workspace');
  await page.goto(`${BASE}/portal/${A1.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  A((await openRows(adminId)).length === 1, 'a bracket is open, and the actor is inside it');
  t0 = new Date();
  // The real control, not a direct POST: this is the button a person presses, and the whole point
  // is that it can be pressed from in here rather than after walking back out.
  await page.click('button:has-text("Sign out")').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const a4 = await latest(adminId, A1.id);
  A(a4?.closedAt && a4.closeReason === 'signed_out', 'the bracket closed as "signed_out"',
    a4?.closeReason ?? 'still open');
  A(await events('shadow.ascended', adminId, A1.id, t0) === 1,
    'and the customer was told at the moment they logged out, not an hour later');
  A((await openRows(adminId)).length === 0, 'nothing is left open anywhere');

  // ── 5b · THE HEARTBEAT — the sweep must NOT evict somebody who is still here ──────────────
  //
  // This is the defect the heartbeat exists for, and phase 4 above is its mirror: there, an idle
  // bracket SHOULD be swept. Here an idle-looking bracket that has just reported liveness must
  // survive. A drive that only checked phase 4 would pass with the heartbeat deleted.
  phase('5b · heartbeat — a live actor survives the sweep');
  await page.goto(`${BASE}/portal/${A1.slug}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  A((await openRows(adminId)).length === 1, 'a bracket is open');
  // Age it past the floor, exactly as phase 4 does — same state, and then one ping.
  await sql`UPDATE space_presence SET last_seen_at = now() - interval '3 hours'
             WHERE user_id = ${adminId}::uuid AND closed_at IS NULL`;
  const hb = await page.request.post(`${BASE}/api/presence/heartbeat`, { data: {} });
  A(hb.status() === 200, 'the heartbeat answers', `HTTP ${hb.status()}`);
  A(((await hb.json())?.data?.touched ?? 0) === 1, 'and it touched the open bracket');
  const sweep2 = await page.request.post(`${BASE}/api/admin/space-presence/sweep`, {
    data: { idleMinutes: 30 },
  });
  A(sweep2.status() === 200, 'the sweep runs', `HTTP ${sweep2.status()}`);
  A(((await sweep2.json())?.data?.closed ?? -1) === 0, 'and closes NOTHING — the actor is still here');
  A((await openRows(adminId)).length === 1, 'the bracket survived', `${(await openRows(adminId)).length} open`);

  // A heartbeat must never OPEN a bracket or reopen a closed one — otherwise a stale tab is a way
  // back into a customer's workspace, and the ping stops being a report and becomes an action.
  await closeAllFor(adminId);
  const hb2 = await page.request.post(`${BASE}/api/presence/heartbeat`, { data: {} });
  A(((await hb2.json())?.data?.touched ?? -1) === 0, 'a heartbeat with nothing open touches nothing');
  A((await openRows(adminId)).length === 0, 'and did NOT open a bracket of its own');

  // ── 6 · THE INVARIANT, over the whole box ─────────────────────────────────────────────────
  phase('6 · no enter without an exit — every bracket, every tenant');
  const leaks = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM space_presence
    WHERE closed_at IS NULL AND last_seen_at < now() - interval '1 day'`;
  A((leaks[0]?.n ?? 0) === 0, 'no bracket has been open for more than a day', `${leaks[0]?.n ?? 0}`);

  // The half-open pair the CHECK constraint forbids — asserted, not assumed, because a constraint
  // that was never exercised is a comment.
  const halfOpen = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM space_presence
    WHERE (closed_at IS NULL) <> (close_reason IS NULL)`;
  A((halfOpen[0]?.n ?? 0) === 0, 'no row is closed without a reason, or reasoned without a close');

  console.log();
  if (bad === 0) console.log('✓ Every way out closes the bracket, and every exit reached the company it left.');
  else console.error(`✗ ${bad} check(s) failed — an enter can still go unmatched.`);
} catch (e) {
  console.error('drive failed:', e instanceof Error ? e.message : String(e));
  bad = bad || 1;
} finally {
  // Our own rows only. The EVENTS stay: an audit trail a test can erase is not an audit trail,
  // and the next run watermarks on `created_at` rather than on an empty table.
  if (adminId) { try { await sql`DELETE FROM space_presence WHERE user_id = ${adminId}::uuid`; } catch { /* ignore */ } }
  await browser.close();
  await sql.end();
}
process.exit(bad === 0 ? 0 : 1);
