import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { createCustomerPortalSession } from '@/lib/stripe';

/**
 * Creates a Stripe Customer Portal session for the authenticated
 * tenant admin. Returns the portal URL for client-side redirect.
 */
export async function POST() {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
      tenantSlug?: string | null;
    };

    const role: Role | null = isRole(user.role) ? user.role : null;
    if (!role || !user.id) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!user.tenantId) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 });
    }

    // ── Business logic ───────────────────────────────────────────
    const [tenant] = await sql<{ stripeCustomerId: string | null; slug: string }[]>`
      SELECT stripe_customer_id, slug FROM tenants WHERE id = ${user.tenantId}
    `;
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (!tenant.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No billing account found. Please subscribe first.' },
        { status: 400 },
      );
    }

    const returnUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/portal/${tenant.slug}/billing`;

    const portalSession = await createCustomerPortalSession(
      tenant.stripeCustomerId,
      returnUrl,
    );

    return NextResponse.json({ data: { url: portalSession.url } });
  } catch (err) {
    console.error('[stripe/portal] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
