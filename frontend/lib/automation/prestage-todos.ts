/**
 * preStageProposalReviewTodos — #190 Phase C3 (docs/AUTOMATION_POLICY_DESIGN.md §13).
 *
 * At provision the section_drafter agent drafts a V0 for every section
 * (proposal.created → draft_v0). So the human's job is to REVIEW, not to write from
 * scratch. This pre-stages the review gate ToDos — parameterized by the tenant's
 * automation policy (assignee / nudge cadence / due) — so they already exist and nudge
 * on schedule BEFORE the human opens the portal. This is the "agents do most, humans
 * review — including an agent-assisted final review" model.
 *
 * Agent-first aware: when the portal's guardrail_config has `agentFirst`, the ToDo
 * copy reflects "review the AI draft / confirm the AI review" rather than "write it".
 *
 * Non-fatal by design: a failure here never breaks provisioning (best-effort, like the
 * drafter itself). The gates resolve through the policy layer, so an un-configured
 * tenant gets the sensible defaults below.
 */
import { sql } from '@/lib/db';
import { resolveGatePolicy } from '@/lib/automation/policy';
import { emitEventSingle } from '@/lib/events';
import { createLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';

const log = createLogger('prestage-todos');
type JsonArg = Parameters<typeof sql.json>[0];

interface GateSpec {
  triggerKey: string;
  stage: 'draft' | 'final';
  agentAssisted: (agentFirst: boolean) => boolean;
  gateDefaults: { assigneeRole: string; nudgeDays: number[]; dueInMinutes: number };
  title: (agentFirst: boolean) => string;
  description: (agentFirst: boolean) => string;
}

// The two review gates the lifecycle stages (draft → final) hang off. Each is
// policy-resolved so a tenant can tune who/when/how it nudges.
const REVIEW_GATES: GateSpec[] = [
  {
    triggerKey: 'section_review',
    stage: 'draft',
    agentAssisted: (af) => af,
    gateDefaults: { assigneeRole: 'tenant_admin', nudgeDays: [3, 1], dueInMinutes: 10080 }, // 7 days
    title: (af) => (af ? 'Review the AI-drafted sections' : 'Complete & review the draft sections'),
    description: (af) =>
      af
        ? 'The section drafter produced a V0 for each required section. Review, edit, and accept & lock each one.'
        : 'Draft, review, and accept & lock each required section.',
  },
  {
    triggerKey: 'final_review',
    stage: 'final',
    agentAssisted: () => true, // the final review is always agent-assisted
    gateDefaults: { assigneeRole: 'tenant_admin', nudgeDays: [3, 1], dueInMinutes: 20160 }, // 14 days
    title: () => 'Final review — confirm the AI compliance + color-team pass',
    description: () =>
      'AI compliance + color-team reviewers make a pass and post recommendations into each section. Confirm, resolve, and advance to submission.',
  },
];

export async function preStageProposalReviewTodos(opts: {
  tenantId: string;
  proposalId: string;
  opportunityId: string;
  label: string;
  actorId: string;
  actorEmail?: string | null;
}): Promise<{ created: number; agentFirst: boolean }> {
  const { tenantId, proposalId, opportunityId, label, actorId, actorEmail } = opts;

  // Read the portal's agent-first choice (guardrail_config). Default false on any miss.
  let agentFirst = false;
  try {
    const [row] = await sql<{ guardrailConfig: Record<string, unknown> | null }[]>`
      SELECT guardrail_config AS "guardrailConfig" FROM proposal_portals
      WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid AND label = ${label}
    `;
    agentFirst = !!(row?.guardrailConfig && (row.guardrailConfig as Record<string, unknown>).agentFirst);
  } catch (e) {
    log.warn?.({ msg: 'guardrail_config read failed — agentFirst defaults false', err: e instanceof Error ? e.message : String(e) });
  }

  let created = 0;
  for (const g of REVIEW_GATES) {
    try {
      const pol = await resolveGatePolicy({ tenantId, scope: 'build', triggerKey: g.triggerKey, gateDefaults: g.gateDefaults });
      if (!pol.enabled) continue; // safe-skip a disabled gate
      const params = {
        kind: 'review',
        stage: g.stage,
        agentAssisted: g.agentAssisted(agentFirst),
        prestaged: true,
        opportunityId,
        triggerKey: g.triggerKey,
      };
      await sql`
        INSERT INTO tasks
          (tenant_id, assignee_role, task_type, title, description, status, entity_type, entity_id, due_at, nudge_schedule, params)
        VALUES (
          ${tenantId}::uuid, ${pol.assigneeRole}, 'review', ${g.title(agentFirst)}, ${g.description(agentFirst)}, 'open',
          'proposal', ${proposalId}::uuid,
          now() + (${pol.dueInMinutes}::text || ' minutes')::interval,
          ${sql.json(pol.nudgeDays as JsonArg)},
          ${sql.json(params as JsonArg)}
        )
      `;
      created++;
    } catch (e) {
      log.warn?.({ msg: 'prestage review todo failed (non-fatal)', triggerKey: g.triggerKey, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (created > 0) {
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'review_todos.prestaged',
        actor: { type: 'user', id: actorId, email: actorEmail ?? undefined },
        tenantId,
        payload: { correlationId: randomUUID(), proposalId, opportunityId, count: created, agentFirst },
      });
    } catch { /* best-effort — the ToDos are the source of truth, the event is audit */ }
  }

  return { created, agentFirst };
}
