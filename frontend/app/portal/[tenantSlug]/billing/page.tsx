import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import BillingPanel from '@/components/portal/billing-panel';

export const dynamic = 'force-dynamic';

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
    redirect('/portal');
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    redirect('/portal');
  }
  enterTenant(tenantId);

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

  // Purchase history.
  //
  // The titles come from the joins `/api/portal/[tenantSlug]/purchases` has always carried — the
  // route computes `proposal_title` and `opportunity_title` and nothing had ever called it, so a
  // customer with three portal purchases saw three rows reading "Proposal Portal (Phase I) · $0.00 ·
  // Completed", two of them on the same date, with nothing to tell them apart. Query copied from
  // that route rather than rewritten, so the two cannot drift on scoping or ordering.
  interface PurchaseRow {
    id: string;
    productType: string;
    amountCents: number;
    status: string;
    createdAt: string;
    opportunityId: string | null;
    proposalTitle: string | null;
    opportunityTitle: string | null;
  }

  let purchases: PurchaseRow[] = [];
  try {
    purchases = await sql<PurchaseRow[]>`
      SELECT pu.id, pu.product_type, pu.amount_cents, pu.status, pu.created_at, pu.opportunity_id,
             p.title AS proposal_title,
             o.title AS opportunity_title
      FROM purchases pu
      LEFT JOIN proposals p ON p.id = pu.proposal_id
      LEFT JOIN opportunities o ON o.id = pu.opportunity_id
      WHERE pu.tenant_id = ${tenantId}
      ORDER BY pu.created_at DESC
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
        canManageBilling={sessionUser.tenantId === tenantId}
        purchases={purchases.map((p) => ({
          id: p.id,
          productType: p.productType,
          amountCents: p.amountCents,
          status: p.status,
          createdAt: p.createdAt,
          opportunityId: p.opportunityId,
          proposalTitle: p.proposalTitle,
          opportunityTitle: p.opportunityTitle,
        }))}
      />
    </div>
  );
}
