/**
 * Tenant Workflow Setup page — /portal/[tenantSlug]/portals/[portalId] (TW-6,
 * docs/TENANT_WORKFLOW_SETUP_DESIGN.md §6). The dedicated per-portal surface: the REQUIRED one-time
 * "Accept & Start" for a new portal (recommend-but-require) and the ongoing edit surface after. Editors =
 * tenant_admin+ (incl. a descended shadow admin) or a delegated portal manager.
 */
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import {
  canEditWorkflow, isPortalManager, getGuardrailLimits, getStageReviewState, type GuardrailConfig,
} from '@/lib/portal-workflow';
import { recommendWorkflowConfig } from '@/lib/portal-workflow-recommend';
import { WorkflowSetupClient, type Member } from './workflow-setup-client';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  launched: 'Launched', executing: 'In progress', closeout: 'Close-out',
  curation_pending: 'Awaiting curation', guardrails_pending: 'Guardrails pending',
  archived: 'Archived', abandoned: 'Abandoned',
};

export default async function WorkflowSetupPage({ params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  const { tenantSlug, portalId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const u = session.user as { id?: string; role?: unknown; email?: string | null };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) redirect('/login?error=session');
  if (!isValidUUID(portalId)) notFound();

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) redirect('/portal');

  const isManager = await isPortalManager(tenantId, portalId, u.email ?? null);
  if (!canEditWorkflow(role, { isDelegatedManager: isManager })) redirect(`/portal/${tenantSlug}/portals`);

  enterTenant(tenantId); // RLS choke point — subsequent sql reads are tenant-scoped

  let portal: { opportunityId: string; label: string; status: string; currentStageIndex: number; guardrailConfig: GuardrailConfig | null } | undefined;
  try {
    [portal] = await sql<Array<{ opportunityId: string; label: string; status: string; currentStageIndex: number; guardrailConfig: GuardrailConfig | null }>>`
      SELECT opportunity_id AS "opportunityId", label, status, current_stage_index AS "currentStageIndex", guardrail_config AS "guardrailConfig"
      FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    console.error('[portal/workflow-setup] portal load failed', e);
  }
  if (!portal) notFound();

  let oppTitle = portal.label || 'Proposal';
  try {
    const [o] = await sql<Array<{ title: string | null; topicNumber: string | null }>>`
      SELECT title, topic_number AS "topicNumber" FROM opportunities WHERE id = ${portal.opportunityId}::uuid LIMIT 1`;
    if (o?.title) oppTitle = o.topicNumber ? `${o.topicNumber}: ${o.title}` : o.title;
  } catch { /* keep the label */ }

  const savedConfig = portal.guardrailConfig ?? {};
  const accepted = savedConfig._setup?.status === 'accepted';

  // Not yet accepted → pre-fill from the history recommendation (recommend-but-require).
  let initialConfig: GuardrailConfig = savedConfig;
  let recommendationBasis: string | null = null;
  if (!accepted) {
    const rec = await recommendWorkflowConfig(tenantId, portal.opportunityId);
    initialConfig = rec.config;
    recommendationBasis = rec.source === 'history' ? (rec.basis ?? null) : null;
  }

  const limits = await getGuardrailLimits();

  // TW-8c — when the CURRENT stage is an AI-manager gate, surface its review state so the client can show
  // "AI review pending / complete" + a one-click advance (assisted) and fire the opt-in auto-advance.
  const curStage = (savedConfig.stages ?? [])[portal.currentStageIndex] ?? null;
  const reviewState = accepted && curStage?.gateCloser === 'agent_manager' && curStage.key
    ? { ...(await getStageReviewState(portalId, curStage.key)), stageKey: curStage.key, stageLabel: curStage.label ?? curStage.key,
        agentManagerKey: curStage.agentManagerKey ?? null, autoAdvance: curStage.autoAdvance === true }
    : null;

  let members: Member[] = [];
  try {
    members = await sql<Member[]>`
      SELECT u.id, u.name, u.email, m.role
      FROM user_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.source IN ('home','manual') AND m.status = 'active'
      ORDER BY u.name NULLS LAST, u.email`;
  } catch (e) { console.error('[portal/workflow-setup] members load failed', e); }

  return (
    <div className="p-4 sm:p-8">
      <WorkflowSetupClient
        tenantSlug={tenantSlug}
        portalId={portalId}
        oppTitle={oppTitle}
        statusLabel={STATUS_LABEL[portal.status] ?? portal.status}
        accepted={accepted}
        recommendationBasis={recommendationBasis}
        limits={{ maxStages: limits.maxStages, maxNudges: limits.maxNudges }}
        members={members}
        initialConfig={initialConfig}
        currentStageIndex={portal.currentStageIndex}
        reviewState={reviewState}
      />
    </div>
  );
}
