import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { createCustomerPortalSession } from '@/lib/stripe';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

/**
 * Creates a Stripe Customer Portal session for the authenticated
 * tenant admin. Returns the portal URL for client-side redirect.
 */
export async function POST() {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const user = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
      tenantSlug?: string | null;
    };

    const role: Role | null = isRole(user.role) ? user.role : null;
    if (!role || !user.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    if (!user.tenantId) {
      return NextResponse.json({ error: 'No tenant associated with user', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Business logic ───────────────────────────────────────────
    const [tenant] = await sql<{ stripeCustomerId: string | null; slug: string }[]>`
      SELECT stripe_customer_id, slug FROM tenants WHERE id = ${user.tenantId}
    `;
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (!tenant.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No billing account found. Please subscribe first.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const returnUrl = `${(process.env.NEXTAUTH_URL || process.env.AUTH_URL) ?? 'http://localhost:3000'}/portal/${tenant.slug}/billing`;

    const portalSession = await createCustomerPortalSession(
      tenant.stripeCustomerId,
      returnUrl,
    );

    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'billing.portal_opened',
        actor: { type: 'user', id: user.id! },
        tenantId: user.tenantId,
        payload: { correlationId: randomUUID(), tenantId: user.tenantId },
      });
    } catch (evtErr) {
      console.error('[stripe/portal] event emission failed:', evtErr);
    }

    return NextResponse.json({ data: { url: portalSession.url } });
  } catch (err) {
    console.error('[stripe/portal] Error:', err);
    // Card billing is descoped for the founding cohort — surface that clearly instead of a scary 500.
    if (err instanceof Error && /not configured/i.test(err.message)) {
      return NextResponse.json(
        { error: 'Billing management is not available yet — contact support to change your plan.', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
