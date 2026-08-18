/**
 * POST /api/portal/[tenantSlug]/tasks/assign — delegate a job (J1).
 *
 * A tenant_user or above assigns a contributor a task with completion criteria.
 * The task lands in the assignee's queue (role bucket and/or a named user) and is
 * nudged by the same sweep. tenant-scoped: the task's tenant is this route's
 * tenant, and a named assignee must be an active member of it (enforced in
 * createTask). No parked workflow — completeTask closes it without a resume.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { createTask } from '@/lib/tasks/tasks';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── auth: tenant_user+ within their tenant ──
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point — createTask INSERTs into the tenant-RLS'd tasks ledger

    // ── body ──
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // A PORTAL caller may only assign to tenant-scoped roles — never admin roles.
    // Without this an ordinary customer could craft a task into the live admin
    // task queue (it carries their tenant_id but the admin queue's tenant filter
    // is permissive), turning a customer field into admin-facing text.
    const PORTAL_ASSIGNABLE_ROLES = new Set(['tenant_admin', 'tenant_user', 'partner_user']);
    const assigneeRole = str(body.assigneeRole);
    if (assigneeRole && !PORTAL_ASSIGNABLE_ROLES.has(assigneeRole)) {
      return NextResponse.json({ error: 'Cannot assign to that role', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // Shape-check the uuid inputs here so a bad value is a 400, not a downstream 500.
    const assigneeUserId = str(body.assigneeUserId);
    const entityId = str(body.entityId);
    if (assigneeUserId && !UUID_RE.test(assigneeUserId)) {
      return NextResponse.json({ error: 'Invalid assigneeUserId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (entityId && !UUID_RE.test(entityId)) {
      return NextResponse.json({ error: 'Invalid entityId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // A broadcast targets the WHOLE tenant (no named assignee) — every member (+ a descended shadow
    // admin) receives it and acknowledges independently. createTask enforces the "tenant required, no
    // assignee" shape; here we just pass the flag (and ignore any role/user the client also sent).
    const broadcast = body.broadcast === true;

    const out = await createTask({
      actor: { id: u.id, email: u.email ?? null, role, tenantId },
      tenantId,
      broadcast,
      assigneeRole: broadcast ? null : assigneeRole,
      assigneeUserId: broadcast ? null : assigneeUserId,
      taskType: str(body.taskType) ?? '',
      title: str(body.title) ?? '',
      description: str(body.description),
      entityType: str(body.entityType),
      entityId,
      dueAt: str(body.dueAt),
      nudgeDays: Array.isArray(body.nudgeDays) ? (body.nudgeDays as number[]) : undefined,
      params: body.params && typeof body.params === 'object' ? (body.params as Record<string, unknown>) : undefined,
    });

    if (!out.ok) {
      return NextResponse.json({ error: out.error, code: out.code }, { status: out.status });
    }
    return NextResponse.json({ data: out.data }, { status: 201 });
  } catch (err) {
    console.error('[portal/tasks/assign POST] error:', err);
    return NextResponse.json({ error: 'Failed to assign task', code: 'DB_ERROR' }, { status: 500 });
  }
}
