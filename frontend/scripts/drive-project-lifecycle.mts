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
import { chromium, type Page, type APIRequestContext } from 'playwright';
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

const created: { proposalId?: string; projectId?: string; contractId?: string } = {};

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

  const parent = await api(req, 'post', P + '/wbs', {
    code: '1', title: 'Prototype development', clinId,
    plannedStart: iso(-30), plannedEnd: iso(120), plannedCost: 500000,
  });
  A(parent.status === 201 || parent.status === 200, 'a WBS parent is added', `${parent.status}`);
  const parentId = ((parent.json.data as Json)?.node as Json)?.id as string | undefined;
  const child = await api(req, 'post', P + '/wbs', {
    code: '1.1', title: 'Sensor integration', parentId,
    plannedStart: iso(-30), plannedEnd: iso(60), plannedCost: 250000,
  });
  A(child.status === 201 || child.status === 200, 'a child WBS node inherits its CLIN through the parent', `${child.status}`);

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

  const seq = await api(req, 'patch', P + '/milestones', { action: 'resequence' });
  A(seq.status === 200, 'the plan is sequenced', `${seq.status}`);
  const chain = await sql<{ title: string; startsOn: string | null; forecastDate: string | null }[]>`
    SELECT title, starts_on AS "startsOn", forecast_date AS "forecastDate"
      FROM project_milestones WHERE project_id = ${created.projectId}::uuid ORDER BY sort_index`;
  const d10 = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  A(d10(chain[1]?.startsOn) === iso(46), 'phase 2 starts the day after phase 1 ends',
    `${d10(chain[1]?.startsOn)} (phase 1 ends ${d10(chain[0]?.forecastDate)})`);
  A(d10(chain[2]?.startsOn) === iso(121), 'phase 3 starts the day after phase 2 ends', `${d10(chain[2]?.startsOn)}`);

  // A slip moves what FOLLOWS. That is what makes the dates serial rather than a list.
  const beforeSlip = chain.map((c) => d10(c.forecastDate));
  const slip = await api(req, 'patch', P + '/milestones', { action: 'reschedule', milestoneId: ms2id, forecastDate: iso(134) });
  A(slip.status === 200 && ((slip.json.data as Json)?.deltaDays as number) === 14,
    'phase 2 slips 14 days', `${slip.status} delta=${(slip.json.data as Json)?.deltaDays}`);
  const afterSlip = await sql<{ forecastDate: string | null; baselineDate: string | null }[]>`
    SELECT forecast_date AS "forecastDate", baseline_date AS "baselineDate"
      FROM project_milestones WHERE project_id = ${created.projectId}::uuid ORDER BY sort_index`;
  A(d10(afterSlip[2]?.forecastDate) === iso(194), 'phase 3 slips with it', `${beforeSlip[2]} → ${d10(afterSlip[2]?.forecastDate)}`);
  A(d10(afterSlip[0]?.forecastDate) === beforeSlip[0], 'the EARLIER phase does not move');

  // ── STAFFING: assignment is the access mechanism, so it comes before the work ──────────────
  // `/team` returns the roster as a BARE ARRAY under `data` — read the route, do not assume the
  // envelope's inner shape.
  const roster = await api(req, 'get', `/api/portal/${TENANT}/team`);
  const members = (Array.isArray(roster.json.data) ? roster.json.data : []) as Json[];
  const assignee = members.find((m) => String(m.role) === 'tenant_user' && m.id !== undefined) ?? members[0];
  A(roster.status === 200 && Boolean(assignee), 'the roster route offers someone to staff with',
    `${roster.status} · ${members.length} member(s)`);

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

  const [{ frozen }] = await sql<{ frozen: number }[]>`
    SELECT count(*)::int AS frozen FROM project_wbs_nodes
     WHERE project_id = ${created.projectId}::uuid AND baseline_start IS NOT NULL`;
  A(frozen === 2, 'every planned WBS node carries a frozen baseline', `${frozen}`);

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
  const [close] = await sql<{ wbs: string | null; ms: string | null }[]>`
    SELECT payload->>'wbsNodes' AS wbs, payload->>'milestones' AS ms FROM system_events
     WHERE namespace = 'project' AND type = 'baseline.set' AND phase = 'end'
       AND parent_event_id = ${start?.id ?? null}::uuid`;
  A(Boolean(close), 'and CLOSED it — a start with no end is B139, the class the spine audit exists for');
  const [{ msCount }] = await sql<{ msCount: number }[]>`
    SELECT count(*)::int AS "msCount" FROM project_milestones
     WHERE project_id = ${created.projectId}::uuid`;
  A(close?.wbs === '2' && close?.ms === String(msCount),
    'the end event carries what was frozen, not an empty object',
    close ? `wbsNodes=${close.wbs} milestones=${close.ms} (plan holds ${msCount})` : 'no end row');

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

  const [counts] = await sql<{ ms: number; done: number; tasks: number }[]>`
    SELECT (SELECT count(*)::int FROM project_milestones WHERE project_id = ${created.projectId}::uuid) AS ms,
           (SELECT count(*)::int FROM project_milestone_tasks
             WHERE project_id = ${created.projectId}::uuid AND status = 'done') AS done,
           (SELECT count(*)::int FROM project_milestone_tasks
             WHERE project_id = ${created.projectId}::uuid) AS tasks`;
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
  A(apiTasks.length === counts.tasks, 'the API returns the same task count the page rendered',
    `api=${apiTasks.length} db=${counts.tasks}`);
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
  try {
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
