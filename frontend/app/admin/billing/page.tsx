import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';
import { StatCard, type StatPreview } from '@/components/admin/stat-card';

export const dynamic = 'force-dynamic';

async function safeCount(query: Promise<{ count: number }[]>): Promise<number> {
  try {
    const [row] = await query;
    return Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/billing] count query failed:', e);
    return -1;
  }
}

async function safeSum(query: Promise<{ total: string }[]>): Promise<number> {
  try {
    const [row] = await query;
    return parseInt(row?.total ?? '0', 10);
  } catch (e) {
    console.error('[admin/billing] sum query failed:', e);
    return -1;
  }
}

function formatCents(cents: number): string {
  if (cents === -1) return 'N/A';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
};

const SUBSCRIPTION_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  none: 'bg-gray-100 text-gray-500',
};

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // ── Revenue Overview Metrics ─────────────────────────────────────
  const [
    totalRevenueCents,
    activeSubscriptions,
    pendingPurchases,
    refundedPurchases,
  ] = await Promise.all([
    safeSum(sql<{ total: string }[]>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total
      FROM purchases WHERE status = 'completed'
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM tenants WHERE subscription_status = 'active'
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM purchases WHERE status = 'pending'
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM purchases WHERE status = 'refunded'
    `),
  ]);

  // ── Recent Purchases ─────────────────────────────────────────────
  interface PurchaseRow {
    id: string;
    tenantId: string;
    tenantName: string;
    proposalId: string | null;
    proposalTitle: string | null;
    productType: string;
    amountCents: number;
    status: string;
    createdAt: Date;
  }

  let purchases: PurchaseRow[] = [];
  let purchasesError: string | null = null;

  try {
    purchases = await sql<PurchaseRow[]>`
      SELECT
        pu.id,
        pu.tenant_id,
        t.name AS tenant_name,
        pu.proposal_id,
        p.title AS proposal_title,
        pu.product_type,
        pu.amount_cents,
        pu.status,
        pu.created_at
      FROM purchases pu
      JOIN tenants t ON t.id = pu.tenant_id
      LEFT JOIN proposals p ON p.id = pu.proposal_id
      ORDER BY pu.created_at DESC
      LIMIT 20
    `;
  } catch (e) {
    console.error('[admin/billing] purchases query failed:', e);
    purchasesError = 'Could not load recent purchases.';
  }

  // ── Subscription Status ──────────────────────────────────────────
  interface TenantRow {
    id: string;
    name: string;
    status: string;
    subscriptionStatus: string | null;
    stripeCustomerId: string | null;
    createdAt: Date;
  }

  let tenants: TenantRow[] = [];
  let tenantsError: string | null = null;

  try {
    tenants = await sql<TenantRow[]>`
      SELECT
        id,
        name,
        status,
        subscription_status,
        stripe_customer_id,
        created_at
      FROM tenants
      ORDER BY created_at DESC
    `;
  } catch (e) {
    console.error('[admin/billing] tenants query failed:', e);
    tenantsError = 'Could not load tenant subscriptions.';
  }

  const formatVal = (v: number) => (v === -1 ? 'N/A' : v.toLocaleString());

  // Hover previews built from the recent-purchases / tenants lists already fetched above.
  const revenuePreview: StatPreview = {
    title: 'Recent Completed Purchases',
    items: purchases.filter((p) => p.status === 'completed').slice(0, 6)
      .map((p) => ({ left: p.tenantName, sub: p.proposalTitle ?? p.productType, right: formatCents(p.amountCents) })),
    emptyText: 'No completed purchases',
    href: '/admin/purchases',
  };
  const activeSubsPreview: StatPreview = {
    title: 'Active Subscriptions',
    items: tenants.filter((t) => t.subscriptionStatus === 'active').slice(0, 6)
      .map((t) => ({ left: t.name, right: t.subscriptionStatus ?? '' })),
    emptyText: 'No active subscriptions',
    href: '/admin/tenants',
  };
  const pendingPreview: StatPreview = {
    title: 'Recent Pending Purchases',
    items: purchases.filter((p) => p.status === 'pending').slice(0, 6)
      .map((p) => ({ left: p.tenantName, sub: p.productType, right: formatCents(p.amountCents) })),
    emptyText: 'No pending purchases',
    href: '/admin/purchases',
  };
  const refundedPreview: StatPreview = {
    title: 'Recent Refunds',
    items: purchases.filter((p) => p.status === 'refunded').slice(0, 6)
      .map((p) => ({ left: p.tenantName, sub: p.productType, right: formatCents(p.amountCents) })),
    emptyText: 'No refunds',
    href: '/admin/purchases',
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Billing Management</h1>
        <p className="text-sm text-gray-500 mt-1">Revenue, purchases, and subscription overview</p>
      </header>

      {/* ── Revenue Overview ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Revenue" value={formatCents(totalRevenueCents)} href="/admin/purchases" preview={revenuePreview} />
        <StatCard label="Active Subscriptions" value={formatVal(activeSubscriptions)} href="/admin/tenants" preview={activeSubsPreview} />
        <StatCard label="Pending Purchases" value={formatVal(pendingPurchases)} href="/admin/purchases" preview={pendingPreview} />
        <StatCard label="Refunded" value={formatVal(refundedPurchases)} href="/admin/purchases" preview={refundedPreview} />
      </div>

      {/* ── Recent Purchases ─────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Recent Purchases</h2>
        {purchasesError ? (
          <p className="text-sm text-amber-600 italic">{purchasesError}</p>
        ) : purchases.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No purchases found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Proposal</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tier</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(p.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/tenants/${p.tenantId}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {p.tenantName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">
                      {p.proposalTitle ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {p.productType}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatCents(p.amountCents)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Subscription Status ──────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Subscription Status</h2>
        {tenantsError ? (
          <p className="text-sm text-amber-600 italic">{tenantsError}</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No tenants found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tenant Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Subscription Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Stripe Customer ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{t.status}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SUBSCRIPTION_STYLES[t.subscriptionStatus ?? 'none'] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {t.subscriptionStatus ?? 'none'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono max-w-[180px] truncate">
                      {t.stripeCustomerId ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
