'use client';

/**
 * Purchase modal for a proposal workspace on a (pinned) opportunity.
 *
 * Card payment (real Stripe) sits at the top; a secret access / discount code box
 * sits at the BOTTOM — the founding-cohort comp path. Entering a valid comp code
 * (e.g. `rfppipelinetest`) completes the purchase without charging and opens the
 * workspace in "Waiting for RFP Expert Curation". Future percent/amount codes and
 * card checkout ride the same modal.
 */

import { useState } from 'react';

interface PurchaseModalProps {
  tenantSlug: string;
  opportunityId: string;
  title: string;
  onClose: () => void;
  onPurchased: (data: { portalId: string; status: string; curationDueAt: string }) => void;
}

export default function PurchaseModal({ tenantSlug, opportunityId, title, onClose, onPurchased }: PurchaseModalProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'code' | 'card' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completeWithCode = async () => {
    if (!code.trim()) return;
    setBusy('code'); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, promoCode: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'That code could not be applied.'); return; }
      onPurchased(data.data);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(null);
    }
  };

  const payByCard = async () => {
    setBusy('card'); setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productType: 'proposal_phase1', opportunityId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.data?.url) { window.location.href = data.data.url as string; return; }
      setError(data.error || 'Card checkout is not available yet — use an access code below.');
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Purchase proposal workspace</h2>
        <p className="mt-1 text-sm text-gray-600">{title}</p>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-800">RFP-expert-curated proposal build</span>
            <span className="text-gray-500">$1,999</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            One-time. Includes expert curation of your compliance matrix, volumes, and section molds,
            then a guided single-operator draft to a downloadable submission.
          </p>
        </div>

        <button
          onClick={payByCard}
          disabled={busy !== null}
          className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === 'card' ? 'Redirecting…' : 'Pay by card'}
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" /> or <span className="h-px flex-1 bg-gray-200" />
        </div>

        <label className="block text-xs font-medium text-gray-600">Access / discount code</label>
        <div className="mt-1 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') completeWithCode(); }}
            placeholder="Enter code"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={completeWithCode}
            disabled={busy !== null || !code.trim()}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'code' ? 'Applying…' : 'Complete purchase'}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button onClick={onClose} className="mt-4 w-full text-xs text-gray-500 hover:text-gray-800">Cancel</button>
      </div>
    </div>
  );
}
