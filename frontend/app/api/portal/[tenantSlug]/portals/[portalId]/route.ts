/**
 * GET   /api/portal/[tenantSlug]/portals/[portalId]                 — portal + shadow grants
 * POST  /api/portal/[tenantSlug]/portals/[portalId]?action=accept   — accept guardrails → launch
 *   body { guardrailConfig, revokeShadow? }
 * POST  /api/portal/[tenantSlug]/portals/[portalId]?action=revoke-shadow — revoke shadow admin
 * PATCH /api/portal/[tenantSlug]/portals/[portalId]                 — set status (execute/closeout/…)
 *
 * The accept-at-launch gate + the customer's revoke control. RLS-scoped.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { acceptGuardrails, revokeShadowAdmin, setPortalStatus, linkPortalProposal } from '@/lib/portal-launch';
import { getGuardrailLimits, validateGuardrailConfig, instantiatePortalWorkflow, advancePortalStage, type GuardrailConfig } from '@/lib/portal-workflow';
import { provisionProposalForPortal } from '@/lib/provision-proposal';

const STATUSES = ['guardrails_pending', 'launched', 'executing', 'closeout', 'archived', 'abandoned'];

async function gate(tenantSlug: string, portalId: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown; email?: string | null };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(portalId)) return { error: NextResponse.json({ error: 'Invalid portal id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, role, tenantName: (tenant.name as string) ?? tenantSlug, userEmail: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const g = await gate(tenantSlug, portalId, 'tenant_user');
    if ('error' in g) return g.error;
    const data = await withTenant(g.tenantId, async (tx) => {
      const [portal] = await tx<Array<Record<string, unknown>>>`
        SELECT id, opportunity_id, proposal_id, label, status, guardrail_config, launched_at, created_at
        FROM proposal_portals WHERE tenant_id = ${g.tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
      const grants = await tx`
        SELECT id, admin_user_id, admin_email, source, active, granted_at, revoked_at
        FROM shadow_admin_grants WHERE tenant_id = ${g.tenantId}::uuid AND portal_id = ${portalId}::uuid ORDER BY granted_at DESC`;
      return { portal: portal ?? null, shadowGrants: grants };
    });
    if (!data.portal) return NextResponse.json({ error: 'Portal not found', code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[portal/portals/:id] GET error', err);
    return NextResponse.json({ error: 'Failed to load portal', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const action = new URL(request.url).searchParams.get('action');
    // Accept-at-launch + revoke are customer-admin controls.
    const g = await gate(tenantSlug, portalId, 'tenant_admin');
    if ('error' in g) return g.error;

    if (action === 'accept') {
      let body: { guardrailConfig?: GuardrailConfig; revokeShadow?: boolean };
      try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
      const config = (body.guardrailConfig ?? {}) as GuardrailConfig;
      // Enforce the RFP-admin guardrail limits (max 3 stages, 10 collaborators, 1 manager, 3 nudges).
      const limits = await getGuardrailLimits();
      const v = validateGuardrailConfig(config, limits);
      if (!v.ok) return NextResponse.json({ error: v.errors.join('; '), code: 'GUARDRAIL_LIMIT' }, { status: 422 });
      const { launched } = await acceptGuardrails(g.tenantId, portalId, config, { revokeShadow: body.revokeShadow, acceptedBy: g.userId });
      if (!launched) return NextResponse.json({ error: 'Portal not pending (already launched?)', code: 'CONFLICT' }, { status: 409 });
      // The portal is now committed as launched. Everything below is BEST-EFFORT:
      // provision the proposal build (V0→V1 substrate) if not yet bound, and
      // instantiate the workflow ToDos. A failure here must not 500 — the portal is
      // already launched, and a retry would hit the guardrails_pending CAS and 409.
      let proposalId: string | null = null;
      let tasksCreated = 0;
      try {
        const [portalRow] = await withTenant(g.tenantId, async (tx) =>
          tx<Array<{ opportunityId: string; proposalId: string | null; label: string }>>`
            SELECT opportunity_id AS "opportunityId", proposal_id AS "proposalId", label
            FROM proposal_portals WHERE tenant_id = ${g.tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`,
        );
        proposalId = portalRow?.proposalId ?? null;
        if (portalRow && !proposalId) {
          const prov = await provisionProposalForPortal({
            tenantId: g.tenantId, tenantName: g.tenantName, tenantSlug,
            opportunityId: portalRow.opportunityId, label: portalRow.label,
            actorId: g.userId, actorEmail: g.userEmail,
          });
          if ('proposalId' in prov) {
            proposalId = prov.proposalId;
            await linkPortalProposal(g.tenantId, portalId, proposalId);
          } else {
            console.error('[portal/portals/:id] provision failed', prov.error);
          }
        }
        // Instantiate the portal's workflow: stage-0 ToDos into the tasks/nudge ledger.
        const actor = { id: g.userId, email: g.userEmail, role: g.role, tenantId: g.tenantId };
        ({ tasksCreated } = await instantiatePortalWorkflow(actor, g.tenantId, portalId, config));
      } catch (postErr) {
        console.error('[portal/portals/:id] post-launch side effects failed (portal is launched)', postErr);
      }
      return NextResponse.json({ data: { launched: true, tasksCreated, proposalId } });
    }
    if (action === 'advance-stage') {
      let body: { force?: boolean } = {};
      try { body = await request.json(); } catch { /* body optional */ }
      const actor = { id: g.userId, email: null, role: g.role, tenantId: g.tenantId };
      const result = await advancePortalStage(actor, g.tenantId, portalId, { force: body.force === true });
      if (!result.advanced) {
        const status = result.reason === 'not_found' ? 404 : 409;
        return NextResponse.json({ error: `Cannot advance: ${result.reason}`, code: 'STAGE_GATE' }, { status });
      }
      return NextResponse.json({ data: result });
    }
    if (action === 'revoke-shadow') {
      const { revoked } = await revokeShadowAdmin(g.tenantId, portalId, g.userId);
      return NextResponse.json({ data: { revoked } });
    }
    return NextResponse.json({ error: 'Unknown action', code: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (err) {
    console.error('[portal/portals/:id] POST error', err);
    return NextResponse.json({ error: 'Action failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const g = await gate(tenantSlug, portalId, 'tenant_admin');
    if ('error' in g) return g.error;
    let body: { status?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.status || !STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    await setPortalStatus(g.tenantId, portalId, body.status);
    return NextResponse.json({ data: { status: body.status } });
  } catch (err) {
    console.error('[portal/portals/:id] PATCH error', err);
    return NextResponse.json({ error: 'Update failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
