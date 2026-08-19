/**
 * PATCH /api/portal/[tenantSlug]/tasks/[taskId] — reassign / reschedule / re-nudge a live workflow ToDo
 *   body { assigneeUserId?, assigneeRole?, dueAt?, nudgeSchedule? }  (TW-4)
 *
 * Editors = tenant_admin+ (incl. a descended shadow admin) OR a delegated manager of the task's portal.
 * The frozen model had no per-task mutation path; this is it (the workflow-config editor does the same in
 * bulk via re-projection). RLS-scoped; only an open to-do changes; a timing change re-arms the nudges.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { canEditWorkflow, isPortalManager } from '@/lib/portal-workflow';
import { updateTask } from '@/lib/tasks/update-task';

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; taskId: string }> }) {
  try {
    const { tenantSlug, taskId } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown; email?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!isValidUUID(taskId)) return NextResponse.json({ error: 'Invalid task id', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    enterTenant(tenantId); // RLS choke point — updateTask reads/writes the tenant-RLS'd tasks ledger

    // Resolve the task's portal so a delegated manager of THAT portal may edit it.
    const entity = await withTenant(tenantId, async (tx) => {
      const [t] = await tx<Array<{ entityType: string | null; entityId: string | null }>>`
        SELECT entity_type AS "entityType", entity_id AS "entityId" FROM tasks
        WHERE tenant_id = ${tenantId}::uuid AND id = ${taskId}::uuid LIMIT 1`;
      return t ?? null;
    });
    if (!entity) return NextResponse.json({ error: 'To-do not found', code: 'NOT_FOUND' }, { status: 404 });
    const isManager = entity.entityType === 'portal' && entity.entityId
      ? await isPortalManager(tenantId, entity.entityId, u.email ?? null)
      : false;
    if (!canEditWorkflow(role, { isDelegatedManager: isManager })) {
      return NextResponse.json({ error: 'Only an admin or a portal manager can change this to-do', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { assigneeUserId?: string | null; assigneeRole?: string | null; dueAt?: string | null; nudgeSchedule?: number[] };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const result = await updateTask({
      actor: { id: u.id, email: u.email ?? null, role, tenantId },
      tenantId, taskId,
      assigneeUserId: body.assigneeUserId,
      assigneeRole: body.assigneeRole,
      dueAt: body.dueAt,
      nudgeSchedule: body.nudgeSchedule,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status ?? 500 });
    return NextResponse.json({ data: { ok: true, changed: result.changed } });
  } catch (err) {
    console.error('[portal/tasks/:id] PATCH error', err);
    return NextResponse.json({ error: 'Failed to update to-do', code: 'DB_ERROR' }, { status: 500 });
  }
}
