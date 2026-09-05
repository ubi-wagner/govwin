#!/usr/bin/env node --import tsx
/**
 * drive-task-claim.mts — can a person say "I'm on this", and does the queue survive them leaving?
 *
 * ── THE ABSENCE THIS PROVES CLOSED ───────────────────────────────────────────────────────────
 * `tasks.status` has allowed 'in_progress' since the table was created, `idx_tasks_nudge_sweep`
 * indexes it, and NOTHING ever wrote it. Measured before mig 249:
 *
 *     open 47 · completed 65 · expired 2 · in_progress 0
 *
 * So a ToDo was binary, and four costs followed: nothing recorded that work had STARTED; two people
 * could start the same item unsignalled; an operator could not tell untouched from half-done; and
 * there was nowhere to come back to, so interrupted work restarted.
 *
 * That is the "have to start over again" case — and it matters MORE now, not less. The session
 * bounds (P1/P2) guarantee people are signed out mid-task; that is their whole point. A claim with
 * no expiry would turn that improvement into a stalled queue.
 *
 * ── WHAT IT DRIVES ───────────────────────────────────────────────────────────────────────────
 *   1 a person claims a ToDo through the real route          → in_progress, claimed_by, event
 *   2 a SECOND person is refused, and the refusal NAMES the holder
 *   3 the holder can renew their own claim (re-claiming is not a conflict)
 *   4 an abandoned claim is swept back to `open` with an event
 *   5 the QUEUE PAGE says who is on it and offers the resume link
 *   6 a claim does not block completion — it is not a lock
 *
 * Check 6 is the pairing that keeps this honest. Without it, an implementation that made claims
 * block would pass every other check while quietly turning a hint into an outage.
 *
 *   cd frontend && node --import tsx scripts/drive-task-claim.mts
 *
 * Exit 0 proven · 1 a check failed · 2 could not run.  ⚠ Creates and removes its own task.
 */
import { chromium, type APIRequestContext } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EXE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const sql = postgres(DB, { max: 3, onnotice: () => {} });

let bad = 0;
const ok = (m: string, d = '') => console.log(`  ✓ ${m}${d ? ` — ${d}` : ''}`);
const no = (m: string, d = '') => { console.log(`  ✗ ${m}${d ? ` — ${d}` : ''}`); bad += 1; };
const phase = (t: string) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 70 - t.length))}`);
const cannot = async (why: string) => {
  console.error(`CANNOT RUN\n  ${why}`); await sql.end(); process.exit(2);
};

const [col] = await sql<{ n: string }[]>`
  SELECT count(*)::text AS n FROM information_schema.columns
   WHERE table_name = 'tasks' AND column_name = 'claimed_by'`;
if (col?.n !== '1') await cannot('tasks.claimed_by is absent — apply migration 249');

/**
 * TWO people in ONE tenant, because check 2 needs a second actor.
 *
 * SELECT FOR WHAT THE DRIVE NEEDS, not for what is merely nearest. The first version filtered on
 * the MEMBERSHIP role and picked a `partner_admin` who holds a membership in this company — a
 * perfectly valid member, whose password is not `TENANT_PW`, so the drive reported CANNOT RUN and
 * read like a broken login flow. `users.role` is the account's own kind, and that is what decides
 * which credential opens it. Fourth occurrence of this class in the repo (B146/B147).
 */
const [t] = await sql<{ id: string; slug: string }[]>`
  SELECT t.id, t.slug FROM tenants t
   WHERE t.archived_at IS NULL
     AND (SELECT count(*) FROM user_memberships m
           JOIN users u ON u.id = m.user_id AND u.is_active
          WHERE m.tenant_id = t.id AND m.status = 'active'
            AND u.role IN ('tenant_admin','tenant_user')) >= 2
   ORDER BY t.created_at LIMIT 1`;
if (!t) await cannot('no tenant with two tenant-role members — check 2 needs a second person');

const members = await sql<{ id: string; email: string; role: string }[]>`
  SELECT u.id, u.email, u.role FROM user_memberships m
    JOIN users u ON u.id = m.user_id AND u.is_active
   WHERE m.tenant_id = ${t!.id}::uuid AND m.status = 'active'
     AND u.role IN ('tenant_admin','tenant_user')
   ORDER BY (u.role = 'tenant_admin') DESC, u.created_at LIMIT 2`;
if (members.length < 2) await cannot('could not resolve two members');
const [alice, bob] = members;

const RESUME = `/portal/${t!.slug}/cards`;
let taskId = '';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function signIn(email: string, password: string = TENANT_PW) {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 30_000 });
  await p.fill('#email', email);
  await p.fill('#password', password);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(1200);
  const okIn = !p.url().includes('/login');
  return { ctx: c, page: p, ok: okIn };
}

const claimUrl = (id: string) => `${BASE}/api/portal/${t!.slug}/tasks/${id}/claim`;
const post = (r: APIRequestContext, id: string) => r.post(claimUrl(id), { failOnStatusCode: false });

const A = await signIn(alice.email);
const B = await signIn(bob.email);

try {
  console.log(`── task claims · ${BASE}`);
  console.log(`   tenant=${t!.slug}  alice=${alice.email}  bob=${bob.email}\n`);
  if (!A.ok) await cannot(`${alice.email} could not sign in (TENANT_PW)`);
  if (!B.ok) await cannot(`${bob.email} could not sign in (TENANT_PW)`);

  // A ToDo of this drive's own making, assigned to the ROLE both members hold, with a resume link.
  const [made] = await sql<{ id: string }[]>`
    INSERT INTO tasks (tenant_id, assignee_role, task_type, title, description, resume_href, status)
    VALUES (${t!.id}::uuid, 'tenant_user', 'generic', 'Claim drive fixture',
            'Created by drive-task-claim.mts', ${RESUME}, 'open')
    RETURNING id`;
  taskId = made.id;

  phase('1 · a person claims it');
  const r1 = await post(A.ctx.request, taskId);
  const b1 = await r1.json().catch(() => null);
  if (r1.status() === 200) ok('the claim route accepts it', `resumeHref=${b1?.data?.resumeHref ?? 'none'}`);
  else no('the claim was refused', `${r1.status()} ${JSON.stringify(b1).slice(0, 90)}`);

  const [row1] = await sql<{ status: string; claimedBy: string | null }[]>`
    SELECT status, claimed_by AS "claimedBy" FROM tasks WHERE id = ${taskId}::uuid`;
  if (row1?.status === 'in_progress' && row1.claimedBy === alice.id) {
    ok('the row says in_progress and names the holder', 'the state `in_progress` finally has a writer');
  } else {
    no('the row did not record the claim', `status=${row1?.status} by=${row1?.claimedBy}`);
  }
  // `system_events` has (namespace, type, payload) — there is no `event_type` and no `entity_id`
  // column; the entity travels IN the payload. Guessing those names cost a run: the query threw
  // 42703 mid-drive, which reads like a broken product and is a harness reading the wrong schema.
  const [ev1] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM system_events
     WHERE namespace = 'system' AND type = 'task.claimed'
       AND payload->>'taskId' = ${taskId}`;
  if (Number(ev1?.n ?? 0) > 0) ok('`system:task.claimed` was emitted');
  else no('no task.claimed event — the claim is invisible to the audit trail');

  phase('2 · a second person is refused, and told WHO has it');
  const r2 = await post(B.ctx.request, taskId);
  const b2 = await r2.json().catch(() => null);
  if (r2.status() === 409 && b2?.code === 'ALREADY_CLAIMED') {
    ok('the second claim is refused 409 ALREADY_CLAIMED');
    // The refusal must NAME the holder. "Someone is working on this" is the difference between a
    // useful message and a button that looks broken.
    const named = typeof b2?.error === 'string'
      && (b2.error.includes(alice.email) || /is already working on this/.test(b2.error))
      && !/^someone else is/i.test(b2.error);
    if (named) ok('and the message names the holder', b2.error);
    else no('the refusal does not say who has it', String(b2?.error).slice(0, 70));
  } else {
    no('a second person was NOT refused', `${r2.status()} ${JSON.stringify(b2).slice(0, 80)}`);
  }

  phase('3 · the holder can renew their own claim');
  const r3 = await post(A.ctx.request, taskId);
  if (r3.status() === 200) ok('re-claiming your own task renews it rather than conflicting');
  else no('the holder was refused their own claim', String(r3.status()));

  phase('4 · an abandoned claim goes back to the queue');
  await sql`UPDATE tasks SET claimed_at = now() - interval '10 hours' WHERE id = ${taskId}::uuid`;

  // Drive the REAL sweep route as a REAL admin. The first version imported `sweepStaleClaims`
  // directly, which tsx could not even parse — and would have been the weaker test anyway: calling
  // the domain function proves the SQL, while calling the route proves the SQL *and* that a
  // scheduler poke reaches it. The tenant refusal is asserted first, because an admin-only sweep
  // that any member could trigger is its own defect.
  const tenantSweep = await A.ctx.request.post(`${BASE}/api/admin/tasks/sweep-claims`, { failOnStatusCode: false });
  if (tenantSweep.status() === 403 || tenantSweep.status() === 401) {
    ok('the sweep route refuses a tenant actor', `HTTP ${tenantSweep.status()}`);
  } else {
    no('a tenant member could run the admin claim sweep', `HTTP ${tenantSweep.status()}`);
  }
  const ADMIN = await signIn(process.env.SWEEP_ADMIN_EMAIL || 'eric@rfppipeline.com',
    process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
  if (!ADMIN.ok) await cannot('the admin could not sign in — the sweep phase cannot be driven');
  const sweep = await ADMIN.ctx.request.post(`${BASE}/api/admin/tasks/sweep-claims`, { failOnStatusCode: false });
  const released = (await sweep.json().catch(() => null))?.data?.released ?? 0;
  await ADMIN.ctx.close();
  const [row4] = await sql<{ status: string; claimedBy: string | null }[]>`
    SELECT status, claimed_by AS "claimedBy" FROM tasks WHERE id = ${taskId}::uuid`;
  if (row4?.status === 'open' && row4.claimedBy === null) {
    ok('the stale claim was returned to the queue', `${released} released`);
  } else {
    no('the stale claim was not swept', `status=${row4?.status} by=${row4?.claimedBy}`);
  }
  const [ev4] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM system_events
     WHERE namespace = 'system' AND type = 'task.claim_expired'
       AND payload->>'taskId' = ${taskId}`;
  if (Number(ev4?.n ?? 0) > 0) ok('`system:task.claim_expired` was emitted', 'the release is not silent');
  else no('the expiry is silent — nobody can tell why the task came back');

  phase('5 · the QUEUE PAGE shows it');
  const bobClaim = await post(B.ctx.request, taskId);      // Bob takes it → Alice sees a foreign claim
  if (bobClaim.status() === 200) ok('the second person can claim it once it is back in the queue');
  else no('Bob could not claim the released task', `HTTP ${bobClaim.status()}`);

  await A.page.goto(`${BASE}/portal/${t!.slug}/todos`, { waitUntil: 'domcontentloaded' });
  await A.page.waitForLoadState('networkidle').catch(() => {});
  // The queue polls on an interval and renders after its own fetch; wait for the ROW rather than a
  // fixed sleep, or a slow load reports the feature missing.
  await A.page.waitForSelector('li:has-text("Claim drive fixture")', { timeout: 20_000 }).catch(() => {});

  /**
   * SCOPED TO THE TASK ROW, not the page.
   *
   * The first version asserted `a[href="/portal/<slug>/cards"]` anywhere on the page and PASSED —
   * because that is also the sidebar's Opportunities link. A page-wide locator for a link the nav
   * already contains cannot fail, so it measured nothing while reporting a green. Everything here
   * is read inside the `<li>` for this task.
   */
  const row = A.page.locator('li', { hasText: 'Claim drive fixture' }).first();
  const rowText = ((await row.textContent().catch(() => '')) || '').replace(/\s+/g, ' ');
  if (/is on this/.test(rowText)) ok('the row tells Alice somebody else is on it', rowText.slice(0, 60));
  else no('the row does not show the claim', rowText.slice(0, 90) || '(row not found)');
  const hasResume = await row.locator(`a[href="${RESUME}"]`).count();
  if (hasResume > 0) ok('and the resume link is ON THE ROW', RESUME);
  else no('no resume link on the row — coming back still means hunting for the work');

  phase('6 · a claim is NOT a lock');
  // Bob holds it; Alice — an authorised assignee — must still be able to finish it. Without this
  // check, an implementation that made claims BLOCK would pass everything above.
  const done = await A.ctx.request.post(`${BASE}/api/portal/${t!.slug}/tasks`, {
    data: { taskId, result: { note: 'completed by a non-holder' } }, failOnStatusCode: false,
  });
  if (done.status() === 200) ok('a claim held by someone else does not block completion');
  else no('a claim BLOCKED completion — that makes it a lock, not a hint', `HTTP ${done.status()}`);
} finally {
  if (taskId) {
    await sql`DELETE FROM system_events WHERE payload->>'taskId' = ${taskId}`.catch(() => {});
    await sql`DELETE FROM tasks WHERE id = ${taskId}::uuid`.catch(() => {});
    console.log(`\n  MUTATED, then removed: 1 task + its events`);
  }
  await browser.close();
  await sql.end();
}

console.log();
if (bad === 0) console.log('✓ a ToDo can be claimed, is not a lock, and comes back when abandoned.');
else console.log(`✗ ${bad} check(s) failed.`);
process.exit(bad === 0 ? 0 : 1);
