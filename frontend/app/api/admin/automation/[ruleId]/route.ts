/**
 * PATCH /api/admin/automation/[ruleId] — Toggle active, update config
 *
 * Modifies an existing automation rule. Supports toggling is_active
 * and updating action_config, description, trigger fields.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { randomUUID } from 'crypto';

interface RouteContext {
  params: Promise<{ ruleId: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    // 1. AUTH CHECK
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

    const userId = (session.user as { id?: string }).id ?? 'unknown';
    const userEmail = (session.user as { email?: string }).email;

    // 2. PARSE PARAMS + BODY
    const { ruleId } = await ctx.params;
    if (!ruleId) {
      return NextResponse.json(
        { error: 'Missing ruleId', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(ruleId)) {
      return NextResponse.json(
        { error: 'Invalid ruleId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // 3. CHECK RULE EXISTS
    let existing: { id: string; name: string; isActive: boolean } | undefined;
    try {
      const [row] = await sql<{ id: string; name: string; isActive: boolean }[]>`
        SELECT id, name, is_active FROM automation_rules WHERE id = ${ruleId}::uuid
      `;
      existing = row;
    } catch (err) {
      console.error('[AUTOMATION_RULE] DB query failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Rule not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // 4. BUILD UPDATE — only update provided fields
    const changes: string[] = [];

    try {
      if (typeof body.isActive === 'boolean') {
        await sql`
          UPDATE automation_rules
          SET is_active = ${body.isActive}, updated_at = now()
          WHERE id = ${ruleId}::uuid
        `;
        changes.push(`is_active: ${existing.isActive} -> ${body.isActive}`);
      }

      if (typeof body.description === 'string') {
        await sql`
          UPDATE automation_rules
          SET description = ${body.description.trim()}, updated_at = now()
          WHERE id = ${ruleId}::uuid
        `;
        changes.push('description updated');
      }

      if (typeof body.actionConfig === 'object' && body.actionConfig !== null) {
        await sql`
          UPDATE automation_rules
          SET action_config = ${JSON.stringify(body.actionConfig)}::jsonb, updated_at = now()
          WHERE id = ${ruleId}::uuid
        `;
        changes.push('action_config updated');
      }

      if (typeof body.triggerNamespace === 'string' && typeof body.triggerType === 'string') {
        await sql`
          UPDATE automation_rules
          SET trigger_namespace = ${body.triggerNamespace.trim()},
              trigger_type = ${body.triggerType.trim()},
              updated_at = now()
          WHERE id = ${ruleId}::uuid
        `;
        changes.push('trigger updated');
      }
    } catch (err) {
      console.error('[AUTOMATION_RULE] DB update failed:', err);
      return NextResponse.json({ error: 'Database update failed', code: 'DB_ERROR' }, { status: 500 });
    }

    if (changes.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // 5. EMIT EVENT
    const eventType = typeof body.isActive === 'boolean' ? 'rule.toggled' : 'rule.updated';

    await emitEventSingle({
      namespace: 'system',
      type: eventType,
      actor: userActor(userId, userEmail),
      tenantId: null,
      payload: {
        correlationId: randomUUID(),
        ruleId,
        ruleName: existing.name,
        changes,
        newIsActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      },
    });

    return NextResponse.json({ data: { success: true, changes } });
  } catch (err) {
    console.error('[api/admin/automation/[ruleId] PATCH] error:', err);
    return NextResponse.json(
      { error: 'Failed to update rule', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function GET(_request: Request, ctx: RouteContext) {
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

    const { ruleId } = await ctx.params;
    if (!ruleId) {
      return NextResponse.json(
        { error: 'Missing ruleId', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let rule: {
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
    } | undefined;

    try {
      const [row] = await sql<{
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
      }[]>`
        SELECT id, name, description, is_active, trigger_namespace, trigger_type,
               action_type, action_config, created_by, created_at, updated_at
        FROM automation_rules
        WHERE id = ${ruleId}::uuid
      `;
      rule = row;
    } catch (err) {
      console.error('[AUTOMATION_RULE] DB query failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!rule) {
      return NextResponse.json(
        { error: 'Rule not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Also fetch recent automation_log entries for this rule
    let logs: {
      id: string;
      actionType: string;
      status: string;
      result: unknown;
      errorMessage: string | null;
      executedAt: Date;
    }[];

    try {
      logs = await sql<{
        id: string;
        actionType: string;
        status: string;
        result: unknown;
        errorMessage: string | null;
        executedAt: Date;
      }[]>`
        SELECT id, action_type, status, result, error_message, executed_at
        FROM automation_log
        WHERE rule_id = ${ruleId}::uuid
        ORDER BY executed_at DESC
        LIMIT 20
      `;
    } catch (err) {
      console.error('[AUTOMATION_RULE] DB logs query failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { rule, logs } });
  } catch (err) {
    console.error('[api/admin/automation/[ruleId] GET] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch rule', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
