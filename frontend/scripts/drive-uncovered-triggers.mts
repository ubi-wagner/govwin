/**
 * FIRE THE TRIGGERS THE AI_INVOKE CONTRACT LENS HAS NEVER SEEN — through their DOMAIN emitters.
 *
 * `pipeline/scripts/check_ai_invoke_contract.py` can only check an AI_INVOKE's input contract
 * against payloads it has actually observed. A trigger nobody has fired is UNMEASURED, and a
 * degraded AI_INVOKE safe-skips by design — so a broken input contract surfaces nowhere on its own.
 * That is the blind spot B84 lived in (the Studio silently dropping the tenant's voice).
 *
 * THE HARD RULE, restated because it is the whole point: fire each through the emitter the PRODUCT
 * uses, never through `POST /api/admin/workflows`. That launcher emits the operator's overlay AS
 * the payload, so the observed keys would be the ones I typed, and checking those against the
 * input_map is a tautology that converts every UNCOVERED into a false "covered".
 *
 * WHY THE EVENTS ARE LEFT BEHIND. Every other drive in this estate disposes what it made. This one
 * deliberately does not dispose its EVENTS, because the events are the coverage evidence — that is
 * B103: the scenario factory's teardown deletes tenant-scoped `system_events`, which is exactly why
 * `collaborator.invited` reads as "never fired" when three drives fire it every suite. Side effects
 * on business tables ARE undone; the audit rows stay, which is what audit rows are for.
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/drive-uncovered-triggers.mts
 */
import { randomUUID } from 'crypto';
import { sqlBypass as sql } from '@/lib/db';
import { solicitationRequestReviewTool } from '@/lib/tools/solicitation-request-review';
import { sourceScoutTool } from '@/lib/tools/source-scout';
import { BASE, launch, signIn } from './lib/cross-company.mts';

const TAG = randomUUID().slice(0, 8);
let ok = true;
const A = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok = ok && cond;
};
const note = (s: string) => console.log(`  · ${s}`);

/**
 * Did the trigger land, and does the payload carry the keys the workflow reads?
 *
 * PHASE IS PART OF THE QUESTION. A start/end pair carries DIFFERENT payloads — the start describes
 * the request, the end describes the result — and a workflow triggers on exactly one of them. This
 * helper first ignored phase and took the newest row, so the `application.accepted` check compared
 * the END event against the START event's keys and reported a missing contract that was never
 * missing: `OnApplicationAccepted` fires on `:end` and maps `result.tenantId` / `result.userId`,
 * both of which the end event carries. I had copied the key list from the wrong emit call — the
 * "copy the predicate from the source" rule, broken in the usual way: I copied from *a* source.
 */
async function landed(type: string, since: Date, wants: string[], phase = 'end') {
  const [ev] = await sql<Array<{ payload: Record<string, unknown>; tenantId: string | null }>>`
    SELECT payload, tenant_id AS "tenantId" FROM system_events
    WHERE type = ${type} AND phase = ${phase} AND created_at > ${since}
    ORDER BY created_at DESC LIMIT 1`;
  if (!ev) return { found: false, missing: wants };
  const missing = wants.filter((k) => ev.payload?.[k] === undefined || ev.payload?.[k] === null);
  return { found: true, missing, tenantId: ev.tenantId, keys: Object.keys(ev.payload ?? {}) };
}

const t0 = new Date();
const [platformAdmin] = await sql<Array<{ id: string; email: string }>>`
  SELECT id, email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active
  ORDER BY created_at LIMIT 1`;
const adminId = platformAdmin?.id ?? '';
const adminEmail = platformAdmin?.email ?? '';

const browser = await launch();
try {
  // ── 1 · proposal:collaborator.invited ─────────────────────────────────────────────────────────
  //
  // Fired against a LONG-LIVED company on purpose. Three suite drives already fire this every run,
  // but they build a company and dispose it, and the disposal takes the tenant-scoped event with
  // it — so the lens has never seen one. See B103.
  console.log('\n── 1 · proposal:collaborator.invited (a long-lived company, so the event survives) ──');
  const [host] = await sql<Array<{ slug: string; email: string; proposalId: string }>>`
    SELECT t.slug, u.email, p.id AS "proposalId"
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.is_active AND u.role = 'tenant_admin'
    JOIN proposals p ON p.tenant_id = t.id AND p.archived_at IS NULL
    WHERE t.archived_at IS NULL AND t.slug NOT LIKE 'scenario-%'
    ORDER BY t.created_at LIMIT 1`;
  if (!host) {
    A('a long-lived company with a proposal exists to invite into', false, 'none found');
  } else {
    note(`host = ${host.slug} · proposal ${host.proposalId.slice(0, 8)}…`);
    const bc = await signIn(browser, host.email, process.env.TENANT_PW || 'DemoPass123!');
    const invitee = `trigger.probe.${TAG}@ext.test`;
    const r = await bc.request.post(
      `${BASE}/api/portal/${host.slug}/proposals/${host.proposalId}/collaborators`,
      { data: { email: invitee, name: `trigger probe ${TAG}`, role: 'external', permission: 'view' } });
    A(`the collaborators route accepted the invite (${r.status()})`, r.status() < 300,
      r.status() >= 300 ? (await r.text()).slice(0, 120) : '');
    await bc.close();
    const l = await landed('collaborator.invited', t0, ['email', 'name', 'proposalId', 'role', 'tenantId'], 'end');
    A('collaborator.invited landed with every key OnCollaboratorInvited reads',
      l.found && l.missing.length === 0, l.found ? `missing: ${l.missing.join(',') || 'none'}` : 'no event');
    // Undo the ACCESS (a real grant on a real company); the audit event stays.
    await sql`UPDATE proposal_collaborators SET revoked_at = now()
              WHERE user_id IN (SELECT id FROM users WHERE email = ${invitee})`;
    note('collaborator access revoked — the audit event is left, deliberately');
  }

  // ── 2 · finder:solicitation.review_requested ──────────────────────────────────────────────────
  console.log('\n── 2 · finder:solicitation.review_requested (the curation tool) ──');
  // The title lives on `opportunities`, not on the curated row — joined rather than assumed.
  const [sol] = await sql<Array<{ id: string; title: string; status: string }>>`
    SELECT cs.id, o.title, cs.status FROM curated_solicitations cs
    JOIN opportunities o ON o.id = cs.opportunity_id
    WHERE cs.status = 'curation_in_progress' ORDER BY cs.updated_at DESC LIMIT 1`;
  const [anySol] = await sql<Array<{ id: string; title: string; status: string }>>`
    SELECT cs.id, o.title, cs.status FROM curated_solicitations cs
    JOIN opportunities o ON o.id = cs.opportunity_id ORDER BY cs.updated_at DESC LIMIT 1`;
  const target = sol ?? anySol;
  const [admin] = await sql<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE role IN ('rfp_admin','master_admin') AND is_active ORDER BY created_at LIMIT 1`;
  if (!target || !admin) {
    A('a solicitation and an admin exist', false, 'missing fixture');
  } else {
    const priorStatus = target.status;
    if (priorStatus !== 'curation_in_progress') {
      await sql`UPDATE curated_solicitations SET status = 'curation_in_progress' WHERE id = ${target.id}::uuid`;
      note(`moved "${target.title.slice(0, 40)}" ${priorStatus} → curation_in_progress (setup)`);
    }
    const res = await solicitationRequestReviewTool.handler(
      { solicitationId: target.id, notes: `AI_INVOKE coverage probe ${TAG}` },
      { actor: { type: 'user', id: admin.id, email: admin.email }, tenantId: null,
        requestId: randomUUID(), log: console as never });
    A('the request-review tool ran', !!res, JSON.stringify(res).slice(0, 90));
    const l = await landed('solicitation.review_requested', t0, ['solicitationId'], 'single');
    A('solicitation.review_requested landed with solicitationId',
      l.found && l.missing.length === 0, l.found ? `keys: ${l.keys?.join(',')}` : 'no event');
    await sql`UPDATE curated_solicitations SET status = ${priorStatus} WHERE id = ${target.id}::uuid`;
    note(`solicitation status restored to ${priorStatus} — the audit event is left`);
  }

  // ── 3 · capture:application.accepted ──────────────────────────────────────────────────────────
  //
  // Accepting an application CREATES a company — a real, heavy side effect. The event itself is
  // platform-scope (`tenantId: null`, route line 97), so it survives the company being purged
  // afterwards. That ordering is what makes this safe to fire on a shared box.
  console.log('\n── 3 · capture:application.accepted (the admin accept route) ──');
  const [app] = await sql<Array<{ id: string }>>`
    INSERT INTO applications (contact_email, contact_name, company_name, tech_summary, terms_accepted_at, status)
    VALUES (${`applicant.${TAG}@probe.test`}, ${`Probe Applicant ${TAG}`}, ${`Trigger Probe Co ${TAG}`},
            'AI_INVOKE coverage probe — accepted then purged.', now(), 'pending')
    RETURNING id`;
  note(`staged application ${app.id.slice(0, 8)}… (setup)`);
  const adminBc = await signIn(browser, adminEmail, process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
  const accept = await adminBc.request.post(`${BASE}/api/admin/applications/${app.id}/accept`, { data: {} });
  A(`the accept route accepted (${accept.status()})`, accept.status() < 300,
    accept.status() >= 300 ? (await accept.text()).slice(0, 140) : '');
  await adminBc.close();
  // OnApplicationAccepted fires on the :end phase, conditions on payload.tenantId being present,
  // and maps result.tenantId + result.userId. Those are the keys that matter — read from the
  // workflow definition, not from whichever emit call happened to be easiest to grep.
  const la = await landed('application.accepted', t0, ['tenantId', 'userId']);
  A('application.accepted:end landed with the keys OnApplicationAccepted maps',
    la.found && la.missing.length === 0, la.found ? `keys: ${la.keys?.join(',')}` : 'no end event');
  const laStart = await landed('application.accepted', t0, ['applicationId', 'companyName', 'contactEmail'], 'start');
  A('  → and the :start phase carries the request detail',
    laStart.found && laStart.missing.length === 0,
    laStart.found ? `keys: ${laStart.keys?.join(',')}` : 'no start event');
  // Purge the company the accept created — the platform-scope event is untouched by this.
  const [made] = await sql<Array<{ id: string; slug: string }>>`
    SELECT id, slug FROM tenants WHERE name = ${`Trigger Probe Co ${TAG}`} LIMIT 1`;
  if (made) {
    const { scenario } = await import('./lib/scenario.mts');
    const s = await scenario('trigger-probe-cleanup');
    s.trackTenantPurge(`accepted company ${made.slug}`, made.id);
    await s.dispose();
    note(`purged the company the accept created (${made.slug}) — the platform event stays`);
  }
  await sql`DELETE FROM applications WHERE id = ${app.id}::uuid`;

  // ── 4 · finder:source.change_detected ─────────────────────────────────────────────────────────
  //
  // Only fires when the crawl finds a MEANINGFUL change, so the condition has to be made true
  // rather than faked. Setup seeds the PRIOR snapshot ("we saw this page yesterday"); the fetch,
  // the diff, the meaningfulness judgement and the emit are all the real code path.
  console.log('\n── 4 · finder:source.change_detected (a real crawl against a real diff) ──');
  const [prof] = await sql<Array<{ id: string }>>`
    INSERT INTO source_profiles (name, base_url, is_active, created_by)
    VALUES (${`Trigger Probe Source ${TAG}`}, ${BASE}, true, ${adminId}::uuid)
    RETURNING id`;
  const [region] = await sql<Array<{ id: string }>>`
    INSERT INTO source_regions (profile_id, name, region_type, is_active)
    VALUES (${prof.id}::uuid, 'whole page', 'content', true) RETURNING id`;
  await sql`
    INSERT INTO source_snapshots (profile_id, region_id, content_hash, content_text, captured_at)
    VALUES (${prof.id}::uuid, ${region.id}::uuid, ${'probe-prior-' + TAG},
            'PRIOR STATE: this page previously announced no open solicitations whatsoever.', now() - interval '1 day')`;
  note('seeded the PRIOR snapshot — the crawl below is entirely the real path');
  const scoutRes = await sourceScoutTool.handler(
    { sourceId: prof.id },
    { actor: { type: 'user', id: adminId, email: adminEmail }, tenantId: null,
      requestId: randomUUID(), log: console as never });
  note(`scout: ${JSON.stringify(scoutRes).slice(0, 150)}`);
  const ls = await landed('source.change_detected', t0, ['meaningfulChanges', 'sourceName'], 'single');
  A('source.change_detected landed with every key OnSourceChangeDetected reads',
    ls.found && ls.missing.length === 0,
    ls.found ? `missing: ${ls.missing.join(',') || 'none'}` : 'no event — the crawl found no MEANINGFUL change');
  // Diffs reference the snapshots, so they go first — the crawl writes both.
  await sql`DELETE FROM source_diffs WHERE profile_id = ${prof.id}::uuid`;
  await sql`DELETE FROM source_snapshots WHERE profile_id = ${prof.id}::uuid`;
  await sql`DELETE FROM source_regions WHERE profile_id = ${prof.id}::uuid`;
  await sql`DELETE FROM source_profiles WHERE id = ${prof.id}::uuid`;
  note('probe source removed — the audit event is left');

  console.log(`\n${ok ? '✓ every trigger fired here landed with its full contract'
    : '✗ see failures above'}\n`);
} catch (e) {
  console.error('DRIVE ERROR', e);
  ok = false;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
  process.exit(ok ? 0 : 1);
}
