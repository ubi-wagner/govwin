/**
 * GET /api/portal/[tenantSlug]/processes/[instanceId]
 *
 * Tenant-scoped process-instance detail + `process_instance_transitions` timeline —
 * the customer/shadow-admin mirror of /api/admin/workflows/[instanceId]. The instance
 * is read `WHERE tenant_id = <tenant>`, so a customer can only ever see their OWN
 * spine's workflow (two-spine isolation — see docs/MASTER_MIRROR_OPP_DESIGN.md §1).
 *
 * Auth: tenant_user and above with tenant access. Response: { data: { instance, transitions } }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string; instanceId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, instanceId } = await ctx.params;

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!UUID.test(instanceId)) {
      return NextResponse.json({ error: 'Invalid instanceId format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point — process_instances is tenant-RLS'd (mig 185)

    // Tenant-scoped: this tenant's own instance only (their spine).
    const instances = await sql<{
      id: string; workflowName: string; status: string; currentStep: string | null;
      startedAt: string | null; completedAt: string | null;
    }[]>`
      SELECT id, workflow_name, status, current_step, started_at, completed_at
      FROM process_instances
      WHERE id = ${instanceId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    if (instances.length === 0) {
      return NextResponse.json({ error: 'Process not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const transitions = await sql<{
      id: string; fromStatus: string | null; toStatus: string; stepName: string | null;
      actor: string | null; reason: string | null; createdAt: string;
    }[]>`
      SELECT id, from_status, to_status, step_name, actor, reason, created_at
      FROM process_instance_transitions
      WHERE instance_id = ${instanceId}::uuid
      ORDER BY created_at ASC
    `;

    return NextResponse.json({ data: { instance: instances[0], transitions } });
  } catch (err) {
    console.error('[portal/processes/[instanceId]] error:', err);
    return NextResponse.json({ error: 'Instance query failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
