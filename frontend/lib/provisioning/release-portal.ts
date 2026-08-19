/**
 * Provision + release a PURCHASED portal from curation — the shared discovery→build hand-off.
 *
 * ONE source of truth for the two live callers (docs/PROVISIONING_WORKSPACE_DESIGN.md):
 *   • the tenant-side rfp-admin release — POST /api/portal/[slug]/portals/[id]?action=release
 *   • the admin cockpit's "Complete & Release" — POST /api/admin/provisioning/[portalId]/release (PV-3)
 * Both provision the build BEFORE flipping curation_pending → launched, so a hand-off failure
 * leaves the workspace awaiting-curation (retryable by re-release), never a wedged buildless launch
 * (adversarial-sweep B2). Idempotent: the proposal is linked to the portal BEFORE the flip, so a
 * retry sees proposal_id already set and skips re-provisioning (no duplicate proposal).
 *
 * All writes self-scope to the PURCHASER's tenant via the helpers' own withTenant(tenantId, …) /
 * provisionProposalForPortal, so an rfp_admin acting cross-tenant from the cockpit lands them in the
 * correct RLS context (the admin is the ACTOR; the tenant is the subject).
 */
import { withTenant } from '@/lib/rls';
import { runInTenant } from '@/lib/tenant-context';
import { provisionProposalForPortal } from '@/lib/provision-proposal';
import { linkPortalProposal, releaseFromCuration } from '@/lib/portal-launch';
import { getGuardrailLimits, validateGuardrailConfig, instantiatePortalWorkflow, type GuardrailConfig } from '@/lib/portal-workflow';
import { createTask } from '@/lib/tasks/tasks';
import { emitEventSingle } from '@/lib/events';
import { replayConfirmedAmendments } from '@/lib/amendments';
import type { Role } from '@/lib/rbac';
import { randomUUID } from 'crypto';

/** Minimal single-operator guardrails (no collaborators/nudges — the customer just builds) when the
 *  caller chooses no overlay. Passes the guardrail limits. */
export const DEFAULT_RELEASE_GUARDRAILS = {
  nudgeDays: [],
  collaborators: [],
  stages: [
    { key: 'draft', label: 'Draft', todos: [] },
    { key: 'review', label: 'Review', todos: [] },
    { key: 'final', label: 'Final', todos: [] },
  ],
} as unknown as GuardrailConfig;

export interface ReleaseActor { id: string; email: string | null; role: Role }

export type ReleasePortalResult =
  | { ok: true; proposalId: string; tasksCreated: number }
  | { ok: false; error: string; code: string; status: number };

export async function provisionAndReleasePortal(opts: {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  portalId: string;
  actor: ReleaseActor;
  guardrailConfig?: GuardrailConfig;
}): Promise<ReleasePortalResult> {
  const { tenantId, tenantName, tenantSlug, portalId, actor } = opts;
  // Shallow-clone so we never mutate the shared DEFAULT_RELEASE_GUARDRAILS const. The tenant must
  // COMPLETE + Accept the workflow once (recommend-but-require, TW-3): mark it pending — the portal
  // runs on these defaults (momentum) until the tenant's Accept & Start installs their tuned config.
  const config = { ...(opts.guardrailConfig ?? DEFAULT_RELEASE_GUARDRAILS) } as GuardrailConfig;
  config._setup = { status: 'pending' };

  // Enforce the RFP-admin guardrail limits (max 3 stages, 10 collaborators, 1 manager, 3 nudges).
  const limits = await getGuardrailLimits();
  const v = validateGuardrailConfig(config, limits);
  if (!v.ok) return { ok: false, error: v.errors.join('; '), code: 'GUARDRAIL_LIMIT', status: 422 };

  // Provision + link the build BEFORE the flip. The purchased card's opportunity_id is all
  // provisioning needs; provisionProposalForPortal degrades to a default volume with no matrix.
  const [portalRow] = await withTenant(tenantId, async (tx) =>
    tx<Array<{ opportunityId: string; proposalId: string | null; label: string }>>`
      SELECT opportunity_id AS "opportunityId", proposal_id AS "proposalId", label
      FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`,
  );
  if (!portalRow) return { ok: false, error: 'portal not found', code: 'NOT_FOUND', status: 404 };

  let proposalId = portalRow.proposalId;
  if (!proposalId) {
    const prov = await provisionProposalForPortal({
      tenantId, tenantName, tenantSlug,
      opportunityId: portalRow.opportunityId, label: portalRow.label,
      actorId: actor.id, actorEmail: actor.email,
    });
    if ('error' in prov) {
      return { ok: false, error: `Could not provision the build (please retry): ${prov.error}`, code: 'PROVISION_FAILED', status: 500 };
    }
    // linkPortalProposal CAS-links only while proposal_id IS NULL. If it returns false a CONCURRENT
    // release (admin cockpit + tenant ?action=release, or a double-click) already provisioned + linked
    // this portal — adopt the WINNER's proposal so we don't double-link / drive the wrong build.
    // The loser build is NOT naturally inert (proposal.created fan-out already fired agents + review
    // ToDos on it, and it lists with an identical title): ARCHIVE it + expire its open ToDos so the
    // tenant never sees a phantom duplicate.
    const archiveOrphanBuild = async (orphanId: string) => {
      try {
        await withTenant(tenantId, async (tx) => {
          await tx`UPDATE proposals SET archived_at = now() WHERE id = ${orphanId}::uuid AND tenant_id = ${tenantId}::uuid`;
          await tx`
            UPDATE tasks SET status = 'expired', updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'proposal'
              AND entity_id = ${orphanId}::uuid AND status IN ('open','in_progress')`;
        });
      } catch (e) { console.error('[provisionAndReleasePortal] orphan-build archive failed (non-fatal)', e); }
    };
    let linked = false;
    try {
      linked = await linkPortalProposal(tenantId, portalId, prov.proposalId);
    } catch (e) {
      console.error('[provisionAndReleasePortal] link failed', e);
    }
    if (linked) {
      proposalId = prov.proposalId;
    } else {
      const [winner] = await withTenant(tenantId, async (tx) =>
        tx<Array<{ proposalId: string | null }>>`
          SELECT proposal_id AS "proposalId" FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`);
      if (winner?.proposalId) {
        proposalId = winner.proposalId;
        if (winner.proposalId !== prov.proposalId) await archiveOrphanBuild(prov.proposalId);
      } else {
        // Link threw with no winner on the portal: archive our orphan and fail the release —
        // a retry provisions cleanly instead of stacking a second visible duplicate.
        await archiveOrphanBuild(prov.proposalId);
        return { ok: false, error: 'Could not link the provisioned build to the portal (please retry)', code: 'PROVISION_FAILED', status: 500 };
      }
    }
  }

  // Build is ready + linked — NOW flip live (CAS on curation_pending). 409 if not awaiting curation.
  const { released } = await releaseFromCuration(tenantId, portalId, config, { releasedBy: actor.id });
  if (!released) return { ok: false, error: 'Portal is not awaiting curation (already released?)', code: 'CONFLICT', status: 409 };

  // Mid-window amendment replay: an amendment confirmed BETWEEN purchase and this release
  // fanned out to zero flags for this buyer — no proposals row existed yet, and nothing
  // back-filled it. Flag every confirmed amendment onto the fresh proposal now so the
  // portal opens with the banner + bell, exactly as if it had been provisioned first.
  // Tenant-scoped (runInTenant) + best-effort: a replay failure never wedges the release —
  // and it is NOT the last line of defense: the tenant amendments GET reconciles missing
  // flags on read (idempotent ON CONFLICT), so a transiently-failed replay self-heals the
  // first time anyone opens the proposal.
  if (proposalId) {
    try {
      const pid = proposalId;
      const [pr] = await withTenant(tenantId, async (tx) =>
        tx<Array<{ solicitationId: string | null }>>`
          SELECT solicitation_id AS "solicitationId" FROM proposals
          WHERE tenant_id = ${tenantId}::uuid AND id = ${pid}::uuid LIMIT 1`);
      if (pr?.solicitationId) {
        const solicitationId = pr.solicitationId;
        await runInTenant(tenantId, () => replayConfirmedAmendments({
          solicitationId, proposalId: pid, tenantId,
          actorId: actor.id, actorEmail: actor.email ?? null,
        }));
      }
    } catch (e) {
      console.error('[provisionAndReleasePortal] amendment replay failed (non-fatal)', e);
    }
  }

  // Workflow ToDos are best-effort (re-creatable) — they never wedge an already-launched portal.
  let tasksCreated = 0;
  try {
    const wfActor = { id: actor.id, email: actor.email, role: actor.role, tenantId };
    ({ tasksCreated } = await instantiatePortalWorkflow(wfActor, tenantId, portalId, config));
  } catch (e) {
    console.error('[provisionAndReleasePortal] instantiate todos failed (non-fatal, portal is launched)', e);
  }

  // Raise the REQUIRED "set up your workflow" ToDo for the tenant admin (recommend-but-require, TW-3).
  // Best-effort + RLS-scoped so the cross-tenant admin caller can write to the tenant's tasks ledger.
  // entity=portal + a tenantSlug makes taskHref deep-link to the TENANT Workflow Setup page (not the
  // admin cockpit). Fires once — releaseFromCuration's CAS means a retry never re-reaches here.
  try {
    await runInTenant(tenantId, () => createTask({
      actor: { id: actor.id, email: actor.email, role: actor.role, tenantId },
      tenantId,
      assigneeRole: 'tenant_admin',
      assigneeUserId: null,
      taskType: 'acknowledge',
      title: 'Set up your build workflow — review the dates, owners & reminders, then Accept & Start',
      entityType: 'portal',
      entityId: portalId,
      dueAt: null,
      nudgeDays: [],
      params: { kind: 'review', portalId, setup: true },
    }));
  } catch (e) {
    console.error('[provisionAndReleasePortal] setup ToDo failed (non-fatal)', e);
  }

  try {
    await emitEventSingle({
      namespace: 'capture', type: 'workspace.released',
      actor: { type: 'user', id: actor.id, email: actor.email ?? undefined },
      tenantId,
      payload: { correlationId: randomUUID(), portalId, proposalId },
    });
  } catch (e) {
    console.error('[provisionAndReleasePortal] release event emit failed (non-fatal)', e);
  }

  return { ok: true, proposalId, tasksCreated };
}
