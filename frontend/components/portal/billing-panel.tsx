'use client';

import { useState, useTransition } from 'react';

// ─── Types ────────────────────────────────────────────────────────

interface Purchase {
  id: string;
  productType: string;
  amountCents: number;
  status: string;
  createdAt: string;
  opportunityId: string | null;
}

interface BillingPanelProps {
  tenantSlug: string;
  subscriptionStatus: string;
  hasStripeCustomer: boolean;
  purchases: Purchase[];
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatProductType(type: string): string {
  switch (type) {
    case 'finder_subscription':
      return 'Spotlight Subscription';
    case 'proposal_phase1':
      return 'Proposal Portal (Phase 1)';
    case 'proposal_phase2':
      return 'Proposal Portal (Phase 2)';
    default:
      return type;
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'refunded':
      return 'Refunded';
    default:
      return status;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'refunded':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

// ─── Component ────────────────────────────────────────────────────

export default function BillingPanel({
  tenantSlug,
  subscriptionStatus,
  hasStripeCustomer,
  purchases,
}: BillingPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [isCheckoutPending, startCheckoutTransition] = useTransition();
  const [isPortalPending, startPortalTransition] = useTransition();

  function handleSubscribe() {
    setError(null);
    startCheckoutTransition(async () => {
      try {
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productType: 'finder_subscription' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? 'Failed to start checkout');
          return;
        }
        const data = await res.json();
        if (data?.data?.url) {
          window.location.href = data.data.url;
        } else {
          setError('No checkout URL returned');
        }
      } catch {
        setError('Network error');
      }
    });
  }

  function handleManageBilling() {
    setError(null);
    startPortalTransition(async () => {
      try {
        const res = await fetch('/api/stripe/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? 'Failed to open billing portal');
          return;
        }
        const data = await res.json();
        if (data?.data?.url) {
          window.location.href = data.data.url;
        } else {
          setError('No portal URL returned');
        }
      } catch {
        setError('Network error');
      }
    });
  }

  const isActive = subscriptionStatus === 'active';
  const isCanceled = subscriptionStatus === 'canceled';

  return (
    <div className="space-y-8">
      {/* Subscription status card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Spotlight Subscription</h2>

        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-500">Status:</span>
          {isActive ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Active
            </span>
          ) : isCanceled ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Canceled
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              No active subscription
            </span>
          )}
        </div>

        {isActive && (
          <p className="text-sm text-gray-600 mb-4">
            You have access to the curated RFP pipeline and AI scoring. $299/month.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {!isActive && (
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={isCheckoutPending}
              className="px-4 py-2 text-sm rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {isCheckoutPending ? 'Redirecting...' : 'Subscribe to Spotlight ($299/mo)'}
            </button>
          )}

          {hasStripeCustomer && (
            <button
              type="button"
              onClick={handleManageBilling}
              disabled={isPortalPending}
              className="px-4 py-2 text-sm rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300 transition-colors disabled:opacity-50"
            >
              {isPortalPending ? 'Opening...' : 'Manage Billing'}
            </button>
          )}
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* Purchase history */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Purchase History</h2>

        {purchases.length === 0 ? (
          <p className="text-sm text-gray-400">No purchases yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-2 pr-4 font-medium">Product</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatProductType(p.productType)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatCents(p.amountCents)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(p.status)}`}
                      >
                        {formatStatus(p.status)}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
