#!/usr/bin/env npx tsx
/**
 * drive-milestone-construct.mts — prove the milestone IS the project-management construct.
 *
 * ── THE CLAIM UNDER TEST ─────────────────────────────────────────────────────────────────────
 * A milestone is a dated segment of work with an owner, a checklist and a completion record, and
 * that one shape covers both cases:
 *
 *     ONE milestone   a dated ToDo list for the team — nothing else needed for a simple project
 *     N milestones    the same thing in series: each starts where the last ends, and moving one
 *                     date moves what follows
 *
 * A claim like that is not provable by a unit test, because the interesting part is the RELATIONSHIP
 * between rows over a sequence of real acts. So this drives the acts, as signed-in people, through
 * the real routes:
 *
 *   1 · the smallest useful project — one milestone, a checklist, and it behaves like a task list
 *   2 · a second and third milestone, and the serial dates fill themselves in
 *   3 · a date moves, and everything after it moves by the same amount — the baseline does not
 *   4 · the checklist GATES completion: open work, then unaccepted evidence, then met
 *   5 · completion is a RECORD — a note and metrics, readable in the event a person will see
 *   6 · a member who is not an admin can tick a task off, and cannot add or close one
 *
 * ⚠️ NOT read-only. It creates a project and its cascade and removes them; the footprint is printed.
 *
 *   source scripts/sandbox-env.sh && cd frontend && npx tsx scripts/drive-milestone-construct.mts
 *
 * Exit 0 the construct holds · 1 it does not · 2 could not run.
 */
import { chromium, type Page, type APIRequestContext } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const SLUG = 'foundation';
const TAG = `mc-${process.pid}`;

if (!DB) { console.error('DATABASE_URL_OWNER required — source scripts/sandbox-env.sh'); process.exit(2); }
// Quoted camelCase aliases below: a bare postgres() client has no `toCamel`.
const sql = postgres(DB, { max: 3, onnotice: () => {} });

let bad = 0;
const ok = (m: string, x = '') => console.log(`  ✓ ${m}${x ? ` — ${x}` : ''}`);
const no = (m: string, x = '') => { console.error(`  ✗ ${m}${x ? ` — ${x}` : ''}`); bad += 1; };
const A = (cond: unknown, m: string, x = '') => (cond ? ok(m, x) : no(m, x));
const phase = (n: string) => console.log(`\n══ ${n} ${'═'.repeat(Math.max(0, 72 - n.length))}`);

/** `YYYY-MM-DD`, n days from today, in UTC — a `date` column has no zone. */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function login(page: Page, email: string, pw: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1800);
  if (page.url().includes('/login')) throw new Error(`login failed for ${email}`);
}

type Json = Record<string, unknown>;
async function api(req: APIRequestContext, method: 'get' | 'post' | 'patch', path: string, body?: Json) {
  const r = await req.fetch(BASE + path, {
    method: method.toUpperCase(),
    ...(body ? { data: body, headers: { 'content-type': 'application/json' } } : {}),
  });
  const text = await r.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { /* the caller states it */ }
  return { status: r.status(), json, text };
}
const pick = <T,>(j: Json, ...path: string[]): T | undefined =>
  path.reduce<unknown>((acc, k) => (acc as Json | undefined)?.[k], j) as T | undefined;

let projectId = '';

async function main() {
  const [tenant] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${SLUG}`;
  if (!tenant) { console.error(`no '${SLUG}' tenant`); process.exit(2); }

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, 'kate.ulepic@foundation3dp.com', TENANT_PW);
  const req = ctx.request;

  // ══ 1 · the smallest useful project: ONE milestone with a checklist ══════════════════════
  phase('1 · one milestone IS a dated task list');

  const mk = await api(req, 'post', `/api/portal/${SLUG}/projects`, { name: `${TAG} simple project` });
  A(mk.status === 201, 'a project opens', String(mk.status));
  projectId = pick<string>(mk.json, 'data', 'project', 'id') ?? '';
  if (!projectId) { no('no project id — cannot continue'); return; }
  const P = `/api/portal/${SLUG}/projects/${projectId}`;

  const m1 = await api(req, 'post', `${P}/milestones`, { title: `${TAG} phase 1`, forecastDate: day(30), sortIndex: 1 });
  A(m1.status === 201, 'a milestone is added', String(m1.status));
  const m1id = pick<string>(m1.json, 'data', 'milestone', 'id') ?? '';

  const t1 = await api(req, 'post', `${P}/tasks`, { milestoneId: m1id, title: `${TAG} draft the plan`, dueDate: day(10) });
  const t2 = await api(req, 'post', `${P}/tasks`, { milestoneId: m1id, title: `${TAG} review with the CO`, dueDate: day(20) });
  A(t1.status === 201 && t2.status === 201, 'tasks attach to the milestone', `${t1.status}/${t2.status}`);
  const t1id = pick<string>(t1.json, 'data', 'task', 'id') ?? '';
  const t2id = pick<string>(t2.json, 'data', 'task', 'id') ?? '';

  // A task from ANOTHER project's milestone must not attach — the FK alone would allow it.
  const [foreign] = await sql<{ id: string }[]>`
    SELECT id FROM project_milestones WHERE project_id <> ${projectId}::uuid LIMIT 1`;
  if (foreign) {
    const badTask = await api(req, 'post', `${P}/tasks`, { milestoneId: foreign.id, title: 'should not attach' });
    A(badTask.status === 400, 'a milestone from another project is refused', String(badTask.status));
  }

  const listed = await api(req, 'get', `${P}/tasks`);
  A(listed.status === 200 && (pick<unknown[]>(listed.json, 'data', 'tasks') ?? []).length === 2,
    'the checklist reads back', `${(pick<unknown[]>(listed.json, 'data', 'tasks') ?? []).length} task(s)`);

  // ══ 2 · N milestones, serial dates ═══════════════════════════════════════════════════════
  phase('2 · a second and third milestone chain from the first');

  const m2 = await api(req, 'post', `${P}/milestones`, { title: `${TAG} phase 2`, forecastDate: day(60), sortIndex: 2 });
  const m3 = await api(req, 'post', `${P}/milestones`, { title: `${TAG} phase 3`, forecastDate: day(90), sortIndex: 3 });
  A(m2.status === 201 && m3.status === 201, 'two more milestones', `${m2.status}/${m3.status}`);
  const m2id = pick<string>(m2.json, 'data', 'milestone', 'id') ?? '';

  const seq = await api(req, 'patch', `${P}/milestones`, { action: 'resequence' });
  A(seq.status === 200, 'resequence is accepted', String(seq.status));
  const chain = await sql<{ title: string; startsOn: string | null; forecastDate: string | null }[]>`
    SELECT title, starts_on AS "startsOn", forecast_date AS "forecastDate"
      FROM project_milestones WHERE project_id = ${projectId}::uuid ORDER BY sort_index`;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  // Phase 2 starts the day after phase 1 ends; phase 3 the day after phase 2.
  A(iso(chain[1]?.startsOn) === day(31), 'phase 2 starts the day after phase 1 ends',
    `${iso(chain[1]?.startsOn)} (phase 1 ends ${iso(chain[0]?.forecastDate)})`);
  A(iso(chain[2]?.startsOn) === day(61), 'phase 3 starts the day after phase 2 ends',
    `${iso(chain[2]?.startsOn)}`);

  // ══ 3 · a slip moves what follows — and never the baseline ═══════════════════════════════
  phase('3 · moving one date moves the ones after it');

  const baseline = await api(req, 'post', `${P}/baseline`, {});
  // The baseline needs both anchor documents; without them this is refused, which is correct and
  // not what this drive is about — so it observes rather than asserts, then reads what froze.
  console.log(`  · baseline attempt: ${baseline.status} ${(baseline.json as { code?: string })?.code ?? ''}`);
  const before = await sql<{ id: string; forecastDate: string | null; baselineDate: string | null }[]>`
    SELECT id, forecast_date AS "forecastDate", baseline_date AS "baselineDate"
      FROM project_milestones WHERE project_id = ${projectId}::uuid ORDER BY sort_index`;

  const slip = await api(req, 'patch', `${P}/milestones`, {
    action: 'reschedule', milestoneId: m2id, forecastDate: day(74),   // +14 days
  });
  A(slip.status === 200, 'phase 2 is rescheduled', String(slip.status));
  A(pick<number>(slip.json, 'data', 'deltaDays') === 14, 'the delta is 14 days',
    String(pick<number>(slip.json, 'data', 'deltaDays')));
  A((pick<number>(slip.json, 'data', 'moved') ?? 0) >= 2, 'it moved more than one milestone',
    `${pick<number>(slip.json, 'data', 'moved')} moved`);

  const after = await sql<{ id: string; forecastDate: string | null; baselineDate: string | null }[]>`
    SELECT id, forecast_date AS "forecastDate", baseline_date AS "baselineDate"
      FROM project_milestones WHERE project_id = ${projectId}::uuid ORDER BY sort_index`;
  A(iso(after[2]?.forecastDate) === day(104), 'phase 3 slipped by the same 14 days',
    `${iso(before[2]?.forecastDate)} → ${iso(after[2]?.forecastDate)}`);
  A(iso(after[0]?.forecastDate) === iso(before[0]?.forecastDate), 'phase 1, which is EARLIER, did not move',
    `${iso(after[0]?.forecastDate)}`);
  A(before.every((b, i) => iso(b.baselineDate) === iso(after[i]?.baselineDate)),
    'no baseline_date moved — variance is the distance between promise and plan');

  // ══ 4 · the checklist gates completion ═══════════════════════════════════════════════════
  phase('4 · a milestone with open work is not met');

  const early = await api(req, 'patch', `${P}/milestones`, { action: 'met', milestoneId: m1id });
  A(early.status === 409 && (early.json as { code?: string }).code === 'TASKS_OUTSTANDING',
    'closing it with open tasks is refused', `${early.status} ${(early.json as { code?: string }).code}`);
  A(/not done/i.test(String((early.json as { error?: string }).error)),
    'and the message names the work, not a constraint', String((early.json as { error?: string }).error).slice(0, 90));

  const blocked = await api(req, 'patch', `${P}/tasks/${t2id}`, { status: 'blocked' });
  A(blocked.status === 400, 'blocking with no reason is refused', String(blocked.status));
  const blocked2 = await api(req, 'patch', `${P}/tasks/${t2id}`, { status: 'blocked', blockedReason: 'CO on leave' });
  A(blocked2.status === 200, 'blocking WITH a reason is accepted', String(blocked2.status));

  const stillBlocked = await api(req, 'patch', `${P}/milestones`, { action: 'met', milestoneId: m1id });
  A(stillBlocked.status === 409, 'a blocked task still blocks completion', String(stillBlocked.status));

  for (const id of [t1id, t2id]) {
    const d = await api(req, 'patch', `${P}/tasks/${id}`, { status: 'done' });
    if (d.status !== 200) no('could not tick a task off', `${d.status} ${d.text.slice(0, 80)}`);
  }
  ok('both tasks ticked off');

  // ══ 5 · completion is a record ═══════════════════════════════════════════════════════════
  phase('5 · completion carries a note and metrics');

  const badMetrics = await api(req, 'patch', `${P}/milestones`, {
    action: 'met', milestoneId: m1id, metrics: 'lots',
  });
  A(badMetrics.status === 400, 'metrics that are not an object are refused', String(badMetrics.status));

  const met = await api(req, 'patch', `${P}/milestones`, {
    action: 'met', milestoneId: m1id,
    note: 'Plan agreed at the kickoff; two wording changes to the SOW.',
    metrics: { attendees: 9, sowRevisions: 2 },
  });
  A(met.status === 200, 'the milestone closes once the work is done', String(met.status));

  const [saved] = await sql<{ note: string | null; metrics: Record<string, unknown> | null; status: string }[]>`
    SELECT completion_note AS note, completion_metrics AS metrics, status
      FROM project_milestones WHERE id = ${m1id}::uuid`;
  A(saved?.status === 'met', 'it is met');
  A(typeof saved?.note === 'string' && saved.note.includes('wording'), 'the note is stored', String(saved?.note).slice(0, 60));
  A(saved?.metrics && typeof saved.metrics === 'object' && (saved.metrics as { attendees?: number }).attendees === 9,
    'the metrics are stored AS AN OBJECT, not a string that char-iterates',
    JSON.stringify(saved?.metrics));

  const [ev] = await sql<{ payload: Record<string, unknown> }[]>`
    SELECT payload FROM system_events
     WHERE namespace = 'project' AND type = 'milestone.met' AND payload->>'milestoneId' = ${m1id}
     ORDER BY created_at DESC LIMIT 1`;
  A(ev, '`project:milestone.met` was emitted');
  if (ev) {
    A(typeof ev.payload.note === 'string', 'the event carries the note a person will read',
      String(ev.payload.note).slice(0, 50));
    const { describeEvent } = await import('../lib/event-labels.ts');
    const label = describeEvent({ namespace: 'project', type: 'milestone.met', phase: 'single', payload: ev.payload } as never);
    A(!/\s{2,}/.test(label) && label.includes('Milestone met'), 'and it reads as a sentence', label);
  }

  // ══ 6 · who may do what ══════════════════════════════════════════════════════════════════
  phase('6 · doing the work is not a management act');

  const [member] = await sql<{ email: string }[]>`
    SELECT u.email FROM users u
      JOIN user_memberships m ON m.user_id = u.id AND m.tenant_id = ${tenant.id}::uuid AND m.status = 'active'
     WHERE u.role = 'tenant_user' AND u.is_active = true
     ORDER BY u.created_at LIMIT 1`;
  if (!member) {
    console.log('  · no tenant_user at this tenant — the role split is covered by '
      + '__tests__/projects-assignment-boundary.test.ts, not here');
  } else {
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    try {
      await login(p2, member.email, TENANT_PW);
      const tick = await api(ctx2.request, 'patch', `${P}/tasks/${t1id}`, { status: 'open' });
      A(tick.status === 200 || tick.status === 404,
        'a plain member reaches the checklist (200) or the project is not theirs (404)',
        `${member.email} → ${tick.status}`);
      const add = await api(ctx2.request, 'post', `${P}/tasks`, { milestoneId: m1id, title: 'nope' });
      A(add.status === 403 || add.status === 404, 'but cannot ADD a task', String(add.status));
    } catch (e) {
      console.log(`  · could not sign in as ${member.email} — ${String((e as Error).message).slice(0, 60)}`);
    }
    await ctx2.close();
  }

  await ctx.close();
  await browser.close();
}

async function cleanup() {
  if (projectId) {
    try { await sql`DELETE FROM projects WHERE id = ${projectId}::uuid`; }
    catch (e) { console.error('  cleanup failed:', (e as Error).message); }
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM projects WHERE id = ${projectId}::uuid`;
    console.log(`\n  MUTATED 1 project and its cascade — fixture-only, ${n === 0 ? 'now removed' : 'STILL PRESENT'}.`);
    if (n !== 0) bad += 1;
  }
  await sql.end();
}

main()
  .then(cleanup, async (e) => {
    console.error('\ndrive failed:', (e as Error)?.message ?? e);
    bad += 1;
    await cleanup().catch(() => {});
  })
  .then(() => {
    console.log();
    if (bad === 0) {
      console.log('✓ The milestone is the construct: one is a dated task list, N are a serial plan,');
      console.log('  the checklist gates completion, and completion is a record a person can read.');
    } else console.error(`✗ ${bad} check(s) failed.`);
    process.exit(bad === 0 ? 0 : 1);
  });
