/**
 * GET    /api/portal/[tenantSlug]/buckets/[bucketId]           — ranked cards for this bucket
 * POST   /api/portal/[tenantSlug]/buckets/[bucketId]?action=rank — (re)rank the local pipeline now
 * PATCH  /api/portal/[tenantSlug]/buckets/[bucketId]           — edit name/description/criteria (re-ranks)
 * DELETE /api/portal/[tenantSlug]/buckets/[bucketId]           — deactivate
 *
 * Ranking is on-demand against the tenant's local cards (mig 096). RLS-scoped.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { rankBucket } from '@/lib/bucket-ranking';
import { emitEventSingle, userActor } from '@/lib/events';

async function gate(tenantSlug: string, bucketId: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(bucketId)) return { error: NextResponse.json({ error: 'Invalid bucket id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; bucketId: string }> }) {
  try {
    const { tenantSlug, bucketId } = await params;
    const g = await gate(tenantSlug, bucketId, 'tenant_user');
    if ('error' in g) return g.error;
    const ranked = await withTenant(g.tenantId, async (tx) =>
      tx`
        SELECT s.opportunity_id, s.score, s.factors, s.computed_at,
               c.card, c.is_pinned, c.lifecycle_status
        FROM tenant_bucket_scores s
        JOIN tenant_opportunity_cards c
          ON c.tenant_id = s.tenant_id AND c.opportunity_id = s.opportunity_id
        WHERE s.tenant_id = ${g.tenantId}::uuid AND s.bucket_id = ${bucketId}::uuid
        ORDER BY s.score DESC, c.is_pinned DESC
        LIMIT 500
      `,
    );
    return NextResponse.json({ data: { ranked } });
  } catch (err) {
    console.error('[portal/buckets/:id] GET error', err);
    return NextResponse.json({ error: 'Failed to load ranking', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; bucketId: string }> }) {
  try {
    const { tenantSlug, bucketId } = await params;
    const g = await gate(tenantSlug, bucketId, 'tenant_user');
    if ('error' in g) return g.error;
    if (new URL(request.url).searchParams.get('action') !== 'rank') {
      return NextResponse.json({ error: 'Unknown action (use ?action=rank)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const { ranked } = await rankBucket(g.tenantId, bucketId, Date.now());
    return NextResponse.json({ data: { ranked } });
  } catch (err) {
    console.error('[portal/buckets/:id] rank error', err);
    return NextResponse.json({ error: 'Rank failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; bucketId: string }> }) {
  try {
    const { tenantSlug, bucketId } = await params;
    const g = await gate(tenantSlug, bucketId, 'tenant_admin');
    if ('error' in g) return g.error;
    let body: { name?: string; description?: string; criteria?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    await withTenant(g.tenantId, async (tx) => {
      await tx`
        UPDATE tenant_spotlight_buckets SET
          name = COALESCE(${body.name ?? null}, name),
          description = COALESCE(${body.description ?? null}, description),
          criteria = COALESCE(${body.criteria !== undefined ? sql.json(body.criteria as Parameters<typeof sql.json>[0]) : null}, criteria)
        WHERE tenant_id = ${g.tenantId}::uuid AND id = ${bucketId}::uuid
      `;
    });
    // Re-rank against the (possibly) new criteria.
    const { ranked } = await rankBucket(g.tenantId, bucketId, Date.now());
    await emitEventSingle({
      namespace: 'capture',
      type: 'bucket.updated',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: g.tenantId,
      payload: { bucketId },
    });
    return NextResponse.json({ data: { updated: true, ranked } });
  } catch (err) {
    console.error('[portal/buckets/:id] PATCH error', err);
    return NextResponse.json({ error: 'Update failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tenantSlug: string; bucketId: string }> }) {
  try {
    const { tenantSlug, bucketId } = await params;
    const g = await gate(tenantSlug, bucketId, 'tenant_admin');
    if ('error' in g) return g.error;
    await withTenant(g.tenantId, async (tx) => {
      await tx`UPDATE tenant_spotlight_buckets SET is_active = false WHERE tenant_id = ${g.tenantId}::uuid AND id = ${bucketId}::uuid`;
    });
    await emitEventSingle({
      namespace: 'capture',
      type: 'bucket.deactivated',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: g.tenantId,
      payload: { bucketId },
    });
    return NextResponse.json({ data: { deactivated: true } });
  } catch (err) {
    console.error('[portal/buckets/:id] DELETE error', err);
    return NextResponse.json({ error: 'Delete failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
