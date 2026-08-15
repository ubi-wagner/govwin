/**
 * GET  /api/portal/[tenantSlug]/buckets  — list the tenant's spotlight buckets
 * POST /api/portal/[tenantSlug]/buckets  — create one { name, description?, criteria? }
 *
 * Customer-defined, atomized-bounded contextual references (mig 096). RLS-scoped.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { rankBucket, sanitizeBucketCriteria } from '@/lib/bucket-ranking';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    const buckets = await withTenant(g.tenantId, async (tx) =>
      tx`SELECT id, name, description, criteria, is_active, created_at, updated_at
         FROM tenant_spotlight_buckets WHERE tenant_id = ${g.tenantId}::uuid AND is_active
         ORDER BY created_at DESC`,
    );
    return NextResponse.json({ data: { buckets } });
  } catch (err) {
    console.error('[portal/buckets] GET error', err);
    return NextResponse.json({ error: 'Failed to load buckets', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_admin');
    if ('error' in g) return g.error;
    let body: { name?: string; description?: string; criteria?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const criteria = sanitizeBucketCriteria(body.criteria);
    const [row] = await withTenant(g.tenantId, async (tx) =>
      tx<Array<{ id: string }>>`
        INSERT INTO tenant_spotlight_buckets (tenant_id, name, description, criteria, created_by)
        VALUES (${g.tenantId}::uuid, ${body.name!}, ${body.description ?? null}, ${sql.json(criteria as Parameters<typeof sql.json>[0])}, ${g.userId}::uuid)
        RETURNING id`,
    );
    // A new bucket changes the tenant's OPP list → the pipeline OnBucketsUpdated
    // workflow deterministically rescores every open card against all active buckets
    // (tenant-side, event-driven). tenantId in the payload keys the rescore.
    await emitEventSingle({
      namespace: 'capture',
      type: 'buckets.updated',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: g.tenantId,
      payload: { tenantId: g.tenantId, bucketId: row.id, action: 'created', name: body.name },
    });
    // Rank the new bucket SYNCHRONOUSLY so it shows a ranked list immediately (the async
    // OnBucketsUpdated workflow above also rescores; this doesn't depend on the pipeline running).
    try { await rankBucket(g.tenantId, row.id, Date.now()); } catch (e) { console.error('[portal/buckets] rank failed (non-fatal)', e); }
    return NextResponse.json({ data: { id: row.id } });
  } catch (err) {
    console.error('[portal/buckets] POST error', err);
    return NextResponse.json({ error: 'Failed to create bucket', code: 'DB_ERROR' }, { status: 500 });
  }
}
