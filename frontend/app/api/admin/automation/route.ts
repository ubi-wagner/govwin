/**
 * GET  /api/admin/automation — List automation rules
 * POST /api/admin/automation — Create a new automation rule
 *
 * Queries the automation_rules table in the main DB directly.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { randomUUID } from 'crypto';

// Valid action types from the CHECK constraint (migration 050)
const VALID_ACTION_TYPES = [
  'log_only', 'queue_notification', 'queue_job', 'emit_event',
  'send_email', 'notify_admin', 'webhook', 'update_status',
  'create_todo', 'distribute_social', 'publish_content',
  'unpublish_content', 'enroll_drip',
];

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    let rules: {
      id: string;
      name: string;
      description: string | null;
      isActive: boolean;
      triggerNamespace: string;
      triggerType: string;
      actionType: string;
      actionConfig: Record<string, unknown>;
      createdBy: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[];

    if (activeOnly) {
      rules = await sql`
        SELECT id, name, description, is_active, trigger_namespace, trigger_type,
               action_type, action_config, created_by, created_at, updated_at
        FROM automation_rules
        WHERE is_active = true
        ORDER BY created_at DESC
      `;
    } else {
      rules = await sql`
        SELECT id, name, description, is_active, trigger_namespace, trigger_type,
               action_type, action_config, created_by, created_at, updated_at
        FROM automation_rules
        ORDER BY created_at DESC
      `;
    }

    return NextResponse.json({ data: { rules } });
  } catch (err) {
    console.error('[api/admin/automation GET] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch automation rules', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json(
        { error: 'Missing user id in session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const userEmail = (session.user as { email?: string }).email;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // Validate required fields
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const triggerNamespace = typeof body.triggerNamespace === 'string' ? body.triggerNamespace.trim() : '';
    const triggerType = typeof body.triggerType === 'string' ? body.triggerType.trim() : '';
    const actionType = typeof body.actionType === 'string' ? body.actionType.trim() : '';

    if (!name) {
      return NextResponse.json(
        { error: 'name is required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (!triggerNamespace || !triggerType) {
      return NextResponse.json(
        { error: 'triggerNamespace and triggerType are required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (!actionType || !VALID_ACTION_TYPES.includes(actionType)) {
      return NextResponse.json(
        { error: `actionType must be one of: ${VALID_ACTION_TYPES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const description = typeof body.description === 'string' ? body.description.trim() : null;
    const actionConfig = typeof body.actionConfig === 'object' && body.actionConfig !== null
      ? body.actionConfig
      : {};
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : true;

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO automation_rules (
        name, description, is_active, trigger_namespace, trigger_type,
        action_type, action_config, created_by
      ) VALUES (
        ${name}, ${description}, ${isActive}, ${triggerNamespace}, ${triggerType},
        ${actionType}, ${JSON.stringify(actionConfig)}::jsonb, ${userId}::uuid
      )
      RETURNING id
    `;

    await emitEventSingle({
      namespace: 'system',
      type: 'rule.created',
      actor: userActor(userId, userEmail),
      tenantId: null,
      payload: {
        correlationId: randomUUID(),
        ruleId: row.id,
        name,
        triggerNamespace,
        triggerType,
        actionType,
      },
    });

    return NextResponse.json({ data: { id: row.id } }, { status: 201 });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('23505') || errMsg.includes('unique')) {
      return NextResponse.json(
        { error: 'A rule with this name already exists', code: 'CONFLICT' },
        { status: 409 },
      );
    }
    console.error('[api/admin/automation POST] error:', err);
    return NextResponse.json(
      { error: 'Failed to create automation rule', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
