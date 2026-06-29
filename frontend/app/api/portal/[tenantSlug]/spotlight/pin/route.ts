/**
 * POST   /api/portal/[tenantSlug]/spotlight/pin — Pin a topic
 * DELETE /api/portal/[tenantSlug]/spotlight/pin — Unpin a topic
 *
 * Both require tenant_user auth and verify tenant access.
 * Body: { opportunityId: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';

const BodySchema = z.object({
  opportunityId: z.string().uuid(),
});

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

async function resolveAuth(ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  }

  const { tenantSlug } = await ctx.params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: 'Access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  }

  return { tenantId, tenantSlug, userId: sessionUser.id };
}

export async function POST(request: Request, ctx: RouteContext) {
  const authResult = await resolveAuth(ctx);
  if ('error' in authResult) return authResult.error;
  const { tenantId, tenantSlug, userId } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues , code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  const { opportunityId } = parsed.data;

  // ── Start event for topic pinning ────────────────────────────
  const pinStartId = await emitEventStart({
    namespace: 'capture',
    type: 'topic.pinned',
    actor: { type: 'user', id: userId },
    tenantId,
    payload: { tenantSlug, opportunityId },
  });

  try {
    // Verify opportunity exists and fetch title for event payload
    const [opp] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM opportunities WHERE id = ${opportunityId}
    `;
    if (!opp) {
      await emitEventEnd(pinStartId, { error: { message: 'Opportunity not found', code: 'NOT_FOUND' } });
      return NextResponse.json({ error: 'Opportunity not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Upsert — if already exists, just set is_pinned=true
    await sql`
      INSERT INTO tenant_pipeline_items (tenant_id, opportunity_id, pursuit_status, is_pinned)
      VALUES (${tenantId}, ${opportunityId}, 'unreviewed', true)
      ON CONFLICT (tenant_id, opportunity_id)
      DO UPDATE SET is_pinned = true
    `;

    await emitEventEnd(pinStartId, {
      result: { correlationId: randomUUID(), tenantId, tenantSlug, opportunityId, topicTitle: opp.title },
    });

    // ── W-Q: a pin shouldn't be forgotten — surface a dated "decide" task so it
    // gets nudged. Idempotent: only one open pursue_decision per (tenant, opp).
    // Non-fatal — pinning succeeds regardless.
    try {
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM tasks
        WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'opportunity'
          AND entity_id = ${opportunityId}::uuid AND task_type = 'pursue_decision'
          AND status IN ('open', 'in_progress')
        LIMIT 1
      `;
      if (existing.length === 0) {
        await createTask({
          actor: { id: userId, email: null, role: 'tenant_user', tenantId },
          tenantId,
          assigneeRole: 'tenant_admin',
          taskType: 'pursue_decision',
          title: `Decide whether to pursue: ${opp.title}`,
          entityType: 'opportunity',
          entityId: opportunityId,
          dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          nudgeDays: [3, 1],
        });
      }
    } catch (taskErr) {
      console.error('[spotlight/pin POST] pursue task create failed (non-fatal):', taskErr);
    }

    return NextResponse.json({ data: { pinned: true, opportunityId } });
  } catch (e) {
    console.error('[spotlight/pin POST] Error:', e);
    await emitEventEnd(pinStartId, { error: { message: String(e), code: 'STORAGE_ERROR' } });
    return NextResponse.json({ error: 'Failed to pin topic', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: RouteContext) {
  const authResult = await resolveAuth(ctx);
  if ('error' in authResult) return authResult.error;
  const { tenantId, tenantSlug, userId } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues , code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  const { opportunityId } = parsed.data;

  // ── Start event for topic unpinning ────────────────────────────
  const unpinStartId = await emitEventStart({
    namespace: 'capture',
    type: 'topic.unpinned',
    actor: { type: 'user', id: userId },
    tenantId,
    payload: { tenantSlug, opportunityId },
  });

  try {
    await sql`
      UPDATE tenant_pipeline_items
      SET is_pinned = false, updated_at = now()
      WHERE tenant_id = ${tenantId} AND opportunity_id = ${opportunityId}
    `;

    // W-Q: unpinning resolves the open "decide whether to pursue" nudge.
    try {
      await sql`
        UPDATE tasks SET status = 'cancelled', updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'opportunity'
          AND entity_id = ${opportunityId}::uuid AND task_type = 'pursue_decision'
          AND status IN ('open', 'in_progress')
      `;
    } catch (taskErr) {
      console.error('[spotlight/pin DELETE] pursue task cancel failed (non-fatal):', taskErr);
    }

    await emitEventEnd(unpinStartId, {
      result: { correlationId: randomUUID(), tenantId, tenantSlug, opportunityId },
    });

    return NextResponse.json({ data: { pinned: false, opportunityId } });
  } catch (e) {
    console.error('[spotlight/pin DELETE] Error:', e);
    await emitEventEnd(unpinStartId, { error: { message: String(e), code: 'STORAGE_ERROR' } });
    return NextResponse.json({ error: 'Failed to unpin topic', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
