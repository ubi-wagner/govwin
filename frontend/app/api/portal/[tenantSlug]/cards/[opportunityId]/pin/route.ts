/**
 * POST   /api/portal/[tenantSlug]/cards/[opportunityId]/pin           — pin = full copy
 * POST   /api/portal/[tenantSlug]/cards/[opportunityId]/pin?action=resync — re-copy after an update
 * DELETE /api/portal/[tenantSlug]/cards/[opportunityId]/pin           — unpin (forward-looking)
 *
 * Pinning copies the global read-only opp folder into the tenant's space and records
 * the manifest on the card (mig 095). RLS-scoped throughout.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { pinCard, unpinCard, resyncPinnedCard } from '@/lib/opportunity-pin';
import { emitEventSingle, userActor } from '@/lib/events';

async function resolve(tenantSlug: string, opportunityId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, 'tenant_user')) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(opportunityId)) return { error: NextResponse.json({ error: 'Invalid opportunity id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, tenantSlug: tenant.slug as string, userId: sessionUser.id, email: sessionUser.email ?? null };
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; opportunityId: string }> }) {
  try {
    const { tenantSlug, opportunityId } = await params;
    const r = await resolve(tenantSlug, opportunityId);
    if ('error' in r) return r.error;
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'resync') {
      const { docs } = await resyncPinnedCard(r.tenantId, r.tenantSlug, opportunityId);
      return NextResponse.json({ data: { resynced: true, docCount: docs.length } });
    }
    const result = await pinCard(r.tenantId, r.tenantSlug, opportunityId);
    if (!result.pinned) return NextResponse.json({ error: 'Card not found for this tenant', code: 'NOT_FOUND' }, { status: 404 });
    // Audit + trigger: a customer pinning a topic is a first-class event (the
    // `capture:topic.pinned` automation rule + admin activity feed both read it).
    await emitEventSingle({
      namespace: 'capture',
      type: 'topic.pinned',
      actor: userActor(r.userId, r.email ?? undefined),
      tenantId: r.tenantId,
      payload: { opportunityId, docCount: result.docs.length },
    });
    return NextResponse.json({ data: { pinned: true, docCount: result.docs.length, docs: result.docs } });
  } catch (err) {
    console.error('[portal/cards/pin] error', err);
    return NextResponse.json({ error: 'Pin failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tenantSlug: string; opportunityId: string }> }) {
  try {
    const { tenantSlug, opportunityId } = await params;
    const r = await resolve(tenantSlug, opportunityId);
    if ('error' in r) return r.error;
    await unpinCard(r.tenantId, opportunityId);
    await emitEventSingle({
      namespace: 'capture',
      type: 'topic.unpinned',
      actor: userActor(r.userId, r.email ?? undefined),
      tenantId: r.tenantId,
      payload: { opportunityId },
    });
    return NextResponse.json({ data: { pinned: false } });
  } catch (err) {
    console.error('[portal/cards/unpin] error', err);
    return NextResponse.json({ error: 'Unpin failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
