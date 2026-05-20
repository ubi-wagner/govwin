import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ todoId: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id;
    const { todoId } = await ctx.params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    // Validate inputs
    const validStatuses = ['open', 'in_progress', 'done', 'dismissed'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    if (body.status !== undefined && (typeof body.status !== 'string' || !validStatuses.includes(body.status))) {
      return NextResponse.json({ error: 'Invalid status', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (body.priority !== undefined && (typeof body.priority !== 'string' || !validPriorities.includes(body.priority))) {
      return NextResponse.json({ error: 'Invalid priority', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      // Check todo exists
      const [existing] = await sql<{ id: string; status: string }[]>`
        SELECT id, status FROM admin_todos WHERE id = ${todoId} LIMIT 1
      `;
      if (!existing) {
        return NextResponse.json({ error: 'Todo not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      // Build updates
      const updates: Record<string, unknown> = {};
      if (typeof body.status === 'string') updates.status = body.status;
      if (typeof body.priority === 'string') updates.priority = body.priority;
      if (body.assigned_to !== undefined) updates.assigned_to = typeof body.assigned_to === 'string' ? body.assigned_to : null;

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update', code: 'VALIDATION_ERROR' }, { status: 422 });
      }

      // Determine if completing
      const isCompleting = updates.status === 'done' || updates.status === 'dismissed';

      await sql`
        UPDATE admin_todos SET
          status = COALESCE(${updates.status as string ?? null}, status),
          priority = COALESCE(${updates.priority as string ?? null}, priority),
          assigned_to = ${updates.assigned_to !== undefined ? (updates.assigned_to as string | null) : sql`assigned_to`},
          completed_at = ${isCompleting ? sql`now()` : sql`completed_at`}
        WHERE id = ${todoId}
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'todo.updated',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: null,
        payload: { todoId, updates },
      });

      return NextResponse.json({ data: { id: todoId, ...updates } });
    } catch (e) {
      console.error('[api/admin/crm/todos/[todoId]] PATCH query failed:', e);
      return NextResponse.json({ error: 'Failed to update todo', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/todos/[todoId]] PATCH error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
