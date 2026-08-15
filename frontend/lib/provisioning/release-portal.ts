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
import { provisionProposalForPortal } from '@/lib/provision-proposal';
import { linkPortalProposal, releaseFromCuration } from '@/lib/portal-launch';
import { getGuardrailLimits, validateGuardrailConfig, instantiatePortalWorkflow, type GuardrailConfig } from '@/lib/portal-workflow';
import { emitEventSingle } from '@/lib/events';
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
  const config = (opts.guardrailConfig ?? DEFAULT_RELEASE_GUARDRAILS) as GuardrailConfig;

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
    await linkPortalProposal(tenantId, portalId, prov.proposalId);
    proposalId = prov.proposalId;
  }

  // Build is ready + linked — NOW flip live (CAS on curation_pending). 409 if not awaiting curation.
  const { released } = await releaseFromCuration(tenantId, portalId, config, { releasedBy: actor.id });
  if (!released) return { ok: false, error: 'Portal is not awaiting curation (already released?)', code: 'CONFLICT', status: 409 };

  // Workflow ToDos are best-effort (re-creatable) — they never wedge an already-launched portal.
  let tasksCreated = 0;
  try {
    const wfActor = { id: actor.id, email: actor.email, role: actor.role, tenantId };
    ({ tasksCreated } = await instantiatePortalWorkflow(wfActor, tenantId, portalId, config));
  } catch (e) {
    console.error('[provisionAndReleasePortal] instantiate todos failed (non-fatal, portal is launched)', e);
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
