/**
 * POST /api/admin/shadow-transition — audit an RFP-admin's move between spaces.
 *
 * RFP-admins are the only accounts that switch scope in-session: they DESCEND from
 * the platform into a customer's space (acting there as a company admin) and ASCEND
 * back. Both directions must be audited (see docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md).
 * The client fires this once per transition, alongside the acknowledgment modal.
 *
 * Body: { direction: 'down' | 'up', tenantId?: string }
 *   down → identity:shadow.descended (tenantId = the customer entered)
 *   up   → identity:shadow.ascended  (tenantId = the customer left)
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    // Only RFP-admins descend/ascend; everyone else is singular (no in-session switch).
    if (!hasRoleAtLeast(role, 'rfp_admin')) return NextResponse.json({ error: 'Admin only', code: 'FORBIDDEN' }, { status: 403 });

    let body: { direction?: unknown; tenantId?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const direction = body.direction === 'down' || body.direction === 'up' ? body.direction : null;
    if (!direction) return NextResponse.json({ error: 'direction must be down|up', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenantId = typeof body.tenantId === 'string' && isValidUUID(body.tenantId) ? body.tenantId : null;

    await emitEventSingle({
      namespace: 'identity',
      type: direction === 'down' ? 'shadow.descended' : 'shadow.ascended',
      actor: userActor(u.id, u.email ?? undefined),
      // The event belongs to the customer's audit trail (down) / the one just left (up).
      tenantId,
      payload: { direction, actingAs: 'tenant_admin', platform: 'RFP Pipeline' },
    });

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    console.error('[admin/shadow-transition] error', err);
    return NextResponse.json({ error: 'Failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
