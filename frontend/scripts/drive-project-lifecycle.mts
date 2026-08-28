#!/usr/bin/env npx tsx
/**
 * drive-project-lifecycle.mts — the WHOLE Projects spine, end to end, live.
 *
 * ── WHY THIS IS NOT A LENS ───────────────────────────────────────────────────────────────────
 * Every lens in this repo asks a question about a surface at rest: does it render, is the envelope
 * right, does the number match, does a write land. None of them asks the only question a customer
 * actually has — **does the thing happen.** An award is recorded and, twelve minutes later, is there
 * a task in someone's queue? Does the workflow engine, which is a separate Python process polling a
 * shared table, notice? Does the notification reach the mail seam? Does the baseline freeze, does
 * acceptance close a milestone, and does the variance land in the event a person will read months
 * later?
 *
 * That chain crosses three runtimes (Next, Postgres, the Python engine), two trust boundaries (RLS
 * and the assignment predicate) and one human gate. Nothing that tests a piece can see it.
 *
 * ── THE ACTORS ARE REAL ──────────────────────────────────────────────────────────────────────
 * Every write goes through a signed-in browser session hitting the real route — no forged headers,
 * no direct SQL for anything a person does. SQL is used only to OBSERVE (poll for what the engine
 * did) and to set up the one precondition a person cannot create in the sandbox (a proposal to win).
 *
 * ── WHAT IT REPORTS THAT IT CANNOT DO ────────────────────────────────────────────────────────
 * Agent participation is measured, not assumed. If nothing in the fabric consumes `project:*`, this
 * says so as a NUMBER rather than staying quiet — an unwired capability is a gap, and silence about
 * it reads exactly like coverage.
 *
 *   source scripts/sandbox-env.sh
 *   cd frontend && npx tsx scripts/drive-project-lifecycle.mts
 *
 * ⚠️ NOT read-only. It records an award, opens a project and drives it to a met milestone. The
 * footprint is printed. Sandbox only — `pg_dump` before, `pg_restore` after.
 *
 * Exit 0 the whole chain holds · 1 a link is broken · 2 it could not run.
 */
import { chromium, type Page, type APIRequestContext, type BrowserContext } from 'playwright';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';

/**
 * ── THE SEAM WITH THE PRE-AWARD ARC ──────────────────────────────────────────────────────────
 * `drive-end-to-end.mjs` runs the first half — a government PDF nobody wrote for us → ingest →
 * curate → push → discover → buy → provision → author → lock → package → download — and journals
 * the ids it produced. This drive runs the second half.
 *
 * Run alone, it SYNTHESISES a submitted proposal with SQL, which is honest but proves nothing
 * about the joint: a proposal I inserted is not a proposal the product authored and locked. When
 * the arc's journal is present it is used instead, so the two halves are ONE continuous artifact
 * and the award is recorded against a build that actually went through the mill.
 *
 * Which mode it is in is printed, loudly, because a reader has to know whether the seam was
 * crossed or stepped over.
 */
const RUN_DIR = process.env.GOVWIN_RUN_DIR || `${process.env.HOME}/.govwin/run`;
const ARC_JOURNAL = `${RUN_DIR}/e2e-arc.json`;

if (!DB) { console.error('DATABASE_URL_OWNER required — source scripts/sandbox-env.sh'); process.exit(2); }
// Quoted camelCase aliases everywhere below: a bare postgres() client has no `toCamel`, and a
// snake_case read off a camelCase-typed row is silently `undefined` (it has shipped three times).
const sql = postgres(DB, { max: 3, onnotice: () => {} });

let bad = 0;
const ok = (m: string, extra = '') => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ''}`);
const no = (m: string, extra = '') => { console.error(`  ✗ ${m}${extra ? ` — ${extra}` : ''}`); bad += 1; };
const A = (cond: unknown, m: string, extra = '') => (cond ? ok(m, extra) : no(m, extra));
const phase = (n: string) => console.log(`\n══ ${n} ${'═'.repeat(Math.max(0, 74 - n.length))}`);

/** Poll until `fn` returns something truthy, or give up. The engine polls every ~10s. */
async function until<T>(what: string, fn: () => Promise<T | null>, seconds = 45): Promise<T | null> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) { no(`timed out after ${seconds}s waiting for ${what}`); return null; }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function login(page: Page, email: string, pw: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
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
  try { json = JSON.parse(text) as Json; } catch { /* non-JSON is a finding the caller states */ }
  return { status: r.status(), json, text };
}

/**
 * A uuid that resolves to NOTHING, and must keep doing so.
 *
 * Three assertions below prove a refusal — a person who is not on the project, a milestone from
 * another contract — and each needs an id that exists nowhere. Absent from the database is its
 * required state, not rot.
 *
 * Named this way on purpose: `audit-pinned-fixtures.mjs` reads the NAME to tell a dead id somebody
 * depends on from one they are proving is refused, and it strips comments before it scans, so a
 * marker comment would vanish. It also reads correctly at the call site — `assigneeUserId: NOBODY`
 * says what it is doing where it is doing it.
 */
const NOBODY = '11111111-1111-4111-8111-111111111111';

/**
 * An address that belongs to nobody, and must keep belonging to nobody.
 *
 * The mention assertion needs a token that resolves to no member: an unmatched mention has to be
 * REPORTED BACK, or the author types a name, sees the comment appear, and believes they were heard.
 *
 * Not exempted by the audit's `example.com` rule and it should not be — `.test` addresses ARE real
 * rows in this database (the trigger probes), so blanket-exempting the TLD would hide genuine rot.
 * Named instead, like NOBODY above.
 */
const NOBODY_EMAIL = 'nobody@elsewhere.test';

const created: { proposalId?: string; projectId?: string; contractId?: string; documentIds: string[] } = {
  documentIds: [],
};

/**
 * `KEEP=1` leaves the run's rows in place.
 *
 * Not a convenience: `probe-deliverable-artifacts.mts` opens the AUTHORED deliverable documents with
 * LibreOffice, and it can only do that while the deliverable that owns them still exists. Cleaning
 * up first and then reporting "no authored deliverable" would be the probe measuring the drive's
 * tidying rather than the product.
 */
const KEEP = process.env.KEEP === '1';

/** The arc's own artifact, if it ran. `null` means "synthesise one and say so". */
async function fromArc(): Promise<{ proposalId: string; tenantSlug: string; actor: string } | null> {
  try {
    const j = JSON.parse(readFileSync(ARC_JOURNAL, 'utf8')) as
      { ids?: { proposal?: string; buyer?: string }; stages?: Record<string, { ok?: boolean }> };
    const proposalId = j.ids?.proposal;
    const buyer = j.ids?.buyer;
    if (!proposalId || !buyer) return null;
    // Only continue from an arc that actually FINISHED authoring — half an arc hands over a
    // proposal in a state the award path was never meant to see, and the failure would read as a
    // defect in this half.
    if (j.stages?.package?.ok !== true && j.stages?.lock?.ok !== true) return null;
    const [row] = await sql<{ slug: string }[]>`
      SELECT t.slug FROM proposals p JOIN tenants t ON t.id = p.tenant_id
       WHERE p.id = ${proposalId}::uuid`;
    if (!row) return null;
    return { proposalId, tenantSlug: row.slug, actor: buyer };
  } catch { return null; }
}

async function main() {
  const arc = await fromArc();
  const TENANT = arc?.tenantSlug ?? 'foundation';
  const ACTOR = arc?.actor ?? 'kate.ulepic@foundation3dp.com';
  const [tenant] = await sql<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${TENANT}`;
  if (!tenant) { console.error(`no '${TENANT}' tenant`); process.exit(2); }
  const tenantId = tenant.id;

  // The engine is a SEPARATE PROCESS. If it is not polling, every automation assertion below would
  // fail for a reason that has nothing to do with the product — so establish it first and exit 2,
  // not 1. A harness that reports "the automation did not fire" when the automation was not running
  // is reporting on itself.
  phase('0 · preconditions');
  const [engine] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM process_templates WHERE trigger_key = 'capture:contract.started:single'`;
  if (!engine?.n) { console.error('  CANT-RUN — OnContractStarted is not registered; start the pipeline worker'); process.exit(2); }
  ok('the workflow engine has registered OnContractStarted', 'capture:contract.started:single');

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, ACTOR, TENANT_PW);
  ok(`signed in as ${ACTOR}`, 'tenant_admin @ ' + TENANT);
  const req = ctx.request;

  // ══ 1 · HITL — a person records the award ═══════════════════════════════════════════════════
  phase('1 · HITL: the award');
  // The build to win. From the arc when it ran; synthesised otherwise, and SAID either way.
  let prop: { id: string; title: string } | undefined;
  if (arc) {
    [prop] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM proposals WHERE id = ${arc.proposalId}::uuid`;
    if (!prop) { console.error('  CANT-RUN — the arc journal names a proposal that is gone'); process.exit(2); }
    ok('CONTINUING THE ARC — this build was ingested, authored, locked and packaged by the product',
      `${prop.title} (${arc.proposalId.slice(0, 8)})`);

    // ── RE-RUNNABLE, and the reset is PRINTED ───────────────────────────────────────────────
    // Recording an outcome archives the proposal, and the route then answers 409
    // ALREADY_ARCHIVED — correct product behaviour, and it makes this drive a one-shot against
    // any given arc artifact. A drive that can only run once is a drive that stops being run
    // (this suite's own header says as much), so an already-awarded artifact is rolled back to
    // the state the arc left it in, out loud, as setup.
    const [state] = await sql<{ stage: string }[]>`
      SELECT stage FROM proposals WHERE id = ${arc.proposalId}::uuid`;
    if (state?.stage === 'archived') {
      const old = await sql<{ id: string }[]>`
        SELECT id FROM contracts WHERE proposal_id = ${arc.proposalId}::uuid`;
      for (const c of old) {
        await sql`DELETE FROM tasks WHERE entity_id = ${c.id}::uuid AND task_type = 'project_setup'`;
        await sql`DELETE FROM projects WHERE contract_id = ${c.id}::uuid`;
      }
      await sql`DELETE FROM contracts WHERE proposal_id = ${arc.proposalId}::uuid`;
      await sql`
        UPDATE proposals SET stage = 'submitted', archived_at = NULL, updated_at = now()
         WHERE id = ${arc.proposalId}::uuid`;
      console.log(`  · SETUP: this artifact was already awarded by an earlier run — rolled back to`);
      console.log(`    'submitted' and removed ${old.length} contract(s) so the award can be driven again.`);
    }
  } else {
    [prop] = await sql<{ id: string; title: string }[]>`
      INSERT INTO proposals (tenant_id, opportunity_id, title, stage, is_locked)
      SELECT ${tenantId}::uuid, o.id, ${'E2E award probe ' + process.pid}, 'submitted', false
        FROM opportunities o ORDER BY o.id LIMIT 1
      RETURNING id, title`;
    if (!prop) { console.error('  CANT-RUN — no opportunity to hang a proposal off'); process.exit(2); }
    created.proposalId = prop.id;   // ours to remove; the arc's is NOT
    console.log('  · STANDALONE — no arc journal, so the build to win is SYNTHESISED. This proves');
    console.log('    the post-award half and says nothing about the joint with the pre-award arc.');
    ok('a submitted build exists to win', prop.title);
  }

  const award = await api(req, 'post', `/api/portal/${TENANT}/proposals/${prop.id}/outcome`,
    { outcome: 'awarded', notes: 'E2E: the customer won.' });
  A(award.status === 200, 'the tenant_admin records outcome=awarded through the real route', `${award.status}`);

  const [contract] = await sql<{ id: string }[]>`
    SELECT id FROM contracts WHERE proposal_id = ${prop.id}::uuid LIMIT 1`;
  A(Boolean(contract), 'a contract entity exists on the winning proposal');
  created.contractId = contract?.id;

  const [evt] = await sql<{ id: string; payload: Json }[]>`
    SELECT id, payload FROM system_events
     WHERE namespace = 'capture' AND type = 'contract.started'
       AND payload->>'proposalId' = ${prop.id} LIMIT 1`;
  A(Boolean(evt), 'capture:contract.started reached the shared event table');

  // ══ 2 · AUTOMATION — the engine, on its own, in another process ═════════════════════════════
  phase('2 · AUTOMATION: the workflow engine reacts');
  const inst = await until('a process_instance for OnContractStarted', async () => {
    const [r] = await sql<{ id: string; status: string }[]>`
      SELECT pi.id, pi.status FROM process_instances pi
       WHERE pi.workflow_name = 'OnContractStarted'
         AND pi.trigger_event_id = ${evt?.id ?? null}::uuid LIMIT 1`;
    return r ?? null;
  });
  A(Boolean(inst), 'the engine created a process instance from the event', inst?.status ?? '');

  const todo = await until('the project_setup ToDo', async () => {
    const [r] = await sql<{ id: string; title: string; assigneeRole: string; status: string }[]>`
      SELECT id, title, assignee_role AS "assigneeRole", status FROM tasks
       WHERE task_type = 'project_setup' AND entity_id = ${created.contractId ?? null}::uuid LIMIT 1`;
    return r ?? null;
  });
  A(Boolean(todo), 'a ToDo landed in a human queue', todo ? `"${todo.title}" → ${todo.assigneeRole}` : '');
  A(todo?.assigneeRole === 'tenant_admin', 'it is addressed to the tenant_admin, not to nobody', todo?.assigneeRole ?? '');

  // The NOTIFY step is INDEPENDENT of the ToDo by design. Whatever it did, it must have SAID so —
  // a notification that neither sent nor recorded a failure is the silent case the seam exists for.
  const notified = await until('the notification step to report', async () => {
    const [r] = await sql<{ type: string; n: number }[]>`
      SELECT type, count(*)::int AS n FROM system_events
       WHERE namespace = 'system' AND type LIKE 'notification.%'
         AND created_at > now() - interval '3 minutes'
       GROUP BY type ORDER BY count(*) DESC LIMIT 1`;
    return r ?? null;
  }, 40);
  A(Boolean(notified), 'the NOTIFY step recorded an outcome rather than vanishing', notified?.type ?? '');

  // ══ 3 · HITL — the person opens the project ═════════════════════════════════════════════════
  phase('3 · HITL: opening the project from the ToDo');
  const mk = await api(req, 'post', `/api/portal/${TENANT}/projects`,
    { name: `E2E ${prop.title}`, contractId: created.contractId });
  A(mk.status === 201 || mk.status === 200, 'the project is created through the portal API', `${mk.status}`);
  created.projectId = ((mk.json.data as Json)?.project as Json)?.id as string | undefined;
  A(Boolean(created.projectId), 'the response carries the new project');
  if (!created.projectId) return;
  const P = `/api/portal/${TENANT}/projects/${created.projectId}`;

  // The two anchor uploads. Not a pointer to the proposal we just won — the whole model turns on
  // measuring against what was SIGNED, not against a working copy that stayed editable.
  for (const [kind, filename] of [['executed_contract', 'executed.pdf'], ['submitted_proposal', 'as-submitted.pdf']]) {
    const r = await req.fetch(BASE + P + '/documents', {
      method: 'POST',
      multipart: { kind, file: { name: filename, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${kind}`) } },
    });
    A(r.status() === 200 || r.status() === 201, `uploaded the ${kind.replace('_', ' ')}`, String(r.status()));
  }

  const [{ docs }] = await sql<{ docs: number }[]>`
    SELECT count(*)::int AS docs FROM project_source_documents WHERE project_id = ${created.projectId}::uuid`;
  A(docs === 2, 'both anchor artifacts are attached to the project', `${docs}`);

  // ══ 4 · HITL — the contractual skeleton ═════════════════════════════════════════════════════
  phase('4 · HITL: CLINs, WBS, milestones');
  const [srcDoc] = await sql<{ id: string }[]>`
    SELECT id FROM project_source_documents
     WHERE project_id = ${created.projectId}::uuid AND kind = 'executed_contract' LIMIT 1`;

  const today = new Date();
  const iso = (d: number) => new Date(today.getTime() + d * 86_400_000).toISOString().slice(0, 10);

  const clin = await api(req, 'post', P + '/clins', {
    clinNumber: '0001', title: 'Base period', contractType: 'FFP',
    popStart: iso(-30), popEnd: iso(300), fundedAmount: 750000,
    citations: { pop_end: { method: 'verified', sourceDocId: srcDoc?.id, page: 12, excerpt: 'The period of performance shall end 330 days after award.' } },
  });
  A(clin.status === 201 || clin.status === 200, 'a CLIN is entered WITH a citation', `${clin.status}`);
  const clinId = ((clin.json.data as Json)?.clin as Json)?.id as string | undefined;

  const [prov] = await sql<{ method: string; page: number }[]>`
    SELECT method, page FROM project_provenance
     WHERE target_table = 'project_clins' AND target_id = ${clinId ?? null}::uuid AND field = 'pop_end'`;
  A(prov?.method === 'verified', 'the citation was recorded as provenance, not dropped', prov ? `${prov.method} p.${prov.page}` : 'none');

  // ── THE WBS ROUTE AND THE MILESTONE ROUTE WRITE THE SAME TABLE (migs 228-229) ───────────────
  //
  // A WBS element IS a milestone. The `/wbs` route is the GRID view of the plan and `/milestones`
  // is the list view; both insert `project_milestones`, which is why this drive counts what the
  // grid creates as part of the plan rather than as a separate structure. It used to create a
  // parent and a child here and treat neither as a phase — so close-out was later blocked by a
  // milestone the drive itself had made and never tracked.
  const wbsRow = await api(req, 'post', P + '/wbs', {
    code: '1.1', title: 'Sensor integration', clinId,
    plannedStart: iso(-30), plannedEnd: iso(30), plannedCost: 250000,
    // Explicit, so the chain below has ONE ordering. Two rows sharing sort_index 0 makes the
    // sequence a function of insertion order, and an assertion about "the phase before" then
    // depends on something nobody declared.
    sortIndex: 1,
  });
  A(wbsRow.status === 201 || wbsRow.status === 200, 'a WBS element is added through the grid', `${wbsRow.status}`);
  const wbsId = ((wbsRow.json.data as Json)?.node as Json)?.id as string | undefined;

  // NESTING IS REFUSED, NOT IGNORED. Accepting a `parentId` and discarding it is how a caller comes
  // to believe in a hierarchy that does not exist, and then writes twelve elements under a parent
  // nothing reads. The message has to say what to do instead.
  const nestedWbs = await api(req, 'post', P + '/wbs', {
    code: '1.1.1', title: 'Sensor bracket', parentId: wbsId,
    plannedStart: iso(-30), plannedEnd: iso(20), plannedCost: 50000,
  });
  A(nestedWbs.status === 400, 'WBS elements do not nest — a parentId is REFUSED', `${nestedWbs.status}`);
  A(/do not nest|sortIndex/i.test(String(nestedWbs.json.error ?? '')),
    'and the refusal says what to do instead', String(nestedWbs.json.error ?? '').slice(0, 70));

  // The same row is visible through the grid, which is the point of one spine: two views, one plan.
  const grid = await api(req, 'get', P + '/wbs');
  const gridRows = ((grid.json.data as Json)?.nodes as unknown[]) ?? [];
  A(gridRows.some((n) => (n as Json)?.id === wbsId),
    'and the grid lists what the grid created', `${gridRows.length} row(s)`);

  const ms = await api(req, 'post', P + '/milestones', {
    title: 'Critical design review', clinId, forecastDate: iso(45),
  });
  A(ms.status === 201 || ms.status === 200, 'a milestone is added', `${ms.status}`);
  const milestoneId = ((ms.json.data as Json)?.milestone as Json)?.id as string | undefined;

  const del = await api(req, 'post', P + '/deliverables', {
    milestoneId, title: 'CDR package', requiredBy: iso(45),
  });
  A(del.status === 201 || del.status === 200, 'a deliverable is declared against the milestone', `${del.status}`);
  const deliverableId = ((del.json.data as Json)?.deliverable as Json)?.id as string | undefined;


  // ══ 4b · the MILESTONE CONSTRUCT — a serial plan with checklists ════════════════════════════
  //
  // Two more milestones, so the plan is a CHAIN and not a single date, and a checklist on each. A
  // milestone with a task list is the smallest useful project; this is that shape repeated.
  phase('4b · HITL: a serial plan, and the people who will work it');

  const ms2 = await api(req, 'post', P + '/milestones', { title: 'Prototype demonstration', clinId, forecastDate: iso(120), sortIndex: 2 });
  const ms3 = await api(req, 'post', P + '/milestones', { title: 'Final report', clinId, forecastDate: iso(180), sortIndex: 3 });
  A(ms2.status === 201 && ms3.status === 201, 'two more phases', `${ms2.status}/${ms3.status}`);
  const ms2id = ((ms2.json.data as Json)?.milestone as Json)?.id as string | undefined;
  const ms3id = ((ms3.json.data as Json)?.milestone as Json)?.id as string | undefined;

  const seq = await api(req, 'patch', P + '/milestones', { action: 'resequence' });
  A(seq.status === 200, 'the plan is sequenced', `${seq.status}`);
  const chain = await sql<{ title: string; startsOn: string | null; forecastDate: string | null }[]>`
    SELECT title, starts_on AS "startsOn", forecast_date AS "forecastDate"
      FROM project_milestones WHERE project_id = ${created.projectId}::uuid ORDER BY sort_index`;
  const d10 = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  const plusDay = (s: string | null) =>
    (s ? new Date(new Date(`${s}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10) : null);

  // ── ASSERT THE PROPERTY, NOT A POSITION ─────────────────────────────────────────────────────
  //
  // These used to be `chain[1]` and `chain[2]` against hard-coded offsets. Migrations 228-229 made
  // the `/wbs` route write a milestone, so the plan gained a row and every positional index shifted
  // by one — the same trap as reading `queries[0]` in a mocked test. What the rule actually says is
  // "a start is filled from the previous end + 1 day, and a PINNED start is respected", so that is
  // what gets asserted, by title, at whatever length the plan happens to be.
  const PINNED = new Set(['Sensor integration']);   // the only one created with an explicit start
  const breaks: string[] = [];
  let serial = 0;
  for (let i = 1; i < chain.length; i++) {
    if (PINNED.has(chain[i].title)) continue;
    const expected = plusDay(d10(chain[i - 1].forecastDate));
    if (d10(chain[i].startsOn) === expected) serial++;
    else breaks.push(`${chain[i].title}: ${d10(chain[i].startsOn)} ≠ ${expected}`);
  }
  A(breaks.length === 0 && serial >= 2,
    'each unpinned phase starts the day after the one before it ends',
    breaks.length ? breaks.join(' · ') : `${serial} of ${chain.length - 1} links, in a ${chain.length}-phase plan`);
  const pinned = chain.find((c) => c.title === 'Sensor integration');
  A(d10(pinned?.startsOn) === iso(-30),
    'and a PINNED start is RESPECTED — resequencing fills gaps, it does not overwrite a decision',
    `${d10(pinned?.startsOn)}`);

  // A slip moves what FOLLOWS. That is what makes the dates serial rather than a list.
  const endBefore = new Map(chain.map((c) => [c.title, d10(c.forecastDate)]));
  const slip = await api(req, 'patch', P + '/milestones', { action: 'reschedule', milestoneId: ms2id, forecastDate: iso(134) });
  A(slip.status === 200 && ((slip.json.data as Json)?.deltaDays as number) === 14,
    'phase 2 slips 14 days', `${slip.status} delta=${(slip.json.data as Json)?.deltaDays}`);
  const afterSlip = await sql<{ title: string; forecastDate: string | null; baselineDate: string | null }[]>`
    SELECT title, forecast_date AS "forecastDate", baseline_date AS "baselineDate"
      FROM project_milestones WHERE project_id = ${created.projectId}::uuid ORDER BY sort_index`;
  const endAfter = new Map(afterSlip.map((c) => [c.title, d10(c.forecastDate)]));
  A(endAfter.get('Final report') === iso(194), 'the LATER phase slips with it',
    `${endBefore.get('Final report')} → ${endAfter.get('Final report')}`);
  A(endAfter.get('Critical design review') === endBefore.get('Critical design review'),
    'and the EARLIER phase does not move',
    `${endBefore.get('Critical design review')} → ${endAfter.get('Critical design review')}`);

  // ── STAFFING: assignment is the access mechanism, so it comes before the work ──────────────
  // `/team` returns the roster as a BARE ARRAY under `data` — read the route, do not assume the
  // envelope's inner shape.
  const roster = await api(req, 'get', `/api/portal/${TENANT}/team`);
  const members = (Array.isArray(roster.json.data) ? roster.json.data : []) as Json[];

  // ── SELECT FOR WHAT THE ASSERTION NEEDS, NOT FOR WHAT IS NEAREST ─────────────────────────
  //
  // The next assertion is "assigning to somebody NOT on the project is refused", so the only thing
  // that makes it meaningful is a person who is not already on it. The acting user always is —
  // `createProject` assigns its creator — so picking them makes the refusal structurally unable to
  // fire, and it answers 201.
  //
  // The first version was `find(m.role === 'tenant_user') ?? members[0]`, which is wrong twice.
  // `/team` returns the MEMBERSHIP role and filters `source IN ('home','manual')`, so the match was
  // against the wrong field over a smaller set than the tenant's directory; and the `?? members[0]`
  // fallback then silently degraded to the actor herself. Standalone there happened to be a
  // matching member and it passed; in the full suite the roster came back as two, and 28 assertions
  // failed downstream from this one line (B146/B147, the same class again).
  const assignee = members.find(
    (m) => m.id !== undefined && String(m.email ?? '').toLowerCase() !== ACTOR.toLowerCase(),
  );
  A(roster.status === 200, 'the roster route answers', `${roster.status}`);
  if (!assignee) {
    // CANT-RUN, said out loud. Degrading to the actor would make every assertion below measure
    // nothing while reporting green — uncovered is not passing.
    console.error(`  CANT-RUN — the roster holds ${members.length} member(s) and none of them is `
      + `somebody other than ${ACTOR}. The staffing and assignment assertions below need a second `
      + 'person at this tenant; seed one rather than letting them measure the actor.');
    process.exit(2);
  }
  A(true, 'the roster offers somebody OTHER than the actor to staff with',
    `${members.length} member(s) · picked ${String(assignee.email ?? assignee.id)}`);

  // Handing work to someone who is NOT on the project is refused — they would never see it.
  const premature = await api(req, 'post', P + '/tasks', {
    milestoneId, title: 'work for someone who cannot see it', assigneeUserId: assignee?.id ?? null,
  });
  A(premature.status === 409 && String((premature.json as Json).code) === 'NOT_ON_PROJECT',
    'assigning work to someone not on the project is refused, with the fix in the sentence',
    `${premature.status} ${String((premature.json as Json).code)}`);

  const staffed = await api(req, 'post', P + '/assignees', { userId: assignee?.id });
  A(staffed.status === 201, 'the admin staffs the project through the portal', `${staffed.status}`);
  const rosterNow = await api(req, 'get', P + '/assignees');
  const onProject = ((rosterNow.json.data as Json)?.assignees ?? []) as Json[];
  A(onProject.some((a) => a.userId === assignee?.id), 'and the roster shows them',
    `${onProject.length} on the project`);



  // ══ 5 · the baseline freezes, once ═════════════════════════════════════════════════════════
  phase('5 · the baseline — the one number that cannot be recomputed');
  const base = await api(req, 'post', P + '/baseline', {});
  A(base.status === 200 || base.status === 201, 'the baseline is set', `${base.status}`);

  // The milestone IS the WBS element (migs 228-229), so "the plan is frozen" is one count against
  // one table. BOTH promises are asserted: `baseline_date` alone would have passed while migration
  // 228 was silently carrying no cost baseline at all, which is exactly what 229 went back for.
  const [froze] = await sql<{ dates: number; costs: number; planned: number }[]>`
    SELECT count(*) FILTER (WHERE baseline_date IS NOT NULL)::int AS dates,
           count(*) FILTER (WHERE baseline_cost IS NOT NULL)::int AS costs,
           count(*) FILTER (WHERE planned_cost  IS NOT NULL)::int AS planned
      FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid`;
  A(froze.dates >= 2, 'every planned milestone carries a frozen baseline date', `${froze.dates}`);
  A(froze.costs === froze.planned,
    'and a frozen baseline COST wherever a cost was planned — cost variance has two sides',
    `${froze.costs} frozen / ${froze.planned} planned`);

  const again = await api(req, 'post', P + '/baseline', {});
  A(again.status === 409, 'a SECOND baseline is refused', `${again.status} ${String(again.json.code ?? '')}`);
  A(!/\b(NaN|Invalid Date|[A-Z][a-z]{2} [A-Z][a-z]{2} \d)/.test(String(again.json.error ?? '')),
    'and the refusal names a real date, not a sliced Date string',
    String(again.json.error ?? '').slice(0, 80));

  // `withEventBracket` writes a `start` AND an `end`, and they are CORRELATED BY
  // `parent_event_id`, not by a shared payload: the start carries the inputs (projectId, name) and
  // the end carries the RESULT. My first version of this check filtered both phases on
  // `payload->>'projectId'` and reported "1 start / 0 end" — a bracket that looked unclosed and
  // was not. The end event is the only place the outcome lives, so it is what gets asserted.
  const [start] = await sql<{ id: string }[]>`
    SELECT id FROM system_events
     WHERE namespace = 'project' AND type = 'baseline.set' AND phase = 'start'
       AND payload->>'projectId' = ${created.projectId}`;
  A(Boolean(start), 'project:baseline.set opened a bracket');
  const [close] = await sql<{ ms: string | null }[]>`
    SELECT payload->>'milestones' AS ms FROM system_events
     WHERE namespace = 'project' AND type = 'baseline.set' AND phase = 'end'
       AND parent_event_id = ${start?.id ?? null}::uuid`;
  A(Boolean(close), 'and CLOSED it — a start with no end is B139, the class the spine audit exists for');
  const [{ msCount }] = await sql<{ msCount: number }[]>`
    SELECT count(*)::int AS "msCount" FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid`;
  // ONE count, because there is one spine. The payload used to carry `wbsNodes` beside
  // `milestones`, both filled from the same array — two names for one number, which reads as
  // corroboration and is not.
  A(close?.ms === String(msCount),
    'the end event carries what was frozen, not an empty object',
    close ? `milestones=${close.ms} (plan holds ${msCount})` : 'no end row');

  // ══ 6 · HITL — the work is delivered and ACCEPTED ══════════════════════════════════════════
  phase('6 · HITL: upload is not acceptance');
  const up = await req.fetch(`${BASE + P}/deliverables/${deliverableId}`, {
    method: 'POST',
    multipart: { file: { name: 'cdr-package.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 CDR') } },
  });
  A(up.status() === 200, 'an assigned employee attaches the file', String(up.status()));

  const early = await api(req, 'patch', P + '/milestones', { milestoneId, action: 'met' });
  A(early.status === 409, 'the milestone REFUSES to close while the deliverable is unaccepted',
    `${early.status} ${String(early.json.code ?? '')}`);

  const acc = await api(req, 'patch', `${P}/deliverables/${deliverableId}`, { action: 'accept' });
  A(acc.status === 200, 'the tenant_admin accepts it', `${acc.status}`);

  const met = await api(req, 'patch', P + '/milestones', { milestoneId, action: 'met' });
  A(met.status === 200, 'NOW the milestone closes', `${met.status}`);

  // The D10 defect, as an end-to-end assertion: the variance must be a NUMBER in the event a
  // person reads months later. `JSON.stringify(NaN)` is `null`, so a broken subtraction reads as
  // "no baseline" forever, and nothing anywhere complains.
  const [mevt] = await sql<{ variance: string | null }[]>`
    SELECT payload->>'varianceDays' AS variance FROM system_events
     WHERE namespace = 'project' AND type = 'milestone.met'
       AND payload->>'milestoneId' = ${milestoneId ?? null} LIMIT 1`;
  A(Boolean(mevt), 'project:milestone.met was emitted');
  A(mevt != null && mevt.variance !== null && Number.isFinite(Number(mevt.variance)),
    'and it carries a REAL varianceDays, not the null a NaN serialises to', String(mevt?.variance));

  // ══ 7 · the rollup tells the truth ═════════════════════════════════════════════════════════
  phase('7 · the three measures');
  const roll = await api(req, 'get', P + '/rollup');
  A(roll.status === 200, 'the rollup answers', `${roll.status}`);
  const project = (roll.json.data as Json)?.project as Json | undefined;
  A(project?.deliverablesPct === 100, 'deliverables read 100% — 1 of 1 accepted', String(project?.deliverablesPct));
  A(project?.costPct === 0, 'cost reads a MEASURED zero (nothing spent), not "not measured"', String(project?.costPct));
  A(!('percentComplete' in (project ?? {})), 'no blended percentage is exposed');

  // ══ 7b · the CHECKLIST gates the milestone, and completion is a RECORD ═════════════════════
  //
  // Everything here is done by the people who would do it: the assigned member ticks the work off,
  // the admin closes the phase. No status is set by hand.
  phase('7b · HITL: the work is ticked off, then the phase closes with a record');

  // The NEXT phase, not the one phase 6 already closed. A checklist belongs to work not yet done,
  // and pointing it at a met milestone made "the phase closes" fail as NOT_PENDING while the
  // assertion above it passed for the wrong reason.
  const workPhase = ms2id;
  const taskIds: string[] = [];
  for (const [title, due] of [['Rig build complete', iso(100)], ['Demo script rehearsed', iso(115)]] as const) {
    const t = await api(req, 'post', P + '/tasks', {
      milestoneId: workPhase, title, dueDate: due, assigneeUserId: assignee?.id ?? null,
    });
    if (t.status !== 201) no('a task could not be added', `${t.status} ${t.text.slice(0, 90)}`);
    else taskIds.push(((t.json.data as Json)?.task as Json)?.id as string);
  }
  A(taskIds.length === 2, 'the milestone gets a checklist, assigned to someone who is ON the project',
    `${taskIds.length} task(s)`);

  // ══ 7d · the ToDo SPINE — project work reaches a person where they already look ═════════════
  //
  // The parity test. A project task is not a second inbox: it is projected onto the platform ToDo,
  // so it lands in /todos, the bell and the Command Center, and the SAME nudge sweeper that chases
  // everything else picks it up.
  phase('7d · ToDos, email and nudges — the same infrastructure as a build');

  const todos = await sql<{ id: string; title: string; assigneeUserId: string | null; nudge: unknown; status: string; dueAt: string | null }[]>`
    SELECT t.id, t.title, t.assignee_user_id AS "assigneeUserId", t.nudge_schedule AS nudge,
           t.status, t.due_at AS "dueAt"
      FROM tasks t
     WHERE t.task_type = 'project_task'
       AND t.entity_id = ANY(${taskIds}::uuid[])`;
  A(todos.length === taskIds.length,
    'every assigned checklist row raised a real platform ToDo',
    `${todos.length} of ${taskIds.length}`);
  A(todos.every((t) => t.assigneeUserId === assignee?.id),
    'addressed to the person the work was given to, not to a role bucket');
  A(todos.every((t) => Array.isArray(t.nudge) && (t.nudge as unknown[]).length > 0),
    'each carries a nudge schedule, so the shared sweeper will chase it',
    JSON.stringify(todos[0]?.nudge));
  A(todos.every((t) => Boolean(t.dueAt)), 'and a due date the sweeper can measure against');

  // It is in the ASSIGNEE's queue, read through the route they would read it through.
  if (assignee?.email) {
    const qCtx = await browser.newContext();
    const qPage = await qCtx.newPage();
    try {
      await login(qPage, String(assignee.email), TENANT_PW);
      const queue = await api(qCtx.request, 'get', `/api/portal/${TENANT}/tasks`);
      const mine = JSON.stringify(queue.json);
      A(queue.status === 200, 'the assignee can read their own queue', `${queue.status}`);
      A(todos.some((t) => mine.includes(t.id)),
        'and the project work is IN it — the same list as every other kind of task');
    } catch (e) {
      no('could not read the assignee queue', String((e as Error).message).slice(0, 60));
    }
    await qCtx.close();
  }

  // The mail goes through the ONE seam: a notification request the CRM renders, not a direct send.
  const [mail] = await sql<{ template: string }[]>`
    SELECT payload->>'template' AS template FROM system_events
     WHERE namespace = 'system' AND type = 'notification.requested'
       AND payload->>'template' = 'project_task_assigned'
       AND payload->>'projectId' = ${created.projectId}
     ORDER BY created_at DESC LIMIT 1`;
  A(Boolean(mail), 'assignment asks for email through the notification seam, not a direct send',
    mail?.template ?? 'none');

  const tooEarly = await api(req, 'patch', P + '/milestones', { action: 'met', milestoneId: workPhase });
  A(tooEarly.status === 409 && String((tooEarly.json as Json).code) === 'TASKS_OUTSTANDING',
    'the phase will not close while its checklist is open',
    `${tooEarly.status} ${String((tooEarly.json as Json).code)}`);

  // THE EMPLOYEE, not the admin. Ticking work off is not a management act, and if this only worked
  // for a tenant_admin the checklist would be a status report a manager keeps for everyone else.
  let employeeTicked = 0;
  if (assignee?.email) {
    const empCtx = await browser.newContext();
    const empPage = await empCtx.newPage();
    try {
      await login(empPage, String(assignee.email), TENANT_PW);
      for (const id of taskIds) {
        const r = await api(empCtx.request, 'patch', P + `/tasks/${id}`, { status: 'done' });
        if (r.status === 200) employeeTicked += 1;
      }
      A(employeeTicked === taskIds.length,
        'the ASSIGNED EMPLOYEE ticks their own work off — not the admin',
        `${assignee.email} closed ${employeeTicked}/${taskIds.length}`);
      const cannot = await api(empCtx.request, 'post', P + '/tasks', { milestoneId: workPhase, title: 'not mine to add' });
      A(cannot.status === 403 || cannot.status === 404, '…and cannot ADD work to the plan', `${cannot.status}`);
    } catch (e) {
      // An employee who cannot sign in is a FINDING, not a skip: this is the half of the feature
      // that is not the manager's, and leaving it unmeasured would report the manager's half twice.
      no('the assigned employee could not sign in', String((e as Error).message).slice(0, 70));
    }
    await empCtx.close();
  } else {
    no('no member to assign work to — the employee half of the checklist is UNMEASURED');
  }

  // ── and ticking it off CLEARS it: the checklist is the source of truth, the ToDo follows ──
  const [{ stillOpen }] = await sql<{ stillOpen: number }[]>`
    SELECT count(*)::int AS "stillOpen" FROM tasks
     WHERE task_type = 'project_task' AND entity_id = ANY(${taskIds}::uuid[]) AND status = 'open'`;
  A(stillOpen === 0, 'ticking the work off cleared it from the queue', `${stillOpen} still open`);

  const metrics = { attendees: 11, actionItems: 6, sowRevisions: 1 };
  const closed = await api(req, 'patch', P + '/milestones', {
    action: 'met', milestoneId: workPhase,
    note: 'Demonstration flown; both objectives met on the first attempt.',
    metrics,
  });
  A(closed.status === 200, 'with the work done the phase closes', `${closed.status}`);

  const [rec] = await sql<{ note: string | null; metrics: Record<string, unknown> | null; status: string }[]>`
    SELECT completion_note AS note, completion_metrics AS metrics, status
      FROM project_milestones WHERE id = ${workPhase ?? null}::uuid`;
  A(rec?.status === 'met', 'the row is met');
  A(typeof rec?.metrics === 'object' && (rec?.metrics as { attendees?: number })?.attendees === 11,
    'the metrics round-trip as an OBJECT — jsonb, not a string that char-iterates',
    JSON.stringify(rec?.metrics));

  // ══ 7f · TASK SPINE V2 — the rules mig 221 moved into the database ═════════════════════════
  //
  // Every refusal below is raised by a TRIGGER, not by our code, so this is the only place they can
  // be proven: a unit test against a mock shows what we would refuse, not what Postgres does. And
  // each one is driven through the real route as the real actor.
  phase('7f · the plan\'s own rules: scope, dates, dependencies, references');

  // Its OWN employee session, held open across 7f–7h DELIBERATELY and closed once at the end of
  // 7h. The one further down is opened inside a later block and closed there; borrowing THAT one
  // across the boundary is how a drive starts depending on its own ordering — which is exactly
  // what happened when 7h first reached for it after 7f had already closed it.
  const empCtx7f = await browser.newContext();
  const empPage7f = await empCtx7f.newPage();
  let asEmployee = req;
  if (assignee?.email) {
    try { await login(empPage7f, String(assignee.email), TENANT_PW); asEmployee = empCtx7f.request; }
    catch (e) { no('the employee could not sign in for 7f', String((e as Error).message).slice(0, 60)); }
  }

  /** A date N days from an ISO date — the drive's `iso()` counts from today, not from a date. */
  const shift = (from: string, days: number) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  // ── STANDING WORK: a task that belongs to no phase ────────────────────────────────────────
  const standing = await api(req, 'post', P + '/tasks', {
    title: 'Keep the risk register current', dueDate: iso(200),
    assigneeUserId: assignee?.id ?? null,
  });
  A(standing.status === 201, 'a task with NO milestone is accepted — standing project work',
    `${standing.status} ${standing.text.slice(0, 80)}`);
  const standingId = ((standing.json.data as Json)?.task as Json)?.id as string | undefined;
  const [standingRow] = await sql<{ scope: string; milestoneId: string | null }[]>`
    SELECT scope, milestone_id AS "milestoneId" FROM project_milestone_tasks
     WHERE id = ${standingId ?? null}::uuid`;
  A(standingRow?.scope === 'project' && standingRow?.milestoneId === null,
    'and the database derived its scope rather than taking our word for it',
    `scope=${standingRow?.scope} milestone=${standingRow?.milestoneId}`);

  // ── THE DATE RULE ─────────────────────────────────────────────────────────────────────────
  const [phaseEnd] = await sql<{ forecast: string | null; title: string }[]>`
    SELECT to_char(forecast_date, 'YYYY-MM-DD') AS forecast, title
      FROM project_milestones WHERE id = ${workPhase ?? null}::uuid`;
  const past = shift(phaseEnd?.forecast ?? iso(120), 30);
  const tooLate = await api(req, 'post', P + '/tasks', {
    milestoneId: workPhase, title: 'work that finishes after its own phase', dueDate: past,
  });
  A(tooLate.status === 409 && String((tooLate.json as Json).code) === 'DUE_AFTER_MILESTONE',
    'a task due AFTER its milestone is refused — by the trigger, on the real write path',
    `${tooLate.status} ${String((tooLate.json as Json).code)}`);

  const sameDay = await api(req, 'post', P + '/tasks', {
    milestoneId: workPhase, title: 'finishes the day it is due', dueDate: phaseEnd?.forecast ?? iso(120),
  });
  A(sameDay.status === 201, 'but the SAME day is fine — finishing on the date is the normal case',
    `${sameDay.status}`);
  const sameDayId = ((sameDay.json.data as Json)?.task as Json)?.id as string | undefined;

  // ── THE ESTIMATE IS NOT THE COMMITMENT ────────────────────────────────────────────────────
  // The whole reason the column exists. If a forecast past the milestone were refused, people would
  // enter the date that is accepted instead of the one they believe.
  const slipping = await api(asEmployee, 'patch', P + `/tasks/${sameDayId}`, {
    estimatedCompletion: past,
  });
  A(slipping.status === 200,
    'the ASSIGNEE may say they expect to be late — the estimate is deliberately unconstrained',
    `${slipping.status} ${slipping.text.slice(0, 80)}`);

  // ── PULLING A MILESTONE IN REFUSES RATHER THAN DRAGGING DATES ─────────────────────────────
  const pullIn = await api(req, 'patch', P + '/milestones', {
    action: 'reschedule', milestoneId: workPhase, forecastDate: shift(phaseEnd?.forecast ?? iso(120), -60),
  });
  A(pullIn.status === 409 && String((pullIn.json as Json).code) === 'TASKS_WOULD_STRAND',
    'pulling the phase in is REFUSED and the tasks are named — it does not move a committed date',
    `${pullIn.status} ${String((pullIn.json as Json).code)}`);
  A(/finishes the day it is due|Rig build/.test(String((pullIn.json as Json).error ?? '')),
    'and the refusal says WHICH tasks, so there is something to go and do');

  // ── DEPENDENCIES ARE BETWEEN MILESTONES, SAME PROJECT, ACYCLIC ────────────────────────────
  const dep = await api(req, 'patch', P + '/milestones', {
    action: 'depends_on', milestoneId: ms3id, dependsOnId: workPhase,
  });
  A(dep.status === 200, 'one milestone can be declared to follow another', `${dep.status}`);

  const loop = await api(req, 'patch', P + '/milestones', {
    action: 'depends_on', milestoneId: workPhase, dependsOnId: ms3id,
  });
  A(loop.status === 409 && String((loop.json as Json).code) === 'DEPENDENCY_LOOP',
    'and a loop is refused — by the trigger, so no consumer can walk it forever',
    `${loop.status} ${String((loop.json as Json).code)}`);

  const self = await api(req, 'patch', P + '/milestones', {
    action: 'depends_on', milestoneId: workPhase, dependsOnId: workPhase,
  });
  A(self.status === 409, 'a milestone cannot depend on itself', `${self.status}`);

  // ── OPEN EDIT, AUDITED ────────────────────────────────────────────────────────────────────
  // An EMPLOYEE reassigns and reschedules. This is new surface: before mig 221 the per-task PATCH
  // took a status and nothing else, so there was no way to hand work over at all.
  // PERSON → ROLE BUCKET → PERSON. Two real transitions, because this drive has exactly one
  // assignable member and handing a task back to whoever already holds it is not a handover —
  // it changes nothing, emits nothing, and an assertion expecting an event would be asking the
  // product for a record of something that correctly did not happen. (It was written that way
  // first, and the two failing lines were the harness, not the route.)
  const toBucket = await api(asEmployee, 'patch', P + `/tasks/${taskIds[0]}`, {
    assigneeUserId: null, assigneeRole: 'tenant_user', detail: 'putting it back in the pool',
  });
  A(toBucket.status === 200, 'an EMPLOYEE can hand a task back to the team',
    `${toBucket.status} ${toBucket.text.slice(0, 80)}`);

  const reassign = await api(asEmployee, 'patch', P + `/tasks/${taskIds[0]}`, {
    assigneeUserId: assignee?.id ?? null, detail: 'picked up after the rig slipped',
  });
  A(reassign.status === 200, 'and pick it back up — the plan is rearranged by the people working it',
    `${reassign.status} ${reassign.text.slice(0, 80)}`);

  const stranger = await api(req, 'patch', P + `/tasks/${taskIds[0]}`, {
    assigneeUserId: NOBODY,
  });
  A(stranger.status === 409 && String((stranger.json as Json).code) === 'NOT_ON_PROJECT',
    'but not to somebody who is not on the project — access is not a side effect of a task form',
    `${stranger.status} ${String((stranger.json as Json).code)}`);

  const audited = await sql<{ type: string; payload: Json }[]>`
    SELECT type, payload FROM system_events
     WHERE namespace = 'project' AND type = 'task.reassigned'
       AND payload->>'taskId' = ${taskIds[0] ?? null}
     ORDER BY created_at ASC`;
  A(audited.length === 2,
    'and BOTH handovers are on the record — open editing means audited, not untracked',
    `${audited.length} event(s)`);
  A(audited[0]?.payload?.to === 'tenant_user' && audited[1]?.payload?.to === (assignee?.id ?? null),
    'each says who it went to, in order',
    `${String(audited[0]?.payload?.to ?? '—')} → ${String(audited[1]?.payload?.to ?? '—')}`);

  // A status change and an edit in one body is refused: a note save must never be able to reopen
  // finished work.
  const mixed = await api(req, 'patch', P + `/tasks/${taskIds[0]}`, { status: 'done', detail: 'and a note' });
  A(mixed.status === 400, 'a status change and an edit cannot ride the same request', `${mixed.status}`);

  // ── A REFERENCE IS NOT EVIDENCE OF COMPLETION ─────────────────────────────────────────────
  // BEFORE and AFTER, not a literal. Asserting `!== 'done'` tested the drive's ordering rather
  // than the product: whether the task happened to be open at this point says nothing about
  // whether attaching a file moved it.
  const [beforeAttach] = await sql<{ status: string }[]>`
    SELECT status FROM project_milestone_tasks WHERE id = ${taskIds[0] ?? null}::uuid`;
  const ref = await req.fetch(`${BASE}/api/portal/${TENANT}/projects/${created.projectId}/tasks/${taskIds[0]}/attachments`, {
    method: 'POST',
    multipart: { file: { name: 'rig-drawing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 rig') } },
  });
  A(ref.status() === 201, 'a reference file can be attached to a task', `${ref.status()}`);
  const [afterAttach] = await sql<{ status: string }[]>`
    SELECT status FROM project_milestone_tasks WHERE id = ${taskIds[0] ?? null}::uuid`;
  A(afterAttach?.status === beforeAttach?.status,
    'and attaching it did NOT move the status — a file appearing is not work finishing',
    `${beforeAttach?.status} → ${afterAttach?.status}`);

  // Clear the way for 7b: the two extra tasks added here would otherwise block the phase, which is
  // correct behaviour and exactly what would make the next assertion fail for the wrong reason.
  for (const id of [sameDayId].filter(Boolean)) {
    await api(asEmployee, 'patch', P + `/tasks/${id}`, { status: 'done' });
  }
  // ══ 7g · THE CONVERSATION — comments, mentions, and where they land ═══════════════════════
  //
  // Until mig 222 a project carried exactly one human decision: a tenant_admin accepting a
  // deliverable. There was nowhere to ask a question and nowhere to answer one. Every check here
  // is about a way this feature fails QUIETLY — a comment that saved and reached nobody.
  phase('7g · the conversation: comments, mentions, and where they land');

  // The EMPLOYEE asks the admin something, by name.
  const asked = await api(asEmployee, 'post', P + '/comments', {
    body: `The rig slipped a week — @${ACTOR} can we move the demo, or do we compress test?`,
  });
  A(asked.status === 201, 'anyone on the project can say something', `${asked.status} ${asked.text.slice(0, 80)}`);
  const askedId = ((asked.json.data as Json)?.comment as Json)?.id as string | undefined;
  const mentionedBack = ((asked.json.data as Json)?.notified ?? []) as string[];
  A(mentionedBack.includes(ACTOR.toLowerCase()),
    'and the person they named is told they were named', mentionedBack.join(', ') || 'nobody');

  // ── THE MENTION LANDS IN THE SAME QUEUE AS EVERYTHING ELSE ────────────────────────────────
  const mentionTodo = await sql<{ id: string; title: string; dueAt: string | null; assigneeUserId: string | null }[]>`
    SELECT id, title, due_at AS "dueAt", assignee_user_id AS "assigneeUserId"
      FROM tasks
     WHERE task_type = 'project_comment' AND entity_id = ${askedId ?? null}::uuid`;
  A(mentionTodo.length === 1, 'a mention raises a real platform ToDo — not a second inbox',
    `${mentionTodo.length} ToDo(s)`);
  A(mentionTodo[0]?.dueAt === null,
    'with NO due date — a mention is a request to look, not a deadline');

  const mentionMail = await sql<{ template: string }[]>`
    SELECT payload->>'template' AS template FROM system_events
     WHERE namespace = 'system' AND type = 'notification.requested'
       AND payload->>'commentId' = ${askedId ?? null}
     ORDER BY created_at DESC LIMIT 1`;
  A(mentionMail[0]?.template === 'project_comment_mention',
    'and asks for email through the one seam, with a renderer that exists',
    mentionMail[0]?.template ?? 'none');

  // ── SOMEBODY NOT ON THE PROJECT IS REPORTED BACK, NOT NOTIFIED ────────────────────────────
  // The silent failure this feature otherwise has: the author types a name, sees the comment
  // appear, and believes they were heard.
  const offRoster = await api(req, 'post', P + '/comments', {
    body: `asking @${NOBODY_EMAIL} to weigh in`,
  });
  const unmatched = ((offRoster.json.data as Json)?.unmatched ?? []) as string[];
  A(offRoster.status === 201 && unmatched.includes(NOBODY_EMAIL),
    'a name nobody here answers to is REPORTED, not silently dropped', unmatched.join(', ') || 'none');
  const offRosterId = ((offRoster.json.data as Json)?.comment as Json)?.id as string | undefined;
  const [{ strangerTodos }] = await sql<{ strangerTodos: number }[]>`
    SELECT count(*)::int AS "strangerTodos" FROM tasks
     WHERE task_type = 'project_comment' AND entity_id = ${offRosterId ?? null}::uuid`;
  A(strangerTodos === 0, 'and nobody outside the project is summoned to a page they cannot open');

  // ── THE ANCHOR IS CHECKED, BECAUSE NO FK CAN ──────────────────────────────────────────────
  // entity_id points at four tables, so it has no foreign key. This lookup is the only thing
  // between a comment and another customer's contract.
  const wrongAnchor = await api(req, 'post', P + '/comments', {
    entityType: 'milestone', entityId: NOBODY, body: 'x',
  });
  A(wrongAnchor.status === 400
    && /does not belong to this project/.test(String((wrongAnchor.json as Json).error ?? '')),
    "a comment cannot be anchored to another project's milestone", `${wrongAnchor.status}`);

  // ── ANCHORED WHERE THE ARGUMENT ACTUALLY HAPPENS ──────────────────────────────────────────
  const onMilestone = await api(req, 'post', P + '/comments', {
    entityType: 'milestone', entityId: workPhase,
    body: 'Compressing test is fine if the rig is ready by Friday.',
  });
  A(onMilestone.status === 201, 'a comment can hang off the milestone it is about', `${onMilestone.status}`);

  // ── THREADS ARE ONE LEVEL ─────────────────────────────────────────────────────────────────
  const reply = await api(req, 'post', P + '/comments', { parentId: askedId, body: 'Move the demo.' });
  A(reply.status === 201, 'and somebody can answer', `${reply.status}`);
  const replyId = ((reply.json.data as Json)?.comment as Json)?.id as string | undefined;

  const nested = await api(asEmployee, 'post', P + '/comments', { parentId: replyId, body: 'Understood.' });
  const nestedParent = ((nested.json.data as Json)?.comment as Json)?.parentId as string | undefined;
  A(nested.status === 201 && nestedParent === askedId,
    'a reply to a reply attaches to the ROOT — never refused mid-conversation, never a fourth indent',
    `parent=${String(nestedParent).slice(0, 8)} root=${String(askedId).slice(0, 8)}`);

  // ── EDITING IS THE AUTHOR, AND ONLY THE AUTHOR ────────────────────────────────────────────
  const notYours = await api(req, 'patch', P + `/comments/${askedId}`, { body: 'rewriting what they said' });
  A(notYours.status === 403, "one person cannot rewrite another's words", `${notYours.status}`);

  // ── RESOLVING CLOSES THE QUEUE BEHIND IT ──────────────────────────────────────────────────
  const resolved = await api(asEmployee, 'patch', P + `/comments/${askedId}`, { action: 'resolve' });
  A(resolved.status === 200, 'anyone on the project can close a thread', `${resolved.status}`);
  const [{ stillMentioned }] = await sql<{ stillMentioned: number }[]>`
    SELECT count(*)::int AS "stillMentioned" FROM tasks
     WHERE task_type = 'project_comment' AND entity_id = ${askedId ?? null}::uuid AND status = 'open'`;
  A(stillMentioned === 0,
    "and a finished conversation leaves nothing in anybody's queue", `${stillMentioned} still open`);

  const [resolvedRow] = await sql<{ resolvedBy: string | null; resolvedAt: string | null }[]>`
    SELECT resolved_by AS "resolvedBy", resolved_at AS "resolvedAt"
      FROM project_comments WHERE id = ${askedId ?? null}::uuid`;
  A(Boolean(resolvedRow?.resolvedBy && resolvedRow?.resolvedAt),
    'recorded as WHO and WHEN — six months later, "true" answers nothing');

  // ── AND STANDING WORK GATES CLOSE-OUT, NOT A MILESTONE ────────────────────────────────────
  // The design claim, checked rather than asserted in prose: `markMilestoneMet` is scoped by
  // milestone_id, so standing work never blocks a phase; `closeProject` is scoped by project_id,
  // so it does block the contract finishing. Left OPEN deliberately until phase 10 proves the
  // refusal — clearing it here would remove the only evidence the gate exists.
  const [standingScope] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM project_milestone_tasks
     WHERE milestone_id = ${workPhase ?? null}::uuid AND scope = 'project'`;
  A(standingScope.n === 0, 'standing work is not filed under a phase — it gates close-out, not a milestone',
    `${standingScope.n} standing task(s) under the work phase`);

  // ══ 7e · CANVAS DELIVERABLES — a report, a deck, a workbook, a PDF ══════════════════════════
  //
  // The build portal's authoring stack, applied to a contract deliverable: the same presets, the
  // same `tenant_documents` row, the same editor, the same export to docx · pptx · xlsx · pdf.
  phase('7e · deliverables authored in-product, and exported');

  const authoredDel = await api(req, 'post', P + '/deliverables', {
    milestoneId: workPhase, title: 'Monthly technical report', requiredBy: iso(110),
  });
  const authoredId = ((authoredDel.json.data as Json)?.deliverable as Json)?.id as string | undefined;
  A(authoredDel.status === 201, 'a second deliverable is declared', `${authoredDel.status}`);

  const notYet = await api(req, 'patch', P + `/deliverables/${authoredId}`, { action: 'accept' });
  A(notYet.status === 409 && String((notYet.json as Json).code) === 'NOTHING_ATTACHED',
    'it cannot be accepted with nothing attached — file OR document',
    `${notYet.status} ${String((notYet.json as Json).code)}`);

  const drafted = await api(req, 'patch', P + `/deliverables/${authoredId}`, {
    action: 'author', preset: 'letter', title: 'Monthly technical report — March',
  });
  A(drafted.status === 201, 'a report is drafted in-product', `${drafted.status}`);
  const docId = ((drafted.json.data as Json)?.document as Json)?.documentId as string | undefined;
  A(Boolean(docId), 'and it is a real tenant_documents row the canvas editor opens');
  if (docId) created.documentIds.push(docId);

  const twiceDrafted = await api(req, 'patch', P + `/deliverables/${authoredId}`, { action: 'author', preset: 'deck' });
  A(twiceDrafted.status === 409 && String((twiceDrafted.json as Json).code) === 'ALREADY_AUTHORED',
    'asking twice hands back a refusal, not a second draft nobody will find',
    `${twiceDrafted.status}`);

  // The EXPORT — the same route the build portal uses, in every format it offers.
  // `node_count AS "nodeCount"` — a bare postgres() client has no `toCamel`, so `r.nodeCount` off a
  // snake_case select is `undefined`, and `undefined > 0` is false. This assertion reported "0
  // node(s)" against a document that had two, which is the harness accusing the product.
  const [docRow] = await sql<{ canvas: unknown; nodeCount: number }[]>`
    SELECT canvas, node_count AS "nodeCount" FROM tenant_documents WHERE id = ${docId ?? null}::uuid`;
  A(Boolean(docRow), 'the canvas is stored');

  // ── THE DOCUMENT IS NOT BLANK ──────────────────────────────────────────────────────────────
  // This assertion exists because its absence hid a real defect: `starterFromPreset` builds an
  // EMPTY canvas (right for the "New document" chooser), so the authored deliverable exported as a
  // blank page — and the magic-number check below passed it, because an empty PDF still starts
  // `%PDF`. What a deliverable knows about itself is the least it can carry.
  const seeded = ((docRow?.canvas as Json)?.nodes ?? []) as Array<Json>;
  const seededText = seeded.map((n) => JSON.stringify((n as Json)?.content ?? {})).join(' ');
  A(docRow?.nodeCount > 0, 'the draft is not a blank page', `${docRow?.nodeCount ?? 0} node(s)`);
  A(seededText.includes('Monthly technical report'),
    'it carries its own identity — the deliverable it satisfies');
  // The date is the one THIS drive passed on the POST above, not a date the assertion re-derives:
  // copy the predicate from the source. `Required by` is the seed's own wording.
  A(seededText.includes(`Required by ${iso(110)}`),
    'and the date it is due, read from the row rather than invented', iso(110));
  // A byte COUNT is not evidence a file is that format — an error page is bytes too. Check the
  // magic number: `%PDF` for pdf, `PK` (a zip) for the three OOXML formats.
  const MAGIC: Record<string, string> = { pdf: '%PDF', docx: 'PK', pptx: 'PK', xlsx: 'PK' };
  for (const fmt of ['docx', 'pdf', 'pptx', 'xlsx'] as const) {
    const exp = await req.fetch(`${BASE}/api/portal/${TENANT}/documents/${docId}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: { document: docRow?.canvas, format: fmt },
    });
    const buf = await exp.body();
    const head = buf.subarray(0, 4).toString('latin1');
    A(exp.status() === 200 && head.startsWith(MAGIC[fmt]),
      `it exports as .${fmt} through the SAME route a proposal volume uses`,
      `${exp.status()} · ${buf.length} bytes · starts ${JSON.stringify(head)}`);
  }

  // ══ 7h · THE REVIEW GATE — somebody said no, because X ═════════════════════════════════════
  //
  // The state that did not exist: a deliverable was either accepted or silently not, so a
  // rejection happened in a meeting and the row went on looking like something nobody had got
  // round to. Driven as the full loop — ask → reject → fix → re-ask → approve → accept — because
  // each step only means anything if the next one is reachable.
  phase('7h · review: ask, reject with a reason, fix, approve, then accept');

  const reviewAsked = await api(asEmployee, 'post', P + '/reviews', {
    entityType: 'deliverable', entityId: authoredId, reviewerUserId: assignee?.id ?? null,
    note: 'Check the CLIN references before this goes out.', dueOn: iso(20),
  });
  A(reviewAsked.status === 201, 'an EMPLOYEE can ask a colleague to review a deliverable',
    `${reviewAsked.status} ${reviewAsked.text.slice(0, 80)}`);
  const reviewId = ((reviewAsked.json.data as Json)?.review as Json)?.id as string | undefined;

  const reviewTwice = await api(req, 'post', P + '/reviews', {
    entityType: 'deliverable', entityId: authoredId, reviewerUserId: assignee?.id ?? null,
  });
  A(reviewTwice.status === 409 && String((reviewTwice.json as Json).code) === 'REVIEW_ALREADY_OPEN',
    'a SECOND open review is refused — three reviewers is three people believing they decide',
    `${reviewTwice.status} ${String((reviewTwice.json as Json).code)}`);

  // ── AN OPEN REVIEW BLOCKS ACCEPTANCE ──────────────────────────────────────────────────────
  const whileOpen = await api(req, 'patch', P + `/deliverables/${authoredId}`, { action: 'accept' });
  A(whileOpen.status === 409 && String((whileOpen.json as Json).code) === 'REVIEW_PENDING',
    'and while it is out for review, it cannot be accepted',
    `${whileOpen.status} ${String((whileOpen.json as Json).code)}`);

  // ── A REJECTION MUST SAY WHY ──────────────────────────────────────────────────────────────
  const silent = await api(req, 'patch', P + `/reviews/${reviewId}`, { decision: 'rejected' });
  A(silent.status === 400, 'a rejection with no reason is refused — the whole point of the table',
    `${silent.status}`);

  const rejected = await api(req, 'patch', P + `/reviews/${reviewId}`, {
    decision: 'rejected', reason: 'Section 3 cites CLIN 0002 where the SOW says 0001.',
  });
  A(rejected.status === 200, 'a rejection WITH a reason is recorded', `${rejected.status}`);

  const [rejRow] = await sql<{ status: string; reason: string | null; decidedBy: string | null }[]>`
    SELECT status, reason, decided_by AS "decidedBy" FROM project_reviews
     WHERE id = ${reviewId ?? null}::uuid`;
  A(rejRow?.status === 'rejected' && /CLIN 0002/.test(rejRow?.reason ?? ''),
    'and the reason is on the record, not in somebody&apos;s inbox'.replace('&apos;', "'"),
    (rejRow?.reason ?? '—').slice(0, 50));

  // ── A REJECTION KEEPS BLOCKING UNTIL SOMETHING SUPERSEDES IT ──────────────────────────────
  const whileRejected = await api(req, 'patch', P + `/deliverables/${authoredId}`, { action: 'accept' });
  A(whileRejected.status === 409 && String((whileRejected.json as Json).code) === 'REVIEW_REJECTED',
    'a rejected deliverable still cannot be accepted — and the refusal repeats the reason',
    `${whileRejected.status} ${String((whileRejected.json as Json).code)}`);
  A(/CLIN 0002/.test(String((whileRejected.json as Json).error ?? '')),
    'so whoever tries to accept it learns what is wrong without going to look');

  // ── FIX, RE-ASK, APPROVE ──────────────────────────────────────────────────────────────────
  const reAsked = await api(asEmployee, 'post', P + '/reviews', {
    entityType: 'deliverable', entityId: authoredId, reviewerUserId: assignee?.id ?? null,
    note: 'CLIN reference corrected.',
  });
  A(reAsked.status === 201, 'a fresh review supersedes the rejection — reject is a loop, not a wall',
    `${reAsked.status}`);
  const reviewId2 = ((reAsked.json.data as Json)?.review as Json)?.id as string | undefined;

  const approved = await api(req, 'patch', P + `/reviews/${reviewId2}`, { decision: 'approved' });
  A(approved.status === 200, 'the reviewer approves', `${approved.status}`);

  const [afterApprove] = await sql<{ acceptedAt: string | null }[]>`
    SELECT accepted_at AS "acceptedAt" FROM project_deliverables WHERE id = ${authoredId ?? null}::uuid`;
  A(afterApprove?.acceptedAt === null,
    'APPROVING IS NOT ACCEPTING — the reviewer is satisfied; the obligation is not yet met');

  // Authoring is not acceptance — the rule survives the new path, and now so does approving.
  const acceptedDoc = await api(req, 'patch', P + `/deliverables/${authoredId}`, { action: 'accept' });
  A(acceptedDoc.status === 200, 'and once approved, a tenant_admin can accept it', `${acceptedDoc.status}`);

  // The employee session opened in 7f has now served 7f, 7g and 7h; this is the last use of it.
  await empCtx7f.close();

  /**
   * Do ONE thing as the assigned employee, in a session of its own.
   *
   * The context 7f opened is closed at the end of 7h, and reaching for a closed one is how a drive
   * starts depending on its own ordering (learned the hard way in 7h). Three inline copies of
   * "open, log in, act, close" had accumulated before this existed — which is exactly the
   * duplication this drive is used to find in the product.
   *
   * Returns null when there is nobody to be, and the CALLER decides whether that is a skip or a
   * finding — a helper that silently substituted the admin would report the manager's half twice.
   */
  async function asEmployee_<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T | null> {
    if (!assignee?.email) return null;
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    try {
      await login(pg, String(assignee.email), TENANT_PW);
      return await fn(ctx);
    } catch (e) {
      no('an employee action could not run', String((e as Error).message).slice(0, 60));
      return null;
    } finally {
      await ctx.close();
    }
  }

  // ══ 7l · WHAT WAS AGREED — a meeting, its notes, and the work that came out of it ══════════
  //
  // The failure this guards is the one that leaves two records disagreeing and both looking
  // complete: notes claiming five agreements beside a plan holding two.
  phase('7l · meetings: notes in the canvas, actions on the task spine');

  const metRec = await asEmployee_((ctx) => api(ctx.request, 'post', P + '/meetings', {
    title: 'CDR walkthrough with the COR',
    heldOn: iso(-3),
    attendees: ['Kate Ulepic', 'J. Rivera (COR)', 'Kate Ulepic'],
  }));
  A(metRec?.status === 201, 'an employee records the meeting — whoever took the notes',
    `${metRec?.status ?? 'no employee to be'}`);
  const meetingId = ((metRec?.json.data as Json)?.meeting as Json)?.id as string | undefined;

  const [mtgRow] = await sql<{ attendees: string[]; documentId: string | null }[]>`
    SELECT attendees, document_id AS "documentId" FROM project_meetings
     WHERE id = ${meetingId ?? null}::uuid`;
  A(mtgRow?.attendees?.length === 2,
    'attendees are kept as names, de-duplicated, customer and all',
    (mtgRow?.attendees ?? []).join(' · '));
  A(Boolean(mtgRow?.documentId),
    'and the notes are a real canvas document — the same editor and exporters as everything else');

  // The minutes must open and export like any other artifact. A `notes text` column would have
  // passed every other check here and failed this one.
  const [mtgDoc] = await sql<{ canvas: unknown }[]>`
    SELECT canvas FROM tenant_documents WHERE id = ${mtgRow?.documentId ?? null}::uuid`;
  const mtgExport = await req.fetch(`${BASE}/api/portal/${TENANT}/documents/${mtgRow?.documentId}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    data: { document: mtgDoc?.canvas, format: 'docx' },
  });
  const mtgBytes = await mtgExport.body();
  A(mtgExport.status() === 200 && mtgBytes.subarray(0, 2).toString('latin1') === 'PK',
    'minutes that cannot be exported are minutes nobody can send',
    `${mtgExport.status()} · ${mtgBytes.length} bytes`);

  // ── AND THE ACTIONS ARE ORDINARY TASKS ────────────────────────────────────────────────────
  const actions = await api(req, 'patch', P + `/meetings/${meetingId}`, {
    action: 'raise_actions',
    items: [
      { title: 'Send the revised SOW to the CO', assigneeUserId: assignee?.id ?? null, dueDate: iso(7) },
      { title: 'Re-run the thermal margin case', assigneeUserId: assignee?.id ?? null },
      { title: 'Give this one to somebody who is not here', assigneeUserId: NOBODY },
    ],
  });
  A(actions.status === 201, 'the agreed items are raised in ONE call', `${actions.status}`);
  const raisedIds = ((actions.json.data as Json)?.taskIds ?? []) as string[];
  const refusedList = ((actions.json.data as Json)?.refused ?? []) as string[];
  A(raisedIds.length === 2 && refusedList.length === 1,
    'and one bad item does not lose the other two — the refusal comes back NAMED',
    `${raisedIds.length} raised · ${refusedList.length} refused`);

  const [{ actionTodos }] = await sql<{ actionTodos: number }[]>`
    SELECT count(*)::int AS "actionTodos" FROM tasks
     WHERE task_type = 'project_task' AND entity_id = ANY(${raisedIds}::uuid[])`;
  A(actionTodos === raisedIds.length,
    'each one is an ORDINARY task, so it lands in the same queue as everything else that person owes',
    `${actionTodos} ToDo(s)`);

  const [{ traced }] = await sql<{ traced: number }[]>`
    SELECT count(*)::int AS "traced" FROM project_milestone_tasks
     WHERE meeting_id = ${meetingId ?? null}::uuid`;
  A(traced === raisedIds.length,
    'and still knows which meeting it was agreed in — six weeks later, that is the question',
    `${traced} traced`);

  // Tick them, or they correctly block close-out further down — standing work is standing work.
  for (const id of raisedIds) {
    await asEmployee_((ctx) => api(ctx.request, 'patch', P + `/tasks/${id}`, { status: 'done' }));
  }

  // ══ 7m · CONTRACT MODIFICATIONS — the only write path to a CLIN ════════════════════════════
  //
  // The whole point is that drafting does NOT move the contract and executing does, once, citing a
  // signed document. Every assertion below is about a number a customer is billed against, so each
  // reads the CLIN back from the database rather than trusting the route's own answer.
  phase('7m · modifications: drafting is not executing');

  const clinBefore = await sql<{ fundedAmount: string | null; popEnd: string | null }[]>`
    SELECT funded_amount AS "fundedAmount", pop_end::text AS "popEnd"
      FROM project_clins WHERE id = ${clinId ?? null}::uuid`;
  A(clinBefore[0]?.fundedAmount != null, 'the CLIN has a funded amount to move', `${clinBefore[0]?.fundedAmount}`);

  const modDraft = await api(req, 'post', P + '/modifications', {
    modNumber: 'P00001', title: 'Incremental funding and option period',
    kind: 'funding', sourceDocId: srcDoc?.id,
    changes: [
      { action: 'amend', clinId, field: 'funded_amount', newValue: 900000 },
      { action: 'amend', clinId, field: 'pop_end', newValue: iso(420) },
    ],
  });
  A(modDraft.status === 201, 'a modification is drafted', `${modDraft.status}`);
  const modId = ((modDraft.json.data as Json)?.modification as Json)?.id as string | undefined;

  const midDraft = await sql<{ fundedAmount: string | null }[]>`
    SELECT funded_amount AS "fundedAmount" FROM project_clins WHERE id = ${clinId ?? null}::uuid`;
  A(String(midDraft[0]?.fundedAmount) === String(clinBefore[0]?.fundedAmount),
    'and the CLIN has NOT moved — drafting is not executing',
    `${clinBefore[0]?.fundedAmount} → ${midDraft[0]?.fundedAmount}`);

  // A CLIN from nowhere is refused before anything is written. No FK stops it: a CLIN id from
  // another contract is a real row, and RLS cannot see the difference when both belong to one tenant.
  const foreignClin = await api(req, 'post', P + '/modifications', {
    modNumber: 'P00009', title: 'should not exist', kind: 'funding',
    changes: [{ action: 'amend', clinId: created.projectId, field: 'funded_amount', newValue: 1 }],
  });
  A(foreignClin.status === 400, 'a CLIN that is not on this project is refused', `${foreignClin.status}`);

  const executed = await api(req, 'patch', P + '/modifications', {
    action: 'execute', modificationId: modId, executedOn: iso(-1),
  });
  A(executed.status === 200, 'the modification executes', `${executed.status}`);
  A(((executed.json.data as Json)?.applied as number) === 2,
    'and applied both changes', `applied=${(executed.json.data as Json)?.applied}`);

  const clinAfter = await sql<{ fundedAmount: string | null; popEnd: string | null }[]>`
    SELECT funded_amount AS "fundedAmount", pop_end::text AS "popEnd"
      FROM project_clins WHERE id = ${clinId ?? null}::uuid`;
  A(Number(clinAfter[0]?.fundedAmount) === 900000, 'the CLIN moved', `${clinAfter[0]?.fundedAmount}`);
  A(clinAfter[0]?.popEnd === iso(420), 'and so did the period of performance', `${clinAfter[0]?.popEnd}`);

  // The OLD value recorded is the one that was standing at execution — the audit trail's whole job.
  const [amend] = await sql<{ oldValue: string | null; appliedAt: string | null }[]>`
    SELECT old_value AS "oldValue", applied_at AS "appliedAt"
      FROM project_modification_changes
     WHERE modification_id = ${modId ?? null}::uuid AND field = 'funded_amount'`;
  A(Number(amend?.oldValue) === Number(clinBefore[0]?.fundedAmount),
    'the change row records the value that was actually standing, not one carried from the draft',
    `old=${amend?.oldValue} was=${clinBefore[0]?.fundedAmount}`);
  A(Boolean(amend?.appliedAt), 'and is stamped as applied');

  // ── PROVENANCE SUPERSEDES ────────────────────────────────────────────────────────────────
  // The subtle one. `recordProvenance` normally refuses an upsert whose method does not OUTRANK
  // the existing — so `verified` (this mod) over `verified` (the original contract) is refused by
  // a guard that compares method and not recency. The money would move and the badge would still
  // cite the award page saying the old number.
  const [modProv] = await sql<{ sourceDocId: string; excerpt: string | null }[]>`
    SELECT source_doc_id AS "sourceDocId", excerpt FROM project_provenance
     WHERE target_table = 'project_clins' AND target_id = ${clinId ?? null}::uuid
       AND field = 'funded_amount'`;
  A(modProv?.excerpt?.includes('P00001') === true,
    'the citation now points at the MODIFICATION, not the original award page',
    String(modProv?.excerpt ?? 'none').slice(0, 60));

  // ── AND IT DOES NOT REBASELINE ───────────────────────────────────────────────────────────
  const frozenStill = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid AND baseline_date IS NOT NULL`;
  A(frozenStill[0]?.n === froze.dates,
    'the frozen baseline is untouched — a mod is not a rebaseline',
    `${froze.dates} → ${frozenStill[0]?.n}`);
  const [rebaseTodo] = await sql<{ id: string; title: string }[]>`
    SELECT id, title FROM tasks
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'project_modification'
       AND entity_id = ${modId ?? null}::uuid`;
  A(Boolean(rebaseTodo) && /Rebaseline/i.test(rebaseTodo?.title ?? ''),
    'it RAISED A TODO asking a person to rebaseline instead',
    rebaseTodo?.title ?? 'no ToDo');

  const modTwice = await api(req, 'patch', P + '/modifications', {
    action: 'execute', modificationId: modId, executedOn: iso(-1),
  });
  A(modTwice.status === 409, 'executing twice is refused', `${modTwice.status} ${String((modTwice.json as Json).code)}`);

  const history = await api(req, 'get', P + '/modifications');
  const mods = ((history.json.data as Json)?.modifications as unknown[]) ?? [];
  A(mods.length >= 1 && (mods[0] as Json)?.status === 'executed',
    'and the history reads it back with its changes', `${mods.length} mod(s)`);

  // ══ 7w · EAC / ETC — three estimates, and the refusal to blend them ═══════════════════════
  //
  // A5, deterministic for A3's reason: EAC is spend over percent-complete, and a model producing it
  // would produce a number nobody could check. The assertion that matters is that it is served
  // WITH the roll-up it was computed from — a forecast on a separate call can be read beside a
  // stale measure and disagree with it.
  phase('7w · the forecast: computed from the measures, and never averaged');

  const fc = await api(req, 'get', P + '/rollup');
  A(fc.status === 200, 'the roll-up answers', `${fc.status}`);
  const fcast = (fc.json.data as Json)?.forecast as Json | undefined;
  A(Boolean(fcast), 'and carries the forecast in the SAME response as the measures it used');

  const ests = (fcast?.estimates as Json[]) ?? [];
  A(ests.length === 3 && ests.map((e) => String(e.basis)).join(',') === 'cost,schedule,deliverables',
    'one estimate per basis — never one blended number',
    ests.map((e) => String(e.basis)).join(','));

  // Every estimate either has a number or says why not. A silent null is the failure mode.
  A(ests.every((e) => (e.eac === null) === (e.unavailable !== null)),
    'and every missing estimate SAYS why it is missing',
    JSON.stringify(ests.map((e) => e.unavailable ?? 'ok')));

  // No blended figure anywhere in the payload — the number that looks most like an answer.
  const fcKeys = Object.keys(fcast ?? {});
  A(!fcKeys.some((k) => ['eac', 'headline', 'blended', 'overall'].includes(k)),
    'no headline EAC is exposed at the top level', fcKeys.join(','));

  // Each estimate carries the percent-complete it divided by, so a reader can check it.
  A(ests.every((e) => 'percentComplete' in e),
    'and each carries the denominator it used — a figure nobody can check is not a figure');

  // Cross-check ONE of them by hand against the measures in the same payload, rather than trusting
  // the module to agree with itself.
  const proj = (fc.json.data as Json)?.project as Json;
  const costEst = ests.find((e) => String(e.basis) === 'cost');
  if (proj?.costPct !== null && proj?.costPct !== undefined && Number(proj.costPct) > 0
      && Number(proj.actualCost) > 0) {
    const byHand = Math.round((Number(proj.actualCost) / (Number(proj.costPct) / 100)) * 100) / 100;
    A(Number(costEst?.eac) === byHand,
      'the cost EAC is what a person would compute by hand from the same two numbers',
      `${costEst?.eac} vs ${byHand}`);
  } else {
    A(costEst?.eac === null,
      'with no spend or no denominator, the cost EAC is null rather than a fabrication',
      String(costEst?.unavailable ?? ''));
  }

  // ══ 7v · THE AI-MANAGER GATE CLOSER — a strict subset of what a person may do ═════════════
  //
  // A4. The claim is an ASYMMETRY: a human can close a milestone the agent would not; the agent can
  // never close one a human could not. Both halves are driven here, against the live product.
  phase('7v · the gate closer: it can only ever do LESS than a person');

  // A fresh milestone with an OPEN task — a person could not close this, so neither may the agent.
  const gated = await api(req, 'post', P + '/milestones', {
    title: 'AI-gated phase', clinId, forecastDate: iso(140), sortIndex: 91,
  });
  A(gated.status === 201, 'a milestone is created for the closer to try', `${gated.status}`);
  const gatedId = ((gated.json.data as Json)?.milestone as Json)?.id as string | undefined;

  const assign = await api(req, 'patch', P + '/gate-closer', {
    action: 'set', milestoneId: gatedId, gateCloser: 'ai_manager',
  });
  A(assign.status === 200, 'and assigned to the AI manager', `${assign.status}`);

  const blocker = await api(req, 'post', P + '/tasks', {
    milestoneId: gatedId, title: 'Unfinished work on the AI-gated phase', assigneeUserId: assignee?.id,
  });
  A(blocker.status === 201, 'with one task still open', `${blocker.status}`);
  const blockerId = ((blocker.json.data as Json)?.task as Json)?.id as string | undefined;

  const sweep1 = await api(req, 'patch', P + '/gate-closer', { action: 'sweep' });
  A(sweep1.status === 200, 'the sweep runs', `${sweep1.status}`);
  const out1 = ((sweep1.json.data as Json)?.outcomes as Json[]) ?? [];
  const mine1 = out1.find((o) => o.milestoneId === gatedId);
  A(mine1?.closed === false,
    'and REFUSES the milestone a person could not close either', String(mine1?.reason ?? '').slice(0, 70));
  A(/not done/i.test(String(mine1?.reason ?? '')),
    'with markMilestoneMet’s own sentence, not a paraphrase', String(mine1?.reason ?? '').slice(0, 60));
  A(((sweep1.json.data as Json)?.declined as number) >= 1,
    'and the sweep REPORTS what it declined — silence would look like "nothing to do"',
    `${(sweep1.json.data as Json)?.declined} declined`);

  const [stillPending] = await sql<{ status: string }[]>`
    SELECT status FROM project_milestones WHERE id = ${gatedId ?? null}::uuid`;
  A(stillPending?.status === 'pending', 'the row did not move', String(stillPending?.status));

  // Now finish the work — and it closes, through the same function a person's click reaches.
  if (blockerId) await api(req, 'patch', P + `/tasks/${blockerId}`, { status: 'done' });
  const sweep2 = await api(req, 'patch', P + '/gate-closer', { action: 'sweep' });
  const out2 = ((sweep2.json.data as Json)?.outcomes as Json[]) ?? [];
  const mine2 = out2.find((o) => o.milestoneId === gatedId);
  A(mine2?.closed === true,
    'once the work is genuinely done, the AI manager closes it', String(mine2?.reason ?? '').slice(0, 70));

  const [closedRow] = await sql<{ status: string; note: string | null; metrics: unknown }[]>`
    SELECT status, completion_note AS note, completion_metrics AS metrics
      FROM project_milestones WHERE id = ${gatedId ?? null}::uuid`;
  A(closedRow?.status === 'met', 'and the row says met', String(closedRow?.status));
  A(JSON.stringify(closedRow?.metrics ?? {}).includes('ai_manager'),
    'the completion record says WHO closed it — an audit cannot tell a click from a sweep otherwise',
    JSON.stringify(closedRow?.metrics ?? {}));

  // A milestone left to a PERSON is never touched by the sweep.
  const [humanGated] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid AND gate_closer = 'human' AND status = 'pending'`;
  const sweep3 = await api(req, 'patch', P + '/gate-closer', { action: 'sweep' });
  const out3 = ((sweep3.json.data as Json)?.outcomes as Json[]) ?? [];
  A(out3.length === 0,
    'and a human-gated milestone is never even considered — opt-in means opt-in',
    `${humanGated?.n} human-gated pending, ${out3.length} swept`);

  // ══ 7u · TRACEABILITY — every line item, and what satisfies it ════════════════════════════
  //
  // A3, built as a DETERMINISTIC join rather than an agent: every question it answers is a foreign
  // key, and there is no judgement for a model to add. The assertions compare it against links this
  // drive itself created, so a wrong map cannot pass by agreeing with itself.
  phase('7u · traceability: the map matches the links this drive made');

  const trace = await api(req, 'get', P + '/traceability');
  A(trace.status === 200, 'the traceability map answers', `${trace.status}`);
  const traceClins = ((trace.json.data as Json)?.clins as Json[]) ?? [];
  const traceGaps = ((trace.json.data as Json)?.gaps as Json[]) ?? [];
  A(traceClins.length >= 1, 'it reports the project’s CLINs', `${traceClins.length}`);

  // Phase 4 put every milestone under `clinId`, so the map must find them there. Compared against
  // the DATABASE rather than against the map's own arithmetic.
  const [{ msUnderClin }] = await sql<{ msUnderClin: number }[]>`
    SELECT count(*)::int AS "msUnderClin" FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid AND clin_id = ${clinId ?? null}::uuid`;
  const mapped = ((traceClins[0]?.milestones as unknown[]) ?? []).length;
  A(mapped === msUnderClin,
    'and every milestone under that CLIN appears beneath it', `map=${mapped} db=${msUnderClin}`);

  // The CDRL registered in 7p has instances (7p created two), so it must NOT be reported as a gap.
  A(!traceGaps.some((g) => String(g.kind) === 'cdrl_without_instance'),
    'a CDRL that HAS deliverables is not reported as a gap');

  // And a gap NAMES its subject rather than counting. "3 gaps" sends somebody investigating; "CLIN
  // 0002 has no deliverable" is a thing to do.
  A(traceGaps.every((g) => typeof g.subject === 'string' && String(g.subject).length > 0),
    'every gap names the row it is about', `${traceGaps.length} gap(s)`);

  // A DELIBERATE gap, made and then measured: a milestone under no CLIN is work the contract does
  // not account for, and the map has to say so.
  const orphan = await api(req, 'post', P + '/milestones', {
    title: 'Unbilled internal review', forecastDate: iso(90), sortIndex: 90,
  });
  A(orphan.status === 201, 'a milestone is added under NO CLIN', `${orphan.status}`);
  const orphanId = ((orphan.json.data as Json)?.milestone as Json)?.id as string | undefined;
  const trace2 = await api(req, 'get', P + '/traceability');
  const gaps2 = ((trace2.json.data as Json)?.gaps as Json[]) ?? [];
  A(gaps2.some((g) => String(g.kind) === 'milestone_without_clin'
      && String(g.subject).includes('Unbilled internal review')),
    'and the map names it as work no line item accounts for — a gap it did not have a moment ago',
    `${gaps2.length} gap(s)`);
  const unassigned = ((trace2.json.data as Json)?.unassignedMilestones as unknown[]) ?? [];
  A(unassigned.length === 1, 'and lists it separately from the CLIN breakdown', `${unassigned.length}`);

  // Tidy it away — an open milestone blocks close-out, correctly.
  if (orphanId) {
    await api(req, 'patch', P + '/milestones', { action: 'met', milestoneId: orphanId, note: 'Not billable.' });
  }

  // ══ 7t · THE NARRATIVE DRAFTER — and the gate that makes it safe ══════════════════════════
  //
  // A2. The report's TABLES are correct by construction. This drafts the prose around them, and the
  // assertion that matters is not "an agent wrote something" — it is that a figure the system never
  // computed CANNOT reach the document.
  phase('7t · the status narrative: prose, and a gate on every number');

  const askedNarr = await api(req, 'post', P + '/draft-narrative', {});
  A(askedNarr.status === 202, 'a drafted narrative can be requested', `${askedNarr.status}`);
  A(/checked against what the system computed/i.test(String((askedNarr.json.data as Json)?.note ?? '')),
    'and the promise made to the person is the CHECK, not the prose');

  for (let i = 0; i < 30; i++) {
    const [done] = await sql<{ id: string }[]>`
      SELECT id FROM system_events
       WHERE namespace = 'project' AND type = 'status_narrative.requested' AND phase = 'end'
         AND payload->>'projectId' = ${created.projectId ?? null}`;
    if (done) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // WAIT FOR *THIS PROJECT'S* INSTANCE, not for any recent agent.invoked.
  //
  // The first version polled `agent.invoked` for the archetype inside a ten-minute window — which a
  // PREVIOUS run satisfies instantly, so the wait returned immediately and the read below ran
  // before this run's instance existed. A global-window check standing in for a per-entity one is
  // the same mistake as the assertion it then fed.
  let narrInstance: { steps: string | null } | undefined;
  for (let i = 0; i < 40 && !narrInstance?.steps; i++) {
    [narrInstance] = await sql<{ steps: string | null }[]>`
      SELECT step_results::text AS steps FROM process_instances
       WHERE workflow_name = 'OnStatusNarrativeRequested'
         AND payload->>'projectId' = ${created.projectId ?? null}
       ORDER BY created_at DESC LIMIT 1`;
    if (!narrInstance?.steps || narrInstance.steps === '{}') {
      narrInstance = undefined;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  A(Boolean(narrInstance), 'the workflow ran for THIS project and staged its step result');
  A(String(narrInstance?.steps ?? '').includes('emit_narrative'),
    'status_narrator fired — the 38th archetype, live, and it emitted');

  const readBack = await api(req, 'get', P + '/draft-narrative');
  A(readBack.status === 200, 'the draft reads back', `${readBack.status}`);
  const narrStatus = String((readBack.json.data as Json)?.status ?? '');
  // 'ready' or 'rejected' — the agent RAN, so a draft must have arrived and been judged. The first
  // version of this accepted 'none' and 'empty' too, on the reasoning that all four states are
  // legitimate; they are, but accepting them here let a real defect through as a pass. The route
  // was reading `agent.invoked`, which is a TELEMETRY record carrying neither the output nor a
  // projectId, so it answered 'none' forever and the assertion agreed with it.
  //
  // 'rejected' stays acceptable because it is not a failure of the feature — it IS the feature.
  A(['ready', 'rejected'].includes(narrStatus),
    'a draft ARRIVED and was judged — not "none", which is what a broken read looks like',
    narrStatus);
  if (narrStatus === 'ready') {
    A(typeof (readBack.json.data as Json)?.figuresChecked === 'number',
      'a READY draft reports how many figures it verified — a clean over zero is not a pass',
      `${(readBack.json.data as Json)?.figuresChecked}`);
  }
  if (narrStatus === 'rejected') {
    A(Array.isArray((readBack.json.data as Json)?.invented),
      'a REJECTED draft NAMES the invented figure — a person who got nothing deserves to know why',
      JSON.stringify((readBack.json.data as Json)?.invented));
  }

  // ── THE GATE ITSELF, DRIVEN AGAINST A KNOWN LIE ──────────────────────────────────────────
  // The live agent may or may not invent a figure on any given run, so the assertion above cannot
  // prove the gate WORKS — only that it ran. This proves it: the same check, over prose that
  // definitely contains a fabricated number, against the same project's real figures.
  {
    const { checkNarrativeFidelity, allowedFigures } = await import('../lib/projects/narrative-fidelity.ts');
    const real = await sql<{ planned: string | null }[]>`
      SELECT SUM(planned_cost)::text AS planned FROM project_milestones
       WHERE project_id = ${created.projectId}::uuid`;
    const allowed = allowedFigures(real);
    const lie = checkNarrativeFidelity('The programme is 87.5% complete and $9,412,000 has been spent.', allowed);
    A(lie.ok === false && lie.invented.includes('87.5'),
      'the gate REJECTS a fabricated figure — proven, not assumed',
      JSON.stringify(lie.invented));
    const honest = checkNarrativeFidelity('Two phases closed and nothing is blocked.', allowed);
    A(honest.ok === true, 'and passes prose that states nothing it should not');
  }

  // ══ 7s · THE POST-AWARD MANAGER — advisory, and provably so ═══════════════════════════════
  //
  // A1. The assertions are in two halves and the second is the important one: that the agent RAN,
  // and that having run, it changed NOTHING. An advisory agent that quietly writes is worse than
  // no agent, because the workspace then disagrees with the person who thought they were deciding.
  phase('7s · the project manager: it assesses, and it changes nothing');

  // Photograph the plan BEFORE, so "changed nothing" is a comparison and not a hope.
  const planBefore = await sql<{ id: string; status: string; forecast: string | null; baseline: string | null }[]>`
    SELECT id, status, forecast_date::text AS forecast, baseline_date::text AS baseline
      FROM project_milestones WHERE project_id = ${created.projectId}::uuid ORDER BY sort_index`;
  const [{ tasksBefore }] = await sql<{ tasksBefore: number }[]>`
    SELECT count(*)::int AS "tasksBefore" FROM project_milestone_tasks
     WHERE project_id = ${created.projectId}::uuid`;

  const askedHealth = await api(req, 'post', P + '/assess-health', {});
  A(askedHealth.status === 202, 'a tenant admin can request an assessment', `${askedHealth.status}`);
  A((askedHealth.json.data as Json)?.advisory === true,
    'and the route SAYS it is advisory, in the field a UI renders',
    String((askedHealth.json.data as Json)?.note ?? '').slice(0, 60));

  // The engine owns the run. Wait for the bracket to close rather than for a fixed sleep.
  let ranAt: string | null = null;
  for (let i = 0; i < 30 && !ranAt; i++) {
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM system_events
       WHERE namespace = 'project' AND type = 'health.assessment_requested' AND phase = 'end'
         AND payload->>'projectId' = ${created.projectId ?? null}`;
    if (row) ranAt = row.id; else await new Promise((r) => setTimeout(r, 1000));
  }
  A(Boolean(ranAt), 'the request event closed its bracket — a start with no end is B139');

  // The engine picked it up: a managed instance exists, correlated to THIS request's event.
  // `workflow_name` + `trigger_event_id` — the predicate COPIED from phase 2 of this same drive,
  // which already reads process_instances correctly. The first version of this invented
  // `template_key` and `context->>'projectId'`, neither of which is a column: a predicate I
  // believed equivalent, which is the rule this repo has written down twice.
  let instance: { status: string } | undefined;
  for (let i = 0; i < 30 && !instance; i++) {
    [instance] = await sql<{ status: string }[]>`
      SELECT status FROM process_instances
       WHERE workflow_name = 'OnProjectHealthRequested' AND trigger_event_id = ${ranAt}::uuid
       ORDER BY created_at DESC LIMIT 1`;
    if (!instance) await new Promise((r) => setTimeout(r, 1000));
  }
  A(Boolean(instance), 'the workflow engine created an instance from the event',
    instance?.status ?? 'none');

  // THE AGENT FIRED. `agent.invoked` carrying the archetype is the verification signal the whole
  // workforce uses (docs/AGENT_WORKFORCE.md §0).
  let fired = 0;
  for (let i = 0; i < 30 && fired === 0; i++) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM system_events
       WHERE type = 'agent.invoked' AND payload->>'archetype' = 'project_manager'
         AND created_at > now() - interval '10 minutes'`;
    fired = row?.n ?? 0;
    if (fired === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  A(fired > 0, 'project_manager actually fired — the 37th archetype, live', `${fired} invocation(s)`);

  // ── AND IT CHANGED NOTHING ───────────────────────────────────────────────────────────────
  const planAfter = await sql<{ id: string; status: string; forecast: string | null; baseline: string | null }[]>`
    SELECT id, status, forecast_date::text AS forecast, baseline_date::text AS baseline
      FROM project_milestones WHERE project_id = ${created.projectId}::uuid ORDER BY sort_index`;
  A(JSON.stringify(planAfter) === JSON.stringify(planBefore),
    'NOT ONE milestone moved — no status, no forecast, no baseline',
    `${planBefore.length} milestone(s) compared`);
  const [{ tasksAfter }] = await sql<{ tasksAfter: number }[]>`
    SELECT count(*)::int AS "tasksAfter" FROM project_milestone_tasks
     WHERE project_id = ${created.projectId}::uuid`;
  A(tasksAfter === tasksBefore, 'and it created no work of its own', `${tasksBefore} → ${tasksAfter}`);

  // ══ 7r · THE REMINDER POLICY — and whether changing it changes anything ═══════════════════
  //
  // A settings page that stores a value nothing reads is the failure this whole layer is built to
  // avoid ("a control that silently does nothing is a broken promise"). So every assertion here is
  // about the ToDo that actually gets raised AFTERWARDS, not about the row that was written.
  phase('7r · reminders: the dial moves the thing it points at');

  const pol0 = await api(req, 'get', P + '/notifications');
  const pols = ((pol0.json.data as Json)?.triggers as Json[]) ?? [];
  A(pol0.status === 200 && pols.length >= 2, 'the project answers with its resolved policy',
    `${pol0.status} · ${pols.length} trigger(s)`);
  const assignPol = pols.find((t) => t.trigger === 'project:task.assigned');
  A(JSON.stringify(assignPol?.nudgeDays) === '[7,2,0]',
    'unconfigured, it is the platform default', JSON.stringify(assignPol?.nudgeDays));
  A((assignPol?.source as Json)?.projectOverride === false,
    'and it says so — which LEVEL decided is half the answer');
  A(assignPol?.deliveryStatus === 'active',
    'the dial declares itself as actually delivering', String(assignPol?.deliveryStatus));

  // ── CHANGE IT, THEN ASSIGN WORK, THEN READ THE TODO ──────────────────────────────────────
  const setPol = await api(req, 'patch', P + '/notifications', {
    trigger: 'project:task.assigned', nudgeDays: [5, 1], channel: 'todo',
  });
  A(setPol.status === 200, 'a per-project override saves', `${setPol.status}`);
  A(JSON.stringify((setPol.json.data as Json)?.nudgeDays) === '[5,1]',
    'and resolves to the new cadence', JSON.stringify((setPol.json.data as Json)?.nudgeDays));

  const policedTask = await api(req, 'post', P + '/tasks', {
    milestoneId, title: 'Work assigned under the new cadence', assigneeUserId: assignee?.id,
    dueDate: iso(20),
  });
  A(policedTask.status === 201, 'work is assigned after the change', `${policedTask.status}`);
  const policedId = ((policedTask.json.data as Json)?.task as Json)?.id as string | undefined;

  // `nudge_schedule`, and asserted as a PROPERTY rather than an exact array: `createTask` drops a
  // 0-day beat (a reminder on the due date is handled by the overdue sweep, not the pre-nudge), so
  // pinning [5,1] would be asserting my assumption about the platform's filtering rather than the
  // thing under test. What matters is that it followed THIS PROJECT's cadence and not the default.
  const [raisedTodo] = await sql<{ sched: number[] | null }[]>`
    SELECT nudge_schedule AS sched FROM tasks
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'project_milestone_task'
       AND entity_id = ${policedId ?? null}::uuid`;
  const sched = raisedTodo?.sched ?? [];
  A(sched.includes(5) && sched.includes(1) && !sched.includes(7) && !sched.includes(2),
    'THE TODO CARRIES THE PROJECT CADENCE, not the default — the dial moved what it points at',
    JSON.stringify(sched));

  // `channel: 'todo'` means the queue WITHOUT the mail. The ToDo row is not optional — the
  // checklist projection retires it — so what a person is choosing is whether their inbox is used.
  const [mailed] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM system_events
     WHERE namespace = 'system' AND type = 'notification.requested'
       AND payload->>'taskId' = ${policedId ?? null}`;
  A(mailed?.n === 0, 'and channel=todo raised the ToDo WITHOUT the email', `${mailed?.n} mail event(s)`);

  // ── AND CLEARING IS NOT THE SAME AS RETYPING ─────────────────────────────────────────────
  const cleared = await api(req, 'patch', P + '/notifications', {
    trigger: 'project:task.assigned', nudgeDays: null, channel: null, enabled: null,
  });
  A(cleared.status === 200 && JSON.stringify((cleared.json.data as Json)?.nudgeDays) === '[7,2,0]',
    'clearing returns to inherit, not to a copy of what was inherited',
    JSON.stringify((cleared.json.data as Json)?.nudgeDays));
  const [rowAfter] = await sql<{ pol: unknown }[]>`
    SELECT notification_policy AS pol FROM projects WHERE id = ${created.projectId}::uuid`;
  A(!JSON.stringify(rowAfter?.pol ?? {}).includes('task.assigned'),
    'and the key is GONE from the row — inherit reads as absent',
    JSON.stringify(rowAfter?.pol ?? {}).slice(0, 60));

  // Tick it off so it does not block close-out — standing work is standing work.
  if (policedId) await api(req, 'patch', P + `/tasks/${policedId}`, { status: 'done' });

  // ══ 7q · THE STATUS REPORT — a document whose numbers are read, not typed ═════════════════
  //
  // Not a new kind of thing: a fifth PRESET on the same deliverable, producing the same
  // `tenant_documents` row on the same rules. The assertions are about what it SAYS — the three
  // measures stay three, and nothing in it was invented.
  phase('7q · the status report: prefilled from the rollup');

  const srDel = await api(req, 'post', P + '/deliverables', {
    milestoneId, title: 'Monthly status report — June', requiredBy: iso(75),
  });
  A(srDel.status === 201, 'a deliverable exists to author the report against', `${srDel.status}`);
  const srId = ((srDel.json.data as Json)?.deliverable as Json)?.id as string | undefined;

  const authored = await api(req, 'patch', P + `/deliverables/${srId}`, {
    action: 'author', preset: 'status_report',
  });
  A(authored.status === 200 || authored.status === 201, 'it authors as a status report', `${authored.status}`);
  // Same shape as the letter draft above: `data.document.documentId`. Read the route, do not
  // assume the envelope's inner shape.
  const srDocId = ((authored.json.data as Json)?.document as Json)?.documentId as string | undefined;
  A(Boolean(srDocId), 'and it is a real tenant_documents row');

  const [srDoc] = await sql<{ nodeCount: number; canvas: unknown }[]>`
    SELECT node_count AS "nodeCount", canvas FROM tenant_documents
     WHERE id = ${srDocId ?? null}::uuid`;
  A((srDoc?.nodeCount ?? 0) > 5,
    'the document is NOT a blank page — the G3 failure, which a magic-number check cannot see',
    `${srDoc?.nodeCount} node(s)`);

  // Read the words back out of the stored canvas: what a person will actually see.
  const srText = JSON.stringify(srDoc?.canvas ?? {});
  A(/Cost/.test(srText) && /Schedule/.test(srText) && /Deliverables/.test(srText),
    'and it carries all THREE measures, side by side');
  A(!/44\.4|percent complete|overall progress/i.test(srText),
    'with no blended figure — the number that looks most like an answer and is worth least');
  A(/snapshot and do not update/.test(srText),
    'it says the figures are a snapshot, so a June report keeps saying June');

  // A real artifact. An unexported report is a claim about a document nobody has opened.
  // The export route is a POST carrying the canvas — the same one the build portal uses.
  const srPdf = await req.fetch(`${BASE}/api/portal/${TENANT}/documents/${srDocId}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    data: { document: srDoc?.canvas, format: 'pdf' },
  });
  A(srPdf.status() === 200, 'the report exports as a PDF', `${srPdf.status()}`);
  const srBytes = await srPdf.body();
  // BYTES AND CONTENT, not just a magic number. G3 shipped a blank authored deliverable that
  // passed a `%PDF` check at 865 bytes — the length is the half that would have caught it.
  A(srBytes.length > 2000 && srBytes.subarray(0, 4).toString() === '%PDF',
    'and it is a real PDF with content in it, not an 865-byte nothing',
    `${srBytes.length} bytes`);

  // And it is an ORDINARY deliverable in every other respect — accepted through the same gate,
  // with no special path. Its `document_id` is what satisfies the attachment requirement, which is
  // the widening mig 220 made (`NOTHING_ATTACHED` accepts a file OR a document).
  const srAccept = await api(req, 'patch', P + `/deliverables/${srId}`, { action: 'accept' });
  A(srAccept.status === 200,
    'and it accepts through the ordinary gate — a generated document is still a deliverable',
    `${srAccept.status} ${String((srAccept.json as Json).code ?? '')}`);

  // ══ 7p · THE CDRL REGISTER — the obligation, and the third state ══════════════════════════
  //
  // A CDRL is a standing requirement; its submission history IS its deliverables. The assertion
  // that matters is the GATE: uploading is not accepting, and accepting is not sending.
  phase('7p · CDRL: registered, and delivered to the customer');

  const badFreq = await api(req, 'post', P + '/cdrl', {
    cdrlNumber: 'A999', title: 'Monthly status report', frequency: 'monthly',
  });
  A(badFreq.status === 400, 'a recurring item with no first due date is refused', `${badFreq.status}`);
  A(/first due date/i.test(String(badFreq.json.error ?? '')),
    'and the refusal names the field', String(badFreq.json.error ?? '').slice(0, 60));

  const cdrl = await api(req, 'post', P + '/cdrl', {
    cdrlNumber: 'A002', title: 'Monthly status report', didNumber: 'DI-MGMT-81334D',
    clinId, frequency: 'monthly', approvalCode: 'A', distribution: 'B',
    distributionNote: 'Critical technology; controlling office AFRL/RQ.', firstDue: iso(30),
  });
  A(cdrl.status === 201, 'a CDRL item is registered', `${cdrl.status}`);
  const cdrlId = ((cdrl.json.data as Json)?.item as Json)?.id as string | undefined;

  const dupe = await api(req, 'post', P + '/cdrl', { cdrlNumber: 'A002', title: 'again' });
  A(dupe.status === 409, 'a duplicate CDRL number is refused', `${dupe.status}`);

  // Tie THIS project's already-accepted deliverable to the requirement — one instance of it.
  await sql`
    UPDATE project_deliverables SET cdrl_item_id = ${cdrlId ?? null}::uuid
     WHERE id = ${deliverableId ?? null}::uuid`;

  const register = await api(req, 'get', P + '/cdrl');
  const regItems = ((register.json.data as Json)?.items as Json[]) ?? [];
  A(register.status === 200 && regItems.length === 1, 'the register reads back', `${regItems.length} item(s)`);
  A((regItems[0]?.instances as number) === 1 && (regItems[0]?.sent as number) === 0,
    'and the item shows 1 instance, 0 sent — the question a register exists to answer',
    `${regItems[0]?.sent} of ${regItems[0]?.instances}`);

  // ── THE GATE, ON A CASE THE DRIVE CREATES ────────────────────────────────────────────────
  //
  // The first version of this looked for an existing unaccepted deliverable and reported
  // "none found" when it did not find one — by this point every deliverable on the project has
  // been accepted. That is UNCOVERED, not passing, and it left the most important assertion in
  // the phase unexercised. So the case is built rather than hoped for.
  const gateDel = await api(req, 'post', P + '/deliverables', {
    milestoneId, title: 'Monthly status report — May', requiredBy: iso(60),
  });
  A(gateDel.status === 201, 'a fresh, unaccepted deliverable exists to test the gate with', `${gateDel.status}`);
  const gateId = ((gateDel.json.data as Json)?.deliverable as Json)?.id as string | undefined;
  await sql`UPDATE project_deliverables SET cdrl_item_id = ${cdrlId ?? null}::uuid WHERE id = ${gateId ?? null}::uuid`;

  const cdrlTooSoon = await api(req, 'patch', P + '/cdrl', {
    action: 'submitted', deliverableId: gateId, submittedAt: iso(0),
  });
  A(cdrlTooSoon.status === 409 && String((cdrlTooSoon.json as Json).code) === 'NOT_ACCEPTED',
    'an UNACCEPTED deliverable cannot be sent to the customer',
    `${cdrlTooSoon.status} ${String((cdrlTooSoon.json as Json).code)}`);
  A(/Uploading is not accepting/i.test(String(cdrlTooSoon.json.error ?? '')),
    'and the refusal draws the line in words', String(cdrlTooSoon.json.error ?? '').slice(0, 60));

  // AND IT IS A GATE, NOT A DENY-ALL. Accept it, and the same call now works — without this the
  // assertion above would pass identically against a route that refused everything.
  await req.fetch(`${BASE + P}/deliverables/${gateId}`, {
    method: 'POST',
    multipart: { file: { name: 'may-status.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 MAY') } },
  });
  await api(req, 'patch', P + `/deliverables/${gateId}`, { action: 'accept' });
  const nowAllowed = await api(req, 'patch', P + '/cdrl', {
    action: 'submitted', deliverableId: gateId, submittedAt: iso(0), transmittalRef: 'TR-2026-015',
  });
  A(nowAllowed.status === 200,
    'and once accepted, the SAME call goes through — a gate, not a deny-all',
    `${nowAllowed.status} ${String((nowAllowed.json as Json).code ?? '')}`);

  // And the accepted one goes out, LATE, with the lateness measured against the day it was SENT.
  const sent = await api(req, 'patch', P + '/cdrl', {
    action: 'submitted', deliverableId, submittedAt: iso(50), transmittalRef: 'TR-2026-014',
  });
  A(sent.status === 200, 'an ACCEPTED deliverable is recorded as sent', `${sent.status}`);
  A(typeof (sent.json.data as Json)?.daysLate === 'number',
    'with a real lateness figure, not null', `daysLate=${(sent.json.data as Json)?.daysLate}`);

  const [delRow] = await sql<{ submittedAt: string | null; transmittalRef: string | null }[]>`
    SELECT submitted_at::text AS "submittedAt", transmittal_ref AS "transmittalRef"
      FROM project_deliverables WHERE id = ${deliverableId ?? null}::uuid`;
  A(Boolean(delRow?.submittedAt) && delRow?.transmittalRef === 'TR-2026-014',
    'the row records both the date and how it went out',
    `${delRow?.submittedAt} · ${delRow?.transmittalRef}`);

  const twiceSent = await api(req, 'patch', P + '/cdrl', {
    action: 'submitted', deliverableId, submittedAt: iso(51),
  });
  A(twiceSent.status === 409, 'sending the same thing twice is refused', `${twiceSent.status}`);

  // UN-sending is refused by the database, not merely by the route — the record of what the
  // customer received has to survive whichever writer arrives.
  let unsendRefused = false;
  try {
    await sql`UPDATE project_deliverables SET submitted_at = NULL WHERE id = ${deliverableId ?? null}::uuid`;
  } catch (e) { unsendRefused = (e as { code?: string })?.code === '23001'; }
  A(unsendRefused, 'and un-sending is refused by the database itself (23001)');

  const after = await api(req, 'get', P + '/cdrl');
  const afterItems = ((after.json.data as Json)?.items as Json[]) ?? [];
  // TWO instances now — the original and the one built for the gate test — and both have gone out.
  // Asserted as sent===instances rather than a hard-coded count, so adding a case above does not
  // silently turn this into a number nobody re-derived.
  A((afterItems[0]?.sent as number) === (afterItems[0]?.instances as number)
    && (afterItems[0]?.instances as number) === 2,
    'the register now reads every instance as sent',
    `${afterItems[0]?.sent} of ${afterItems[0]?.instances}`);

  // ══ 7n · BILLING — the ceiling, the hours, and the claim ══════════════════════════════════
  //
  // The two invariants, both against a number a customer is billed for: you cannot bill past what
  // the contract funded, and the same hours cannot be billed twice. Both are read back from the
  // database rather than trusted from the route's own answer.
  phase('7n · invoicing: the ceiling holds and hours are billed once');

  // The CLIN was moved to 900,000 by P00001 a moment ago — so the ceiling under test is the one a
  // signed modification set, which is the whole point of the two features meeting.
  const billing0 = await api(req, 'get', P + '/invoices');
  const pos0 = ((billing0.json.data as Json)?.billing as Json[]) ?? [];
  A(billing0.status === 200 && pos0.length > 0, 'the billing position answers', `${billing0.status} · ${pos0.length} CLIN(s)`);
  A(Number(pos0[0]?.fundedAmount) === 900000,
    'and its ceiling is what the MODIFICATION set, not the original award',
    `${pos0[0]?.fundedAmount}`);
  A(Number(pos0[0]?.billed) === 0, 'nothing billed yet', `${pos0[0]?.billed}`);

  const inv1 = await api(req, 'post', P + '/invoices', {
    invoiceNumber: 'INV-0001',
    lines: [{ clinId, description: 'April progress', source: 'manual', amount: 500000 }],
  });
  A(inv1.status === 201, 'an invoice is drafted', `${inv1.status}`);
  const inv1Id = ((inv1.json.data as Json)?.invoice as Json)?.id as string | undefined;

  // A DRAFT is not a claim: the position must not move.
  const afterDraft = await api(req, 'get', P + '/invoices');
  const posDraft = ((afterDraft.json.data as Json)?.billing as Json[]) ?? [];
  A(Number(posDraft[0]?.billed) === 0,
    'and a DRAFT does not move the billed position — nothing has been claimed',
    `${posDraft[0]?.billed}`);

  const sub1 = await api(req, 'patch', P + '/invoices', {
    action: 'submit', invoiceId: inv1Id, submittedOn: iso(0),
  });
  A(sub1.status === 200, 'submitting makes it a claim', `${sub1.status}`);
  const afterSubmit = await api(req, 'get', P + '/invoices');
  const posSub = ((afterSubmit.json.data as Json)?.billing as Json[]) ?? [];
  A(Number(posSub[0]?.billed) === 500000, 'and NOW it is billed', `${posSub[0]?.billed}`);
  A(Number(posSub[0]?.remaining) === 400000, 'with the remaining figure following', `${posSub[0]?.remaining}`);

  // ── THE CEILING, CUMULATIVELY ────────────────────────────────────────────────────────────
  // 500,000 is already claimed against 900,000 funded. A second invoice of 500,000 is under the
  // ceiling on its own and over it in total — which is exactly the case a per-invoice check misses.
  const inv2 = await api(req, 'post', P + '/invoices', {
    invoiceNumber: 'INV-0002',
    lines: [{ clinId, description: 'May progress', source: 'manual', amount: 500000 }],
  });
  A(inv2.status === 201, 'a second invoice drafts fine — a draft may hold anything', `${inv2.status}`);
  const inv2Id = ((inv2.json.data as Json)?.invoice as Json)?.id as string | undefined;
  const sub2 = await api(req, 'patch', P + '/invoices', {
    action: 'submit', invoiceId: inv2Id, submittedOn: iso(0),
  });
  A(sub2.status === 409 && String((sub2.json as Json).code) === 'OVER_FUNDED_CEILING',
    'but submitting it is REFUSED — cumulative, not per-invoice',
    `${sub2.status} ${String((sub2.json as Json).code)}`);
  A(/100000\.00 over/.test(String(sub2.json.error ?? '')),
    'and the refusal says by how much', String(sub2.json.error ?? '').slice(0, 80));

  // ── SUBMITTED IS NOT PAID ────────────────────────────────────────────────────────────────
  const part = await api(req, 'patch', P + '/invoices', {
    action: 'pay', invoiceId: inv1Id, paidOn: iso(0), amount: 450000,
  });
  A(part.status === 200 && ((part.json.data as Json)?.settled as boolean) === false,
    'a PARTIAL payment does not settle the claim — the withholding is the normal case',
    `settled=${(part.json.data as Json)?.settled}`);
  const rest = await api(req, 'patch', P + '/invoices', {
    action: 'pay', invoiceId: inv1Id, paidOn: iso(0), amount: 50000,
  });
  A(rest.status === 200 && ((rest.json.data as Json)?.settled as boolean) === true,
    'and the rest settles it', `settled=${(rest.json.data as Json)?.settled}`);

  const [paidRow] = await sql<{ status: string; amountPaid: string; paidOn: string | null }[]>`
    SELECT status, amount_paid AS "amountPaid", paid_on::text AS "paidOn"
      FROM project_invoices WHERE id = ${inv1Id ?? null}::uuid`;
  A(paidRow?.status === 'paid' && Number(paidRow?.amountPaid) === 500000 && Boolean(paidRow?.paidOn),
    'the row agrees — status, amount and stamp are one fact',
    `${paidRow?.status} @ ${paidRow?.amountPaid} on ${paidRow?.paidOn}`);

  // A submitted invoice's lines are FROZEN by the trigger — the claim is what was claimed.
  const frozenLine = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM project_invoice_lines WHERE invoice_id = ${inv1Id ?? null}::uuid`;
  let lineEditRefused = false;
  try {
    await sql`UPDATE project_invoice_lines SET amount = 1 WHERE invoice_id = ${inv1Id ?? null}::uuid`;
  } catch (e) { lineEditRefused = (e as { code?: string })?.code === '23001'; }
  A(lineEditRefused, 'a submitted invoice’s lines cannot be edited (23001)', `${frozenLine[0]?.n} line(s)`);

  // ── VOID RELEASES ────────────────────────────────────────────────────────────────────────
  const voided = await api(req, 'patch', P + '/invoices', {
    action: 'void', invoiceId: inv2Id, reason: 'Raised against the wrong period',
  });
  A(voided.status === 200, 'the over-ceiling draft is voided with a reason', `${voided.status}`);
  const afterVoid = await api(req, 'get', P + '/invoices');
  const posVoid = ((afterVoid.json.data as Json)?.billing as Json[]) ?? [];
  A(Number(posVoid[0]?.billed) === 500000,
    'and a void does not count against the funding', `${posVoid[0]?.billed}`);

  // ══ 7k · THE REGISTER — a risk, and the day it stopped being one ═══════════════════════════
  //
  // The question a program review asks is not "what are the risks" but "when did we know, and what
  // did we rate it?" Two tables would make the transition a copy, and a copied row answers neither.
  phase('7k · risks and issues: one row, moved, keeping its history');

  const raised = await api(req, 'post', P + '/risks', {
    title: 'Rig vendor lead time slips past the demo',
    probability: 4, impact: 5, ownerUserId: assignee?.id ?? null,
    mitigation: 'Order the long-lead parts now', reviewOn: iso(14),
  });
  A(raised.status === 201, 'a risk is raised', `${raised.status} ${raised.text.slice(0, 70)}`);
  const riskId = ((raised.json.data as Json)?.risk as Json)?.id as string | undefined;

  const [scored] = await sql<{ score: number; probability: number }[]>`
    SELECT score, probability FROM project_risks WHERE id = ${riskId ?? null}::uuid`;
  A(scored?.score === 20,
    'and the database computed its score — never a number the UI sent', `${scored?.score}`);

  const badRating = await api(req, 'post', P + '/risks', { title: 'x', probability: 9, impact: 3 });
  A(badRating.status === 400, 'a rating outside 1-5 is refused, not clamped', `${badRating.status}`);

  // ── THE MITIGATION IS A REAL TASK, ON THE SPINE THAT ALREADY EXISTS ───────────────────────
  const mitig = await api(req, 'patch', P + `/risks/${riskId}`, {
    action: 'mitigate', assigneeUserId: assignee?.id ?? null, dueDate: iso(10),
  });
  A(mitig.status === 201, 'its mitigation becomes a real project task', `${mitig.status}`);
  const mitigTaskId = ((mitig.json.data as Json)?.taskId) as string | undefined;
  const [{ mitigTodos }] = await sql<{ mitigTodos: number }[]>`
    SELECT count(*)::int AS "mitigTodos" FROM tasks
     WHERE task_type = 'project_task' AND entity_id = ${mitigTaskId ?? null}::uuid`;
  A(mitigTodos === 1,
    'which means it inherits the ToDo, the email and the nudges — not a second checklist',
    `${mitigTodos} ToDo(s)`);

  // ── AND THEN IT HAPPENS ───────────────────────────────────────────────────────────────────
  const happened = await asEmployee_((ctx) =>
    api(ctx.request, 'patch', P + `/risks/${riskId}`, { action: 'raise_issue' }));
  A(happened?.status === 200, 'an employee can say it happened — they usually see it first',
    `${happened?.status ?? 'no employee to be'}`);

  const [afterIssue] = await sql<{ kind: string; probability: number; score: number; becameIssueAt: string | null }[]>`
    SELECT kind, probability, score, became_issue_at AS "becameIssueAt"
      FROM project_risks WHERE id = ${riskId ?? null}::uuid`;
  A(afterIssue?.kind === 'issue' && Boolean(afterIssue?.becameIssueAt),
    'the SAME row became an issue, and recorded when', `${afterIssue?.kind}`);
  A(afterIssue?.score === 20 && afterIssue?.probability === 4,
    'and it KEPT the score it was rated at — "we had this at 20 and it landed"',
    `score=${afterIssue?.score}`);

  const twiceIssue = await api(req, 'patch', P + `/risks/${riskId}`, { action: 'raise_issue' });
  A(twiceIssue.status === 409, 'a second click cannot re-stamp the day we learned', `${twiceIssue.status}`);

  const [{ riskRows }] = await sql<{ riskRows: number }[]>`
    SELECT count(*)::int AS "riskRows" FROM project_risks
     WHERE project_id = ${created.projectId ?? null}::uuid`;
  A(riskRows === 1, 'ONE row, moved — not a risk row plus an issue row', `${riskRows}`);

  const closedRisk = await api(req, 'patch', P + `/risks/${riskId}`, {
    action: 'close', note: 'Parts arrived; demo held on the original date.',
  });
  A(closedRisk.status === 200, 'a tenant_admin closes it', `${closedRisk.status}`);

  // ══ 7j · THE CUSTOMER'S ACT, FILED BY US ═══════════════════════════════════════════════════
  //
  // This replaces a COR read-only portal, which would have reopened the boundary
  // lib/projects/access.ts closes by refusing partner_user the project capability outright. The
  // customer's signature reaches the system as a FILE the tenant_admin already has — and the record
  // must read as what it is.
  phase('7j · customer acceptance evidence — a claim ABOUT them, not their act');

  const evidenceRes = await req.fetch(
    `${BASE}/api/portal/${TENANT}/projects/${created.projectId}/deliverables/${authoredId}/evidence`,
    {
      method: 'POST',
      multipart: {
        file: { name: 'cor-acceptance.eml', mimeType: 'message/rfc822', buffer: Buffer.from('From: rivera@af.mil\r\nAccepted.') },
        kind: 'cor_email', customerName: 'J. Rivera', customerRole: 'COR', occurredOn: iso(-2),
      },
    },
  );
  A(evidenceRes.status() === 201, 'a tenant_admin can file the customer&apos;s acceptance evidence'.replace('&apos;', "'"),
    `${evidenceRes.status()}`);

  const [ev] = await sql<{ customerName: string | null; uploadedBy: string | null; kind: string }[]>`
    SELECT customer_name AS "customerName", uploaded_by AS "uploadedBy", kind
      FROM project_acceptance_evidence WHERE deliverable_id = ${authoredId ?? null}::uuid
     ORDER BY uploaded_at DESC LIMIT 1`;
  A(ev?.customerName === 'J. Rivera' && Boolean(ev?.uploadedBy),
    'and the row keeps the reported name and the filing admin APART — two different facts',
    `reports "${ev?.customerName}" · filed by a real user`);

  // The rule, checked rather than trusted: the evidence must not have accepted anything.
  const [{ evidenceRows }] = await sql<{ evidenceRows: number }[]>`
    SELECT count(*)::int AS "evidenceRows" FROM project_acceptance_evidence
     WHERE deliverable_id = ${authoredId ?? null}::uuid`;
  A(evidenceRows > 0, 'the evidence is on file');

  // Its own short-lived session: the one 7f opened was closed at the end of 7h, and reaching for
  // a closed context is how a drive starts depending on its own ordering (learned in 7h).
  const denied = await asEmployee_((ctx) => ctx.request.fetch(
    `${BASE}/api/portal/${TENANT}/projects/${created.projectId}/deliverables/${authoredId}/evidence`,
    {
      method: 'POST',
      multipart: {
        file: { name: 'not-mine.eml', mimeType: 'message/rfc822', buffer: Buffer.from('x') },
        kind: 'cor_email',
      },
    },
  ));
  if (denied === null) no('no employee to test the evidence gate with — the refusal is UNMEASURED');
  else {
    A(denied.status() === 403,
      'and an employee cannot file it — a claim about somebody outside the company is narrower '
      + 'than an upload', `${denied.status()}`);
  }

  // ══ 7i · THE INBOX — project work reaches the surfaces a person already reads ══════════════
  //
  // Until now the bell selected `namespace IN ('proposal','capture','library','system')`, so every
  // project event this drive has emitted reached NOBODY. Two checks, because "the feed returns
  // rows" and "the rows say something a person understands" are different claims.
  phase('7i · the bell and the Command Center carry post-award work');

  const bell = await api(req, 'get', `/api/portal/${TENANT}/notifications?limit=100`);
  const feed = ((bell.json.data as Json)?.notifications ?? []) as Json[];
  const projectRows = feed.filter((n) => n.namespace === 'project');
  A(bell.status === 200 && projectRows.length > 0,
    'project events reach the notification bell at all',
    `${projectRows.length} of ${feed.length} row(s)`);

  // A label that fell through the humanizer reads like a de-punctuated identifier. The feed is
  // populated either way, which is why this is asserted rather than eyeballed (B136).
  const unlabelled = projectRows.filter((n) => {
    const t = String(n.type ?? '');
    const fallback = t.replace(/[._]/g, ' ').trim();
    const cap = fallback.charAt(0).toUpperCase() + fallback.slice(1);
    return String(n.title ?? '') === cap;
  });
  A(unlabelled.length === 0,
    'and every one of them is a written sentence, not a de-punctuated type',
    unlabelled.map((n) => String(n.type)).join(', ') || 'all labelled');

  const forMe = projectRows.filter((n) => n.is_for_you === true);
  A(forMe.length > 0,
    'and work on a project I am ON is flagged for me — the roster is the routing key',
    `${forMe.length} flagged`);

  const cc = await req.fetch(`${BASE}/portal/${TENANT}/command`);
  const ccBody = await cc.text();
  A(cc.status() === 200 && /Projects/.test(ccBody),
    'the Command Center carries a Projects lane', `${cc.status()}`);

  // ══ 7c · DB → UI → DB: the page states what the tables hold ════════════════════════════════
  //
  // The whole point of "full DB to UI and back again". Everything above wrote through the API; this
  // reads the RENDERED PAGE as a person sees it and reconciles it against the rows — the rule being
  // that the expectation is the page's own query, not one I believe equivalent.
  phase('7c · DB → UI → DB reconciliation on the rendered workspace');

  const uiPage = await ctx.newPage();
  await uiPage.goto(`${BASE}/portal/${TENANT}/projects/${created.projectId}`, { waitUntil: 'domcontentloaded' });
  await uiPage.waitForLoadState('networkidle').catch(() => {});
  await uiPage.waitForTimeout(1200);
  const body = (await uiPage.locator('body').innerText()).replace(/\s+/g, ' ');

  // Counted PER MILESTONE, matching what the page renders. The page draws one "N of M done" per
  // milestone (and one for standing work), so a project-wide count is not the page's own predicate
  // — it only agreed while every task happened to sit under one milestone, and mig 221's standing
  // list broke that coincidence. Copy the predicate from the source.
  const [counts] = await sql<{ ms: number; done: number; tasks: number }[]>`
    SELECT (SELECT count(*)::int FROM project_milestones WHERE project_id = ${created.projectId}::uuid) AS ms,
           (SELECT count(*)::int FROM project_milestone_tasks
             WHERE milestone_id = ${workPhase ?? null}::uuid AND status = 'done') AS done,
           (SELECT count(*)::int FROM project_milestone_tasks
             WHERE milestone_id = ${workPhase ?? null}::uuid) AS tasks`;
  A(body.includes(`${counts.done} of ${counts.tasks} done`),
    'the checklist counter on the page equals the rows',
    `page expects "${counts.done} of ${counts.tasks} done"`);
  A(body.includes('Demonstration flown; both objectives met on the first attempt.'),
    'the completion NOTE reaches the page');
  A(/attendees\s+11/.test(body), 'and so do the metrics', 'attendees 11');
  for (const c of chain) A(body.includes(c.title), `the plan shows "${c.title}"`);
  A(!/\bNaN\b|Invalid Date/.test(body), 'no NaN and no Invalid Date anywhere on the workspace');

  // And back again: what the page shows is what the API returns, so a reader of either is reading
  // the same thing.
  const viaApi = await api(req, 'get', P + '/milestones');
  const apiTasks = ((viaApi.json.data as Json)?.tasks ?? []) as Json[];
  // PROJECT-WIDE, which is what this route returns — distinct from `counts.tasks`, which is the
  // per-milestone number the page prints. One variable was serving both, and only agreed while
  // every task sat under a single milestone.
  const [{ allTasks }] = await sql<{ allTasks: number }[]>`
    SELECT count(*)::int AS "allTasks" FROM project_milestone_tasks
     WHERE project_id = ${created.projectId}::uuid`;
  A(apiTasks.length === allTasks, 'the API returns every task on the project',
    `api=${apiTasks.length} db=${allTasks}`);
  await uiPage.close();

  // ══ 8 · HITL — closing the gate the automation opened ══════════════════════════════════════
  phase('8 · HITL: completing the ToDo the engine raised');
  if (todo) {
    // POST /tasks {taskId} is the COMPLETION route; PATCH /tasks/[id] is reassign/reschedule.
    const done = await api(req, 'post', `/api/portal/${TENANT}/tasks`, { taskId: todo.id, result: { via: 'e2e' } });
    A(done.status === 200 || done.status === 204, 'the human closes the setup ToDo', `${done.status}`);
    const [after] = await sql<{ status: string }[]>`SELECT status FROM tasks WHERE id = ${todo.id}`;
    A(after?.status === 'completed', 'and the task row records it', after?.status ?? '');
  }

  // ══ 9 · the agents — measured, not assumed ═════════════════════════════════════════════════
  phase('9 · agents: what the fabric actually does with a project');
  // Two different ways an agent runs, and only one touches `agent_task_queue`: a fan-out producer
  // QUEUES, while a declarative `AI_INVOKE` step runs INLINE in the engine. A probe reading only
  // the queue reports "no agents" for a run in which an agent did work — so read both.
  const queued = await sql<{ agentRole: string }[]>`
    SELECT DISTINCT agent_role AS "agentRole" FROM agent_task_queue
     WHERE created_at > now() - interval '15 minutes'`;
  const inline = await sql<{ agentRole: string; n: number }[]>`
    SELECT agent_role AS "agentRole", count(*)::int AS n FROM episodic_memories
     WHERE created_at > now() - interval '15 minutes' GROUP BY agent_role ORDER BY 2 DESC`;
  const [{ n: projectTriggers }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM process_templates WHERE trigger_key LIKE 'project:%'`;
  const [{ n: toolCalls }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM system_events
     WHERE namespace = 'tool' AND type = 'agent.invoked'
       AND created_at > now() - interval '15 minutes'`;

  A(inline.length > 0 || queued.length > 0, 'the award woke at least one agent',
    [...inline.map((i) => `${i.agentRole}×${i.n}`), ...queued.map((q) => q.agentRole)].join(', ') || 'none');
  console.log(`  · ${toolCalls} tool:agent.invoked event(s) in the window`);
  console.log(`  · ${projectTriggers} workflow template(s) trigger on a project:* event`);
  if (projectTriggers === 0) {
    console.log('  · STATED GAP, not a failure: no workflow and no agent consumes the `project`');
    console.log('    namespace yet. Its events are emitted, bracketed and readable — the award side');
    console.log('    of the bridge is wired and the post-award side is not. Reported as a number so');
    console.log('    it cannot pass for coverage.');
  }

  // ══ 10 · isolation still holds after all of that ═══════════════════════════════════════════
  // ══ 11 · CLOSE-OUT — the end of the project's life, recorded ═══════════════════════════════
  //
  // Three refusals before it will close, because they are three different problems: a phase still
  // running, work added after a phase was met, and evidence the customer has not accepted. Then the
  // close-out itself, which is milestone completion one scale up — a note and metrics.
  phase('11 · HITL: close-out, and the three things that block it');

  const tooSoon = await api(req, 'patch', P, { action: 'close' });
  A(tooSoon.status === 409 && String((tooSoon.json as Json).code) === 'MILESTONES_OUTSTANDING',
    'a project with phases still running will not close',
    `${tooSoon.status} ${String((tooSoon.json as Json).code)}`);

  // Close the two remaining phases the way a person would.
  for (const m of chain.slice(1)) {
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM project_milestones
       WHERE project_id = ${created.projectId}::uuid AND title = ${m.title} LIMIT 1`;
    if (row) await api(req, 'patch', P + '/milestones', { action: 'met', milestoneId: row.id, note: `${m.title} complete.` });
  }
  const [{ pending }] = await sql<{ pending: number }[]>`
    SELECT count(*)::int AS pending FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid AND status = 'pending'`;
  A(pending === 0, 'every phase is met', `${pending} still pending`);

  // Work added AFTER a phase was met is the gap the milestone gate structurally cannot catch —
  // it ran before this task existed.
  const late = await api(req, 'post', P + '/tasks', { milestoneId: workPhase, title: 'Return government property' });
  A(late.status === 201, 'a task can be added after its phase closed', `${late.status}`);
  const lateId = ((late.json.data as Json)?.task as Json)?.id as string | undefined;
  const blockedByLate = await api(req, 'patch', P, { action: 'close' });
  A(blockedByLate.status === 409 && String((blockedByLate.json as Json).code) === 'TASKS_OUTSTANDING',
    'and it BLOCKS close-out — the milestone gate ran before it existed',
    `${blockedByLate.status} ${String((blockedByLate.json as Json).code)}`);
  if (lateId) await api(req, 'patch', P + `/tasks/${lateId}`, { status: 'done' });

  // ── STANDING WORK GATES CLOSE-OUT ─────────────────────────────────────────────────────────
  // The other half of the mig 221 scoping claim. The project-scope task raised in 7f never blocked
  // a milestone — every phase closed with it open — and it blocks the CONTRACT finishing. That is
  // the whole reason standing work is its own scope rather than a task filed under a phase.
  // A mitigation is standing work like any other, so it gates close-out like any other — which is
  // the whole reason it was made a real task instead of a field on the risk. Ticked here, by the
  // person it was given to.
  if (mitigTaskId) {
    const done = await asEmployee_((ctx) =>
      api(ctx.request, 'patch', P + `/tasks/${mitigTaskId}`, { status: 'done' }));
    A(done?.status === 200, 'the mitigation is worked and ticked off, like any other task',
      `${done?.status ?? 'no employee to be'}`);
  }

  const blockedByStanding = await api(req, 'patch', P, { action: 'close' });
  A(blockedByStanding.status === 409
    && /Keep the risk register current/.test(String((blockedByStanding.json as Json).error ?? '')),
    'standing work blocks CLOSE-OUT, having blocked no milestone — and the refusal names it',
    `${blockedByStanding.status} ${String((blockedByStanding.json as Json).code)}`);
  if (standingId) await api(req, 'patch', P + `/tasks/${standingId}`, { status: 'done' });

  const closeout = { invoicesPaid: 4, finalCost: 512000, propertyReturned: true };
  const shut = await api(req, 'patch', P, {
    action: 'close',
    note: 'Final invoice paid; government property returned and receipted.',
    metrics: closeout,
  });
  A(shut.status === 200, 'the project closes out', `${shut.status} ${shut.text.slice(0, 90)}`);

  const [pr] = await sql<{ status: string; closedAt: string | null; note: string | null; metrics: Record<string, unknown> | null }[]>`
    SELECT status, closed_at AS "closedAt", closeout_note AS note, closeout_metrics AS metrics
      FROM projects WHERE id = ${created.projectId}::uuid`;
  A(pr?.status === 'closed' && Boolean(pr?.closedAt),
    'the status and the stamp agree — the CHECK makes them inseparable', `${pr?.status} @ ${pr?.closedAt}`);
  A((pr?.metrics as { invoicesPaid?: number })?.invoicesPaid === 4,
    'the close-out metrics round-trip as an object', JSON.stringify(pr?.metrics));

  const twice = await api(req, 'patch', P, { action: 'close' });
  A(twice.status === 409 && String((twice.json as Json).code) === 'ALREADY_CLOSED',
    'closing twice is refused by compare-and-swap, not by a second stamp', `${twice.status}`);

  const [closedEv] = await sql<{ payload: Record<string, unknown> }[]>`
    SELECT payload FROM system_events
     WHERE namespace = 'project' AND type = 'project.closed' AND payload->>'projectId' = ${created.projectId}
     ORDER BY created_at DESC LIMIT 1`;
  A(Boolean(closedEv), '`project:project.closed` was emitted');
  if (closedEv) {
    const { describeEvent } = await import('../lib/event-labels.ts');
    const label = describeEvent({ namespace: 'project', type: 'project.closed', phase: 'single', payload: closedEv.payload } as never);
    A(label.startsWith('Project closed out') && !/\s{2,}/.test(label), 'and it reads as a sentence', label);
  }

  // Close-out REOPENS in the real world. The note is kept: it described what happened when it was
  // written, and the reopen is a correction to it, not a deletion of it.
  const reopened = await api(req, 'patch', P, { action: 'reopen', reason: 'Final invoice disputed by DFAS' });
  A(reopened.status === 200, 'a closed project can be reopened', `${reopened.status}`);
  const [pr2] = await sql<{ status: string; closedAt: string | null; note: string | null }[]>`
    SELECT status, closed_at AS "closedAt", closeout_note AS note FROM projects WHERE id = ${created.projectId}::uuid`;
  A(pr2?.status === 'active' && pr2?.closedAt === null, 'the stamp is cleared with the status', `${pr2?.status}`);
  A(typeof pr2?.note === 'string', 'and the close-out note is KEPT, not erased', String(pr2?.note).slice(0, 50));

  phase('10 · a second tenant sees none of it');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await login(page2, 'admin@immobileyes.test', TENANT_PW);
  const foreign = await api(ctx2.request, 'get', `/api/portal/immobileyes/projects`);
  const list = ((foreign.json.data as Json)?.projects ?? []) as Json[];
  A(foreign.status === 200, 'the other tenant can list its own projects', `${foreign.status}`);
  A(!list.some((p) => p.id === created.projectId), 'and ours is not among them', `${list.length} row(s)`);
  const direct = await api(ctx2.request, 'get', `/api/portal/immobileyes/projects/${created.projectId}`);
  A(direct.status === 404, 'naming our project id directly is refused', `${direct.status}`);
  await ctx2.close();

  await browser.close();
}

async function cleanup() {
  const footprint: string[] = [];
  if (KEEP) {
    console.log('\n  KEEP=1 — rows LEFT IN PLACE for probe-deliverable-artifacts.mts. Re-run without');
    console.log('  KEEP, or delete the project by hand, before treating this box as clean.');
    await sql.end();
    return;
  }
  try {
    // The authored deliverable documents. `project_deliverables.document_id` is ON DELETE SET NULL
    // by design — losing the draft must not delete the obligation — so deleting the project does
    // NOT take these with it, and a drive that made them and walked away leaves a tenant holding
    // documents for a project that no longer exists.
    if (created.documentIds.length) {
      await sql`DELETE FROM tenant_documents WHERE id = ANY(${created.documentIds}::uuid[])`;
      footprint.push(`${created.documentIds.length} authored document(s)`);
    }
    if (created.projectId) {
      await sql`DELETE FROM projects WHERE id = ${created.projectId}::uuid`;
      footprint.push('1 project + cascade');
    }
    if (created.contractId) {
      await sql`DELETE FROM tasks WHERE entity_id = ${created.contractId}::uuid AND task_type = 'project_setup'`;
      // Delete by the FK, not by the one id this run remembers. The award route UPSERTS one
      // contract per proposal, so a re-run against the same arc artifact reuses it — and any
      // project a PREVIOUS run left behind still points at it. Deleting only `created.projectId`
      // then hitting `projects_contract_id_fkey` is a cleanup that fails on its second run and
      // reports it as a broken link in the product.
      const orphans = await sql<{ id: string }[]>`
        DELETE FROM projects WHERE contract_id = ${created.contractId}::uuid RETURNING id`;
      if (orphans.length) footprint.push(`${orphans.length} project(s) still on the contract`);
      await sql`DELETE FROM contracts WHERE id = ${created.contractId}::uuid`;
      footprint.push('1 contract + its ToDo');
    }
    if (created.proposalId) {
      const children = await sql<{ child: string; col: string }[]>`
        SELECT c.conrelid::regclass::text AS child, a.attname AS col
          FROM pg_constraint c
          JOIN unnest(c.conkey) AS k(attnum) ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.contype = 'f' AND c.confrelid = 'proposals'::regclass AND array_length(c.conkey, 1) = 1`;
      for (const { child, col } of children) {
        await sql.unsafe(`DELETE FROM ${child} WHERE ${col} = $1`, [created.proposalId]).catch(() => {});
      }
      await sql`DELETE FROM proposals WHERE id = ${created.proposalId}::uuid`;
      footprint.push('1 scratch proposal + its children');
    }
  } catch (e) {
    console.error('  cleanup failed:', (e as Error)?.message ?? e);
  }
  console.log(`\n  MUTATED, then removed: ${footprint.join(' · ') || 'nothing'}`);
  console.log('  (process_instances, tasks history and system_events from this run are LEFT — they are');
  console.log('   the audit trail, and deleting an event to tidy up is the one thing this spine forbids.)');
  await sql.end();
}

main()
  .then(async () => {
    await cleanup();
    console.log();
    if (bad === 0) {
      console.log('✓ The whole chain holds: a person wins, the engine raises the gate, a person opens');
      console.log('  the project, the baseline freezes once, acceptance closes a milestone, and the');
      console.log('  variance survives into the record.');
    } else {
      console.error(`✗ ${bad} link(s) in the chain are broken.`);
    }
    process.exit(bad === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(`could not run: ${String((err as Error)?.message ?? err)}`);
    await cleanup().catch(() => {});
    process.exit(2);
  });
