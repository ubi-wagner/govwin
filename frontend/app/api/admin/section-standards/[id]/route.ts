/**
 * DELETE /api/admin/section-standards/[id] — remove (deactivate) a standard
 *
 * Soft delete (is_active=false) so proposals already tagged with this standard
 * keep their `section_type`; the standard just drops out of the active picker.
 * Auth: rfp_admin or above.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id || !hasRoleAtLeast(role, 'rfp_admin')) {
    return NextResponse.json({ error: 'RFP admin access required', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid id format', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const rows = await sql<{ key: string }[]>`
      UPDATE section_standards
      SET is_active = false, updated_at = now()
      WHERE id = ${id}::uuid AND is_active = true
      RETURNING key
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Standard not found or already inactive', code: 'NOT_FOUND' }, { status: 404 });
    }
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'section_standard.deactivated',
        actor: userActor(u.id, u.email),
        tenantId: null,
        payload: { id, key: rows[0].key },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ data: { deactivated: true, key: rows[0].key } });
  } catch (e) {
    console.error('[admin/section-standards/[id]] DELETE failed:', e);
    return NextResponse.json({ error: 'Failed to remove standard', code: 'DB_ERROR' }, { status: 500 });
  }
}
