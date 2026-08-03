/**
 * Soft-archive lifecycle — POST /api/portal/[tenantSlug]/atoms/[atomId]/archive
 *   { action: 'archive' }  → soft-archive (archived_at = now()): the atom drops out of
 *                            active library lists + counts + draft selection, but the row
 *                            stays indexed in Postgres (reversible; NOT a delete).
 *   { action: 'restore' }  → un-archive (archived_at = NULL).
 *
 * archived_at is ORTHOGONAL to the curation `status` column — this endpoint only ever
 * touches archived_at. Both actions are compare-and-swap (409 when nothing changed) and
 * main-library-only (vault_id IS NULL), per lib/atoms archiveAtom/restoreAtom.
 *
 * Auth: tenant_admin or above with tenant access (mirrors the proposals archive route).
 * Audit: library:atom.archived / library:atom.restored (tenant-scoped).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { archiveAtom, restoreAtom } from '@/lib/atoms';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; atomId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, atomId } = await ctx.params;
    if (!isValidUUID(atomId)) {
      return NextResponse.json({ error: 'Invalid atom id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.action !== 'archive' && body.action !== 'restore') {
      return NextResponse.json({ error: "action must be 'archive' or 'restore'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    try {
      if (body.action === 'archive') {
        const { archived } = await archiveAtom(tenantId, atomId);
        if (!archived) {
          return NextResponse.json({ error: 'Atom is already archived or not found', code: 'CONFLICT' }, { status: 409 });
        }
        await emitEventSingle({
          namespace: 'library',
          type: 'atom.archived',
          actor: userActor(u.id, u.email ?? undefined),
          tenantId,
          payload: { atomId },
        });
        return NextResponse.json({ data: { archived: true } });
      }
      const { restored } = await restoreAtom(tenantId, atomId);
      if (!restored) {
        return NextResponse.json({ error: 'Atom is not archived (nothing to restore)', code: 'CONFLICT' }, { status: 409 });
      }
      await emitEventSingle({
        namespace: 'library',
        type: 'atom.restored',
        actor: userActor(u.id, u.email ?? undefined),
        tenantId,
        payload: { atomId },
      });
      return NextResponse.json({ data: { restored: true } });
    } catch (e) {
      console.error('[portal/atoms/archive] action failed', e);
      return NextResponse.json({ error: 'Archive action failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[portal/atoms/archive] POST error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
