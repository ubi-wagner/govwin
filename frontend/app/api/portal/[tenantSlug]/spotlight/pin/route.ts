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
import { emitEventSingle } from '@/lib/events';

const BodySchema = z.object({
  opportunityId: z.string().uuid(),
});

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

async function resolveAuth(ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }) };
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return { error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) };
  }

  const { tenantSlug } = await ctx.params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) };
  }

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
  }

  return { tenantId, userId: sessionUser.id };
}

export async function POST(request: Request, ctx: RouteContext) {
  const authResult = await resolveAuth(ctx);
  if ('error' in authResult) return authResult.error;
  const { tenantId, userId } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { opportunityId } = parsed.data;

  try {
    // Verify opportunity exists
    const [opp] = await sql<{ id: string }[]>`
      SELECT id FROM opportunities WHERE id = ${opportunityId}
    `;
    if (!opp) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
    }

    // Upsert — if already exists, just set is_pinned=true
    await sql`
      INSERT INTO tenant_pipeline_items (tenant_id, opportunity_id, pursuit_status, is_pinned)
      VALUES (${tenantId}, ${opportunityId}, 'unreviewed', true)
      ON CONFLICT (tenant_id, opportunity_id)
      DO UPDATE SET is_pinned = true
    `;

    await emitEventSingle({
      namespace: 'spotlight',
      type: 'topic_pinned',
      actor: { type: 'user', id: userId },
      tenantId,
      payload: { opportunityId },
    });

    return NextResponse.json({ data: { pinned: true, opportunityId } });
  } catch (e) {
    console.error('[spotlight/pin POST] Error:', e);
    return NextResponse.json({ error: 'Failed to pin topic' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: RouteContext) {
  const authResult = await resolveAuth(ctx);
  if ('error' in authResult) return authResult.error;
  const { tenantId, userId } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { opportunityId } = parsed.data;

  try {
    await sql`
      DELETE FROM tenant_pipeline_items
      WHERE tenant_id = ${tenantId} AND opportunity_id = ${opportunityId}
    `;

    await emitEventSingle({
      namespace: 'spotlight',
      type: 'topic_unpinned',
      actor: { type: 'user', id: userId },
      tenantId,
      payload: { opportunityId },
    });

    return NextResponse.json({ data: { pinned: false, opportunityId } });
  } catch (e) {
    console.error('[spotlight/pin DELETE] Error:', e);
    return NextResponse.json({ error: 'Failed to unpin topic' }, { status: 500 });
  }
}
