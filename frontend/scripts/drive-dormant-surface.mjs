#!/usr/bin/env node
/**
 * drive-dormant-surface.mjs — wake the automation surface that has never run, through the product.
 *
 * WHY. The spine audit proved every workflow CAN fire and every step resolves. It could not prove
 * any of them DOES, and a large part of the platform had never executed on this box: 15 archetypes
 * wired to a workflow but never invoked, 267 (namespace,type,phase) combinations never emitted, 66
 * bracketed operations whose `end` nothing consumes. "Never run" is not "works" — a step can
 * resolve, register, validate, and still throw the first time real data reaches it.
 *
 * HOW, and this is the whole point: through the product's own front door, as a real signed-in
 * rfp_admin. `POST /api/admin/workflows { workflowName, overlay, tenantId }` is the generic launcher
 * the admin UI uses — it reads `process_templates.trigger_key`, refuses anything that is not
 * `phase='single'`, and emits the trigger event that the running worker then picks up. No event is
 * inserted by hand, no instance is fabricated, no status is set directly. If a workflow will not run
 * for a real operator, it does not run here either, and that refusal is the finding.
 *
 * The template list is fetched, never hardcoded — the same lesson as B140, where a source-literal
 * scan against a dynamically-served roster reported thirteen working workflows as invisible.
 *
 * WHAT A FAILURE MEANS HERE. A workflow that refuses with the product's own `{error, code}` is
 * reported as REFUSED, not as broken: `NOT_LAUNCHABLE` on a reactive template is correct behaviour.
 * A workflow that launches and then fails mid-instance is the interesting result — that is a defect
 * only execution can find.
 *
 *   node scripts/drive-dormant-surface.mjs            # launch everything launchable
 *   node scripts/drive-dormant-surface.mjs --dry      # show the plan and the overlays, launch nothing
 *
 * ⚠️ NOT read-only: it starts real workflow instances and whatever they do. Sandbox only; take a
 * pg_dump first.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import postgres from 'postgres';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB = process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const ADMIN = process.env.RFP_ADMIN_EMAIL || 'eric@rfppipeline.com';
const ADMIN_PW = process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || '';
const DRY = process.argv.includes('--dry');

const sql = postgres(DB, { max: 3, transform: { column: { from: (c) => c } } });

/** What has EVER run here, before this drive touches anything. */
async function snapshot() {
  const [{ archetypes }] = await sql`
    SELECT coalesce(json_agg(DISTINCT payload->>'archetype'), '[]') AS archetypes
    FROM system_events WHERE payload ? 'archetype' AND payload->>'archetype' IS NOT NULL`;
  const types = await sql`SELECT DISTINCT namespace, type, phase FROM system_events`;
  const [{ instances }] = await sql`SELECT count(*)::int AS instances FROM process_instances`;
  return {
    archetypes: new Set(archetypes),
    types: new Set(types.map((t) => `${t.namespace}:${t.type}:${t.phase}`)),
    instances,
  };
}

/**
 * Overlay values taken from LIVE rows, not invented.
 *
 * A workflow's `input_map` reads `payload.<field>`, so the launcher's overlay has to carry fields
 * that name something real — a fabricated uuid produces an instance scoped to nothing, which is the
 * "corrupt gate" `launchProjectCollaboration` exists to refuse. One generous overlay covering every
 * field any template reads is correct here: each workflow picks the keys it declared and ignores
 * the rest, and building 20 bespoke overlays would be 20 chances to guess a field name wrong.
 */
async function liveOverlay() {
  // ONE TENANT, AND EVERYTHING ELSE DERIVED FROM IT.
  //
  // The first version took the OLDEST tenant and the NEWEST proposal independently. Both were real
  // rows — the comment above was true — and they belonged to different tenants. Passing
  // `tenantId=foundation` with `overlay.proposalId=<immobileyes' proposal>` scoped every instance to
  // one tenant while pointing it at another's work, and 18 `agent_task_log` rows crossed the
  // boundary before the copy-inward invariant checker caught them.
  //
  // Real ids that do not belong together are WORSE than fabricated ones: a fabricated uuid fails
  // the first existence check, and this passed every one of them.
  const [tenant] = await sql`
    SELECT t.id, t.slug, t.name FROM tenants t
    WHERE t.archived_at IS NULL AND EXISTS (SELECT 1 FROM proposals p WHERE p.tenant_id = t.id)
    ORDER BY t.created_at LIMIT 1`;
  const [proposal] = await sql`
    SELECT id, tenant_id, title, opportunity_id FROM proposals
    WHERE tenant_id = ${tenant?.id ?? null} ORDER BY created_at DESC LIMIT 1`;
  // `curated_solicitations` has no `title` — it is `solicitation_title`. Column names read off the
  // live catalogue via scripts/schema-check.mjs rather than assumed from the sibling tables.
  const [sol] = await sql`SELECT id, solicitation_title FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`;
  const [opp] = await sql`SELECT id, title FROM opportunities WHERE is_active ORDER BY created_at DESC LIMIT 1`;
  const [section] = await sql`
    SELECT id, proposal_id FROM proposal_sections
    WHERE proposal_id = ${proposal?.id ?? null} ORDER BY created_at DESC LIMIT 1`;
  const [user] = await sql`SELECT id, email FROM users WHERE role = 'rfp_admin' OR role = 'master_admin' ORDER BY created_at LIMIT 1`;
  return {
    tenantId: tenant?.id ?? null,
    tenantSlug: tenant?.slug ?? null,
    proposalId: proposal?.id ?? null,
    opportunityId: proposal?.opportunity_id ?? opp?.id ?? null,
    solicitationId: sol?.id ?? null,
    sectionId: section?.id ?? null,
    userId: user?.id ?? null,
    // ProjectCollaboration's launcher refuses an incomplete overlay by design; give it a complete one.
    taskType: 'admin_approval',
    taskTitle: 'Dormant-surface drive',
    assigneeRole: 'rfp_admin',
    entityType: 'proposal',
    entityRef: proposal?.id ?? null,
    // Fields various NOTIFY/AI steps read.
    scope: 'proposal',
    reason: 'dormant-surface drive',
    nudgeDays: [1, 3],
  };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
try {
  // ── sign in as a real actor ────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', ADMIN);
  await page.fill('input[type="password"]', ADMIN_PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  if (new URL(page.url()).pathname.startsWith('/login')) {
    console.log(`✗ could not sign in as ${ADMIN} — check RFP_ADMIN_PW / run scripts/sandbox-reset-passwords.mjs`);
    process.exit(2);
  }
  console.log(`signed in as ${ADMIN}\n`);

  // ── enumerate what the product says is launchable ──────────────────────────
  const tRes = await page.request.get(`${BASE}/api/admin/workflows/templates`);
  const tBody = await tRes.json();
  // `{ data: { templates } }` — nested, not `{ data: [...] }`. Caught by the --dry run before a
  // single workflow was launched, which is the entire reason the dry mode exists.
  const templates = tBody?.data?.templates ?? tBody?.templates ?? [];
  if (!Array.isArray(templates) || !templates.length) {
    console.log('✗ templates endpoint returned nothing — cannot enumerate'); process.exit(2);
  }
  const launchable = templates.filter((t) => String(t.triggerKey ?? t.trigger_key ?? '').endsWith(':single'));
  console.log(`${templates.length} templates · ${launchable.length} single-phase (launchable by overlay)\n`);

  const before = await snapshot();
  const overlay = await liveOverlay();
  console.log('overlay built from live rows:');
  for (const [k, v] of Object.entries(overlay)) console.log(`  ${k.padEnd(16)} ${JSON.stringify(v)}`);
  console.log();

  if (DRY) {
    for (const t of launchable) console.log(`  would launch ${t.workflowName ?? t.workflow_name}`);
    await sql.end(); await browser.close(); process.exit(0);
  }

  // ── launch each, through the product ───────────────────────────────────────
  const results = [];
  for (const t of launchable) {
    const name = t.workflowName ?? t.workflow_name;
    const res = await page.request.post(`${BASE}/api/admin/workflows`, {
      data: { workflowName: name, overlay, tenantId: overlay.tenantId },
    });
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON */ }
    const ok = res.status() === 200 && body?.data;
    results.push({ name, status: res.status(), ok, code: body?.code ?? null, error: body?.error ?? null });
    console.log(`  ${ok ? '✓' : '·'} ${String(name).padEnd(32)} ${res.status()} ${body?.code ?? ''} ${ok ? '' : (body?.error ?? '')}`);
  }

  // ── let the worker drain, then measure ─────────────────────────────────────
  // Polling the instance table, not sleeping a fixed time: the worker's poll interval is its own
  // business and a fixed wait either wastes minutes or measures a half-finished run.
  // ZERO PENDING AT t=0 MEANS "HAS NOT STARTED", NOT "FINISHED".
  //
  // The first version polled for `pending/running == 0` and exited on the first check — before the
  // worker's poll interval had even elapsed — then reported "0 new instances" for a launch that
  // went on to create thirteen of them seconds later. It is the same shape as waiting on a build by
  // checking whether the output file is missing.
  //
  // So: wait for the work to APPEAR first, and only then for it to drain.
  console.log('\nwaiting for the worker to pick the events up…');
  let appeared = false;
  for (let i = 0; i < 45; i += 1) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM process_instances`;
    if (n > before.instances) { appeared = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(appeared ? '  picked up' : '  ⚠ no instance appeared in 90s — the worker may be down');
  let settled = false;
  for (let i = 0; i < 60; i += 1) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM process_instances WHERE status IN ('pending','running')`;
    if (n === 0) { settled = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(settled ? '  drained' : '  ⚠ still busy after 120s — measuring anyway');

  /**
   * PHASE 2 · walk through the human gates, because that is where the rest of the surface lives.
   *
   * `OnOpportunitiesDetected` and `ProjectCollaboration` both PAUSE on a TODO step — correctly, they
   * are human gates. But the AI steps sit AFTER the gate, so launching the workflow can never reach
   * them: `opportunity_analyst` stayed dormant not because anything is broken but because nobody had
   * clicked the button. Completing the ToDo through `POST /api/admin/tasks` — the same route the
   * admin ToDo list posts to — resumes the instance from the next step.
   *
   * This also proves the resume path itself, which nothing else here does: a paused instance that
   * never comes back is indistinguishable from a completed one in any count of instances.
   */
  const gates = await sql`
    SELECT t.id, t.title, t.task_type FROM tasks t
    WHERE t.status = 'open' AND t.created_at > now() - interval '20 minutes'
      AND t.assignee_role IN ('rfp_admin', 'master_admin')
    ORDER BY t.created_at DESC LIMIT 12`;
  console.log(`\n══ human gates opened by this drive (${gates.length}) — completing each as the admin ══`);
  for (const g of gates) {
    const res = await page.request.post(`${BASE}/api/admin/tasks`, {
      data: { taskId: g.id, result: { via: 'dormant-surface drive' } },
    });
    let b = {};
    try { b = await res.json(); } catch { /* non-JSON */ }
    console.log(`   ${res.status() === 200 ? '✓' : '·'} ${String(g.title).slice(0, 40).padEnd(42)} ${res.status()} ${b?.code ?? ''}`);
  }
  if (gates.length) {
    console.log('   waiting for the resumed instances to drain…');
    for (let i = 0; i < 45; i += 1) {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM process_instances WHERE status IN ('pending','running')`;
      if (n === 0 && i > 2) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const after = await snapshot();
  const newArchetypes = [...after.archetypes].filter((a) => !before.archetypes.has(a)).sort();
  const newTypes = [...after.types].filter((t) => !before.types.has(t)).sort();

  const launched = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  console.log(`\n══ launched ══`);
  console.log(`   ${launched.length} of ${launchable.length} accepted · ${after.instances - before.instances} new instance(s)`);
  console.log(`\n══ refused (the product's own answer, not a harness failure) ══`);
  for (const r of refused) console.log(`   · ${String(r.name).padEnd(32)} ${r.status} ${r.code ?? ''} — ${r.error ?? ''}`);

  console.log(`\n══ archetypes that had never run and now have (${newArchetypes.length}) ══`);
  for (const a of newArchetypes) console.log(`   · ${a}`);
  console.log(`\n══ event types fired for the first time (${newTypes.length}) ══`);
  for (const t of newTypes) console.log(`   · ${t}`);

  // Instances that failed are the finding execution exists to surface.
  const paused = await sql`
    SELECT workflow_name FROM process_instances
    WHERE status = 'paused' AND started_at > now() - interval '10 minutes'`;
  console.log(`\n══ parked at a human gate (${paused.length}) — correct, not a failure ══`);
  for (const p of paused) console.log(`   · ${p.workflow_name}`);
  const failures = await sql`
    SELECT workflow_name, status, last_error, last_error_step
    FROM process_instances
    WHERE status = 'failed' AND started_at > now() - interval '10 minutes'
    ORDER BY started_at DESC`;
  console.log(`\n══ instances that FAILED during this drive (${failures.length}) ══`);
  for (const f of failures) {
    console.log(`   · ${f.workflow_name} @ ${f.last_error_step ?? '?'} — ${String(f.last_error ?? '').slice(0, 160)}`);
  }

  fs.writeFileSync('/home/user/govwin/docs/dormant-surface-drive.json', JSON.stringify({
    launchable: launchable.length, launched: launched.length,
    refused, newArchetypes, newTypes,
    failures: failures.map((f) => ({ workflow: f.workflow_name, step: f.last_error_step, error: f.last_error })),
  }, null, 1));
  console.log('\nwrote docs/dormant-surface-drive.json');
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await sql.end();
  await browser.close();
}
