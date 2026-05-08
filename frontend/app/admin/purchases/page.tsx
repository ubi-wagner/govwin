import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PRODUCT_LABELS: Record<string, string> = {
  finder_subscription: 'Spotlight Subscription',
  proposal_phase1: 'Phase I Proposal Portal',
  proposal_phase2: 'Phase II Proposal Portal',
};

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-500',
};

export default async function PurchasesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  interface PurchaseRow {
    id: string;
    tenantId: string;
    tenantName: string;
    productType: string;
    amountCents: number;
    status: string;
    createdAt: Date;
    stripePaymentIntent: string | null;
  }

  let purchases: PurchaseRow[] = [];
  let queryError: string | null = null;

  try {
    purchases = await sql<PurchaseRow[]>`
      SELECT
        pu.id,
        pu.tenant_id,
        t.name AS tenant_name,
        pu.product_type,
        pu.amount_cents,
        pu.status,
        pu.created_at,
        pu.stripe_payment_intent
      FROM purchases pu
      JOIN tenants t ON t.id = pu.tenant_id
      ORDER BY pu.created_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[admin/purchases] query failed:', e);
    queryError = 'Could not load purchases.';
  }

  const totalRevenue = purchases
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Purchases</h1>
        <p className="text-sm text-gray-500 mt-1">
          {queryError
            ? 'Unable to load purchase data'
            : `${purchases.length} purchase${purchases.length !== 1 ? 's' : ''} · $${(totalRevenue / 100).toFixed(2)} total revenue`}
        </p>
      </header>

      {queryError ? (
        <p className="text-sm text-amber-600 italic">{queryError}</p>
      ) : purchases.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No purchases found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tenant</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Stripe</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchases.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tenants/${p.tenantId}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {p.tenantName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {PRODUCT_LABELS[p.productType] ?? p.productType}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    ${(p.amountCents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono max-w-[120px] truncate">
                    {p.stripePaymentIntent ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
