/**
 * GET  /api/admin/tasks   — the admin task queue (admin-scoped + all tenants)
 * POST /api/admin/tasks   — complete a task { taskId, result? }
 *
 * Auth: rfp_admin or above. Admins see admin-scoped tasks (tenant_id IS NULL)
 * and may complete any task they are an assignee of, across tenants, via the
 * shared completeTask core.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — the @/lib/tasks helpers query across tenants, so route their
// global-`sql` to the owner (BYPASSRLS) pool via enterBypass() after the gate. (docs/RLS_CUTOVER.md)
import { enterBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listOpenTasksForActor, completeTask } from '@/lib/tasks/tasks';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAdmin() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!hasRoleAtLeast(role, 'rfp_admin')) {
    return { error: NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { actor: { id: u.id, email: u.email ?? null, role, tenantId: u.tenantId ?? null } };
}

export async function GET() {
  try {
    const r = await resolveAdmin();
    if ('error' in r) return r.error;
    enterBypass();
    // tenantId null → admin-scoped tasks only (admin queue). Cross-tenant
    // filtering by a specific tenant is the monitor view's job (#5).
    const tasks = await listOpenTasksForActor(r.actor);
    return NextResponse.json({ data: { tasks } });
  } catch (err) {
    console.error('[admin/tasks GET] error:', err);
    return NextResponse.json({ error: 'Failed to load tasks', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const r = await resolveAdmin();
    if ('error' in r) return r.error;
    enterBypass();

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
    console.error('[admin/tasks POST] error:', err);
    return NextResponse.json({ error: 'Failed to complete task', code: 'DB_ERROR' }, { status: 500 });
  }
}
