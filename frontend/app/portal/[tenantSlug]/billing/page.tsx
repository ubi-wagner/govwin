import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import BillingPanel from '@/components/portal/billing-panel';

/**
 * Billing page — tenant_admin (or higher) only.
 *
 * Server component that loads subscription status and purchase history,
 * then hands rendering off to the BillingPanel client component.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  // ── Auth ──────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    redirect('/login?error=session');
  }

  // Only tenant_admin or higher can view billing
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    redirect(`/portal/${tenantSlug}/dashboard`);
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    redirect('/login');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/login');
  }

  // ── Data fetching ──────────────────────────────────────────────

  // Subscription status
  let subscriptionStatus = 'none';
  let hasStripeCustomer = false;
  try {
    const [tenantBilling] = await sql<{ subscriptionStatus: string; stripeCustomerId: string | null }[]>`
      SELECT subscription_status, stripe_customer_id FROM tenants WHERE id = ${tenantId}
    `;
    if (tenantBilling) {
      subscriptionStatus = tenantBilling.subscriptionStatus ?? 'none';
      hasStripeCustomer = !!tenantBilling.stripeCustomerId;
    }
  } catch (e) {
    console.error('[billing] subscription status query failed', e);
  }

  // Purchase history
  interface PurchaseRow {
    id: string;
    productType: string;
    amountCents: number;
    status: string;
    createdAt: string;
    opportunityId: string | null;
  }

  let purchases: PurchaseRow[] = [];
  try {
    purchases = await sql<PurchaseRow[]>`
      SELECT id, product_type, amount_cents, status, created_at, opportunity_id
      FROM purchases
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[billing] purchases query failed', e);
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="text-gray-500 mt-1 text-sm mb-6">
        Manage your subscription and view purchase history
      </p>

      <BillingPanel
        tenantSlug={tenantSlug}
        subscriptionStatus={subscriptionStatus}
        hasStripeCustomer={hasStripeCustomer}
        purchases={purchases.map((p) => ({
          id: p.id,
          productType: p.productType,
          amountCents: p.amountCents,
          status: p.status,
          createdAt: p.createdAt,
          opportunityId: p.opportunityId,
        }))}
      />
    </div>
  );
}
