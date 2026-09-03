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
import { openPresence, closePresence } from '@/lib/space-presence';

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

    /**
     * DELEGATED, not duplicated. Both events now come from `lib/space-presence`, which owns the
     * open/closed bracket in `space_presence` (mig 246) — so the descend and the ascend cannot be
     * emitted by different code with different scoping, which is exactly how the ascend went
     * missing whenever this route was not called.
     *
     * This route remains the EXPLICIT door (the banner's "Return to platform"). It is no longer
     * the only one: the portal layout opens on render, and the admin layout closes with
     * `left_space` when the actor turns up on the console without pressing anything.
     *
     * `down` needs a tenant — an unscoped descend belongs in nobody's trail, and this route takes
     * its tenantId from the CLIENT, so a missing one is refused rather than recorded as null.
     * `up` needs none: the open bracket already knows which company it was.
     */
    const actor = { id: u.id, email: u.email ?? null };
    if (direction === 'down') {
      if (!tenantId) {
        return NextResponse.json(
          { error: 'tenantId is required to record a descent', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      await openPresence(actor, tenantId, 'shadow', { actingAs: 'tenant_admin', platform: 'RFP Pipeline' });
    } else {
      await closePresence(actor, 'explicit');
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    console.error('[admin/shadow-transition] error', err);
    return NextResponse.json({ error: 'Failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
