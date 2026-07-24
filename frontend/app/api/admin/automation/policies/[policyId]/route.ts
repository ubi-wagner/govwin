/**
 * PATCH /api/admin/automation/policies/[policyId]
 *
 * Updates a platform framework policy row (tenant_id IS NULL).
 * Supported fields: enabled, recipientRoles, nudgeDays, dueInMinutes, channel.
 * Sets configured_at on the first explicit edit.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

const VALID_CHANNELS = ['email', 'todo', 'both'] as const;

interface RouteContext {
  params: Promise<{ policyId: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
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

    const { policyId } = await ctx.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(policyId)) {
      return NextResponse.json(
        { error: 'Invalid policyId format', code: 'VALIDATION_ERROR' },
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

    // Verify this is a framework row (tenant_id IS NULL) — never edit tenant overrides here
    let existing: { id: string; triggerKey: string } | undefined;
    try {
      const [row] = await sql<{ id: string; triggerKey: string }[]>`
        SELECT id, trigger_key FROM tenant_automation_policies
        WHERE id = ${policyId}::uuid AND tenant_id IS NULL
      `;
      existing = row;
    } catch (err) {
      console.error('[admin/automation/policies PATCH] lookup failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Policy not found or not a framework row', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Validate provided fields
    if ('enabled' in body && typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be boolean', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if ('recipientRoles' in body) {
      if (!Array.isArray(body.recipientRoles) || !body.recipientRoles.every((r) => typeof r === 'string')) {
        return NextResponse.json(
          { error: 'recipientRoles must be string[]', code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
    }
    if ('nudgeDays' in body) {
      if (!Array.isArray(body.nudgeDays) || !body.nudgeDays.every((d) => typeof d === 'number')) {
        return NextResponse.json(
          { error: 'nudgeDays must be number[]', code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
    }
    if ('channel' in body && !VALID_CHANNELS.includes(body.channel as (typeof VALID_CHANNELS)[number])) {
      return NextResponse.json(
        { error: `channel must be one of: ${VALID_CHANNELS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if ('dueInMinutes' in body && body.dueInMinutes !== null && typeof body.dueInMinutes !== 'number') {
      return NextResponse.json(
        { error: 'dueInMinutes must be number or null', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const hasChanges = ['enabled', 'recipientRoles', 'nudgeDays', 'dueInMinutes', 'channel'].some(
      (k) => k in body,
    );
    if (!hasChanges) {
      return NextResponse.json(
        { error: 'No valid fields to update', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // Build a single UPDATE so all field changes are atomic.
    // Using the postgres.js fragment pattern from the preferences PATCH route.
    const setClauses: ReturnType<typeof sql>[] = [];
    if ('enabled' in body)        setClauses.push(sql`enabled = ${body.enabled as boolean}`);
    if ('recipientRoles' in body) setClauses.push(sql`recipient_roles = ${body.recipientRoles as string[]}::text[]`);
    if ('nudgeDays' in body)      setClauses.push(sql`nudge_days = ${body.nudgeDays as number[]}::int[]`);
    if ('dueInMinutes' in body)   setClauses.push(sql`due_in_minutes = ${body.dueInMinutes as number | null}`);
    if ('channel' in body)        setClauses.push(sql`channel = ${body.channel as string}`);
    setClauses.push(sql`updated_at = now()`);
    setClauses.push(sql`configured_at = COALESCE(configured_at, now())`);

    const setFragment = setClauses.reduce((acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`));

    try {
      await sql`
        UPDATE tenant_automation_policies
        SET ${setFragment}
        WHERE id = ${policyId}::uuid AND tenant_id IS NULL
      `;
    } catch (err) {
      console.error('[admin/automation/policies PATCH] update failed:', err);
      return NextResponse.json({ error: 'Database update failed', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { success: true, policyId, triggerKey: existing.triggerKey } });
  } catch (err) {
    console.error('[api/admin/automation/policies/[policyId] PATCH] error:', err);
    return NextResponse.json(
      { error: 'Failed to update policy', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
