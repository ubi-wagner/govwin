/**
 * GET  /api/portal/[tenantSlug]/tasks      — my open task queue for this tenant
 * POST /api/portal/[tenantSlug]/tasks       — complete a task { taskId, result? }
 *
 * The page-queue surface for tenant roles. View: tenant_user and above (partners
 * excluded from the tenant task queue for now). Completion resumes the parked
 * process instance via the shared completeTask core (tenant-scoped auth).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listOpenTasksForActor, completeTask } from '@/lib/tasks/tasks';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveActor(tenantSlug: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(u.id, role, tenantId);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { actor: { id: u.id, email: u.email ?? null, role, tenantId } };
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;
    const r = await resolveActor(tenantSlug);
    if ('error' in r) return r.error;
    const tasks = await listOpenTasksForActor(r.actor);
    return NextResponse.json({ data: { tasks } });
  } catch (err) {
    console.error('[portal/tasks GET] error:', err);
    return NextResponse.json({ error: 'Failed to load tasks', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;
    const r = await resolveActor(tenantSlug);
    if ('error' in r) return r.error;

    let body: { taskId?: unknown; result?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    if (!UUID_RE.test(taskId)) {
      return NextResponse.json({ error: 'Invalid taskId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const result = (body.result && typeof body.result === 'object')
      ? (body.result as Record<string, unknown>)
      : {};

    const out = await completeTask({ taskId, result, actor: r.actor });
    if (!out.ok) {
      return NextResponse.json({ error: out.error, code: out.code }, { status: out.status });
    }
    return NextResponse.json({ data: out.data });
  } catch (err) {
    console.error('[portal/tasks POST] error:', err);
    return NextResponse.json({ error: 'Failed to complete task', code: 'DB_ERROR' }, { status: 500 });
  }
}
