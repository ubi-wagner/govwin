/**
 * The gate every delivery route runs first.
 *
 * One function rather than a copy in each route, because it does four things in an order that
 * matters and getting the order wrong is silent:
 *
 *   1. authenticate            — a session, with a role the registry recognises
 *   2. resolve the tenant      — by slug, so the URL cannot name a tenant that does not exist
 *   3. verifyTenantAccess      — membership, or a descended admin's derived shadow membership
 *   4. enterTenant             — pin the RLS context for the rest of the request
 *
 * Step 4 must happen in the ROUTE's own frame, which is why this returns rather than wrapping: the
 * context is per-request and `enterTenant` sets it for the caller's continuation.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────
 * It does not check the ASSIGNMENT. That is a per-project question, RLS cannot express it, and it
 * lives in `lib/delivery/access.ts` where it has its own boundary test. Folding it in here would
 * make the two checks look like one thing and let a future route satisfy the gate while skipping
 * the part RLS does not cover.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { deliveryScope, type DeliveryActor } from './access';

export type GateResult =
  | { error: NextResponse }
  | { actor: DeliveryActor & { role: Role }; tenantSlug: string; email: string | null };

export async function deliveryGate(tenantSlug: string): Promise<GateResult> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;

  if (!(await verifyTenantAccess(u.id, role, tenantId))) {
    return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  }

  // A role with no delivery reach at all is refused HERE rather than returning an empty list from
  // every route below. An empty result and a refusal are different facts, and a partner_user
  // reading "no projects" would reasonably conclude there are none.
  if (deliveryScope({ role, userId: u.id }).kind === 'none') {
    return {
      error: NextResponse.json(
        { error: 'Delivery workspaces are not available to this role', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    };
  }

  enterTenant(tenantId);   // RLS choke point — must run in the caller's frame
  return { actor: { userId: u.id, role, tenantId }, tenantSlug, email: u.email ?? null };
}
