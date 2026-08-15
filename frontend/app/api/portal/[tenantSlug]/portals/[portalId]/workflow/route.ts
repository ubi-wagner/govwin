/**
 * GET   /api/portal/[tenantSlug]/portals/[portalId]/workflow  — current config + limits + completeness
 *                                                                (+ the history recommendation when unaccepted)
 * PATCH /api/portal/[tenantSlug]/portals/[portalId]/workflow  — edit the workflow post-launch
 *   body { config: GuardrailConfig, accept?: boolean }  → save (re-project) or Accept & Start
 *
 * The tenant Workflow Setup surface (docs/TENANT_WORKFLOW_SETUP_DESIGN.md, TW-2). Editors = tenant_admin+
 * (incl. a descended shadow admin) OR a delegated per-portal manager (canEditWorkflow). RLS-scoped.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import {
  editPortalWorkflow, canEditWorkflow, isPortalManager, getGuardrailLimits,
  checkWorkflowComplete, type GuardrailConfig,
} from '@/lib/portal-workflow';
import { recommendWorkflowConfig } from '@/lib/portal-workflow-recommend';

async function gate(tenantSlug: string, portalId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown; email?: string | null };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!isValidUUID(portalId)) return { error: NextResponse.json({ error: 'Invalid portal id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  // Editors: tenant_admin+ (which covers a descended shadow admin) OR a delegated per-portal manager.
  const isManager = await isPortalManager(tenantId, portalId, u.email ?? null);
  if (!canEditWorkflow(role, { isDelegatedManager: isManager })) {
    return { error: NextResponse.json({ error: 'Only an admin or a portal manager can edit the workflow', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { tenantId, userId: u.id, role, tenantName: (tenant.name as string) ?? tenantSlug, userEmail: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const g = await gate(tenantSlug, portalId);
    if ('error' in g) return g.error;
    const portal = await withTenant(g.tenantId, async (tx) => {
      const [p] = await tx<Array<{ opportunityId: string; label: string; status: string; currentStageIndex: number; guardrailConfig: GuardrailConfig | null }>>`
        SELECT opportunity_id AS "opportunityId", label, status, current_stage_index AS "currentStageIndex", guardrail_config AS "guardrailConfig"
        FROM proposal_portals WHERE tenant_id = ${g.tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
      return p ?? null;
    });
    if (!portal) return NextResponse.json({ error: 'Portal not found', code: 'NOT_FOUND' }, { status: 404 });
    const config = portal.guardrailConfig ?? {};
    const accepted = config._setup?.status === 'accepted';
    const limits = await getGuardrailLimits();
    // When the required setup hasn't been accepted yet, offer the history recommendation to pre-fill.
    const recommendation = accepted ? null : await recommendWorkflowConfig(g.tenantId, portal.opportunityId);
    return NextResponse.json({
      data: {
        portal: { opportunityId: portal.opportunityId, label: portal.label, status: portal.status, currentStageIndex: portal.currentStageIndex, config },
        accepted,
        limits,
        completeness: checkWorkflowComplete(config),
        recommendation,
      },
    });
  } catch (err) {
    console.error('[portal/workflow] GET error', err);
    return NextResponse.json({ error: 'Failed to load workflow', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const g = await gate(tenantSlug, portalId);
    if ('error' in g) return g.error;
    let body: { config?: GuardrailConfig; accept?: boolean };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.config || typeof body.config !== 'object') {
      return NextResponse.json({ error: 'config is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const actor = { id: g.userId, email: g.userEmail, role: g.role, tenantId: g.tenantId };
    const result = await editPortalWorkflow(actor, g.tenantId, portalId, body.config, { accept: body.accept === true });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status ?? 500 });
    return NextResponse.json({ data: { ok: true, accepted: result.accepted, reprojected: result.reprojected, created: result.created, cancelled: result.cancelled } });
  } catch (err) {
    console.error('[portal/workflow] PATCH error', err);
    return NextResponse.json({ error: 'Failed to save workflow', code: 'DB_ERROR' }, { status: 500 });
  }
}
