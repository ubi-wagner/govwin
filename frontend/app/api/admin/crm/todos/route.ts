import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(request.url);
    const todoType = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const priority = url.searchParams.get('priority');
    const assignedTo = url.searchParams.get('assigned_to');

    const validTypes = ['curation', 'support', 'content_review', 'campaign', 'general'];
    const validStatuses = ['open', 'in_progress', 'done', 'dismissed'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    if (todoType && !validTypes.includes(todoType)) {
      return NextResponse.json({ error: 'Invalid todo type', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      const conditions: string[] = [];
      if (todoType) conditions.push('type');
      if (status) conditions.push('status');
      if (priority) conditions.push('priority');
      if (assignedTo) conditions.push('assigned');

      // Build query dynamically using conditional sql fragments
      const todos = await sql`
        SELECT t.id, t.title, t.description, t.todo_type, t.priority, t.status,
               t.assigned_to, u.email AS assigned_email, u.name AS assigned_name,
               t.tenant_id, t.related_entity_type, t.related_entity_id,
               t.due_at, t.metadata, t.created_by, t.created_at, t.updated_at, t.completed_at
        FROM admin_todos t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE 1=1
          ${todoType ? sql`AND t.todo_type = ${todoType}` : sql``}
          ${status ? sql`AND t.status = ${status}` : sql``}
          ${priority ? sql`AND t.priority = ${priority}` : sql``}
          ${assignedTo ? sql`AND t.assigned_to = ${assignedTo}` : sql``}
        ORDER BY
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.created_at DESC
        LIMIT 100
      `;

      return NextResponse.json({ data: todos });
    } catch (e) {
      console.error('[api/admin/crm/todos] GET query failed:', e);
      return NextResponse.json({ error: 'Failed to fetch todos', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/todos] GET error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    // Validate required fields
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (!body.todo_type || typeof body.todo_type !== 'string') {
      return NextResponse.json({ error: 'todo_type is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const validTypes = ['curation', 'support', 'content_review', 'campaign', 'general'];
    if (!validTypes.includes(body.todo_type as string)) {
      return NextResponse.json({ error: 'Invalid todo_type', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const priority = (typeof body.priority === 'string' && validPriorities.includes(body.priority)) ? body.priority : 'medium';

    try {
      const [todo] = await sql<{ id: string }[]>`
        INSERT INTO admin_todos (
          title, description, todo_type, priority, status,
          assigned_to, tenant_id, related_entity_type, related_entity_id,
          due_at, metadata, created_by
        ) VALUES (
          ${(body.title as string).trim()},
          ${typeof body.description === 'string' ? body.description.trim() : null},
          ${body.todo_type as string},
          ${priority as string},
          'open',
          ${typeof body.assigned_to === 'string' ? body.assigned_to : null},
          ${typeof body.tenant_id === 'string' ? body.tenant_id : null},
          ${typeof body.related_entity_type === 'string' ? body.related_entity_type : null},
          ${typeof body.related_entity_id === 'string' ? body.related_entity_id : null},
          ${typeof body.due_at === 'string' ? body.due_at : null},
          ${JSON.stringify(typeof body.metadata === 'object' && body.metadata ? body.metadata : {})}::jsonb,
          ${userId ?? null}
        )
        RETURNING id
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'todo.created',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: null,
        payload: { todoId: todo.id, todoType: body.todo_type, priority },
      });

      return NextResponse.json({ data: { id: todo.id } }, { status: 201 });
    } catch (e) {
      console.error('[api/admin/crm/todos] POST insert failed:', e);
      return NextResponse.json({ error: 'Failed to create todo', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/todos] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
