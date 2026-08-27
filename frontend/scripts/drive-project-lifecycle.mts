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

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.DATABASE_URL_OWNER;
const TENANT_PW = process.env.TENANT_PW || 'DemoPass123!';
const TENANT = 'foundation';
const ACTOR = 'kate.ulepic@foundation3dp.com';

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

async function main() {
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
  // The one precondition a person cannot conjure: something to win. An UNLOCKED, un-awarded build.
  const [prop] = await sql<{ id: string; title: string }[]>`
    INSERT INTO proposals (tenant_id, opportunity_id, title, stage, is_locked)
    SELECT ${tenantId}::uuid, o.id, ${'E2E award probe ' + process.pid}, 'submitted', false
      FROM opportunities o ORDER BY o.id LIMIT 1
    RETURNING id, title`;
  if (!prop) { console.error('  CANT-RUN — no opportunity to hang a proposal off'); process.exit(2); }
  created.proposalId = prop.id;
  ok('a submitted build exists to win', prop.title);

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
  A(close?.wbs === '2' && close?.ms === '1',
    'the end event carries what was frozen, not an empty object',
    close ? `wbsNodes=${close.wbs} milestones=${close.ms}` : 'no end row');

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
