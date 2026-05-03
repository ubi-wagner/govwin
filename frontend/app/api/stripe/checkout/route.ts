import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import {
  createCheckoutSession,
  getOrCreateStripeCustomer,
  type ProductType,
} from '@/lib/stripe';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

const VALID_PRODUCT_TYPES: ProductType[] = [
  'finder_subscription',
  'proposal_phase1',
  'proposal_phase2',
];

export async function POST(request: Request) {
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
      email?: string | null;
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

    // ── Input validation ─────────────────────────────────────────
    let body: { productType?: string; opportunityId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const productType = body.productType as ProductType | undefined;
    if (!productType || !VALID_PRODUCT_TYPES.includes(productType)) {
      return NextResponse.json(
        { error: 'Invalid productType. Must be one of: finder_subscription, proposal_phase1, proposal_phase2', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const opportunityId = body.opportunityId;
    if (
      (productType === 'proposal_phase1' || productType === 'proposal_phase2') &&
      !opportunityId
    ) {
      return NextResponse.json(
        { error: 'opportunityId is required for proposal purchases', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // Fetch tenant details for Stripe customer creation
    const [tenant] = await sql<{ id: string; name: string; slug: string; billingEmail: string | null }[]>`
      SELECT id, name, slug, billing_email FROM tenants WHERE id = ${user.tenantId}
    `;
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const customerEmail = tenant.billingEmail ?? user.email ?? '';
    const customerId = await getOrCreateStripeCustomer(
      tenant.id,
      customerEmail,
      tenant.name,
    );

    const checkoutSession = await createCheckoutSession(
      tenant.id,
      productType,
      {
        tenantSlug: tenant.slug,
        customerId,
        opportunityId: opportunityId ?? undefined,
      },
    );

    if (!checkoutSession.url) {
      return NextResponse.json({ error: 'Failed to create checkout session', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventSingle({
      namespace: 'capture',
      type: 'checkout.started',
      actor: { type: 'user', id: user.id!, email: user.email ?? undefined },
      tenantId: user.tenantId,
      payload: { correlationId: randomUUID(), productType, tenantId: user.tenantId },
    });

    return NextResponse.json({ data: { url: checkoutSession.url } });
  } catch (err) {
    console.error('[stripe/checkout] Error:', err);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
