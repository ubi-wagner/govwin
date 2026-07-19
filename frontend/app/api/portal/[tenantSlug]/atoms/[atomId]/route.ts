/**
 * GET   /api/portal/[tenantSlug]/atoms/[atomId]        — the atom + tags + members + lineage
 * PATCH /api/portal/[tenantSlug]/atoms/[atomId]        — confirm / add tags, or set status
 *   body { tags?: AtomTagInput[], status? }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { getAtom, confirmTags, viewerFromRole, type AtomTagInput } from '@/lib/atoms';
import { emitEventSingle, userActor } from '@/lib/events';

async function gate(tenantSlug: string, atomId: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(atomId)) return { error: NextResponse.json({ error: 'Invalid atom id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, role, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; atomId: string }> }) {
  try {
    const { tenantSlug, atomId } = await params;
    // Read open to collaborators; getAtom enforces visibility via the viewer.
    const g = await gate(tenantSlug, atomId, 'partner_user');
    if ('error' in g) return g.error;
    const atom = await getAtom(g.tenantId, atomId, viewerFromRole(g.userId, g.role));
    if (!atom) return NextResponse.json({ error: 'Atom not found', code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ data: { atom } });
  } catch (err) {
    console.error('[portal/atoms/:id] GET error', err);
    return NextResponse.json({ error: 'Failed to load atom', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; atomId: string }> }) {
  try {
    const { tenantSlug, atomId } = await params;
    const g = await gate(tenantSlug, atomId, 'tenant_user');
    if ('error' in g) return g.error;
    let body: { tags?: AtomTagInput[]; status?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    let updated = 0;
    if (Array.isArray(body.tags) && body.tags.length > 0) {
      ({ updated } = await confirmTags(g.tenantId, atomId, body.tags, g.userId));
    }
    if (body.status && ['draft', 'approved', 'archived'].includes(body.status)) {
      await withTenant(g.tenantId, async (tx) => {
        await tx`UPDATE library_atoms SET status = ${body.status} WHERE tenant_id = ${g.tenantId}::uuid AND id = ${atomId}::uuid`;
      });
    }
    await emitEventSingle({
      namespace: 'library',
      type: 'atom.curated',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: g.tenantId,
      payload: { atomId, tagsUpdated: updated, status: body.status ?? null },
    });
    return NextResponse.json({ data: { updated, status: body.status ?? null } });
  } catch (err) {
    console.error('[portal/atoms/:id] PATCH error', err);
    return NextResponse.json({ error: 'Update failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
