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
import { fmtDate } from '@/lib/fmt';

interface PurchaseModalProps {
  tenantSlug: string;
  opportunityId: string;
  title: string;
  /**
   * The card being bought — the denormalized snapshot the customer has been reading in the feed.
   *
   * Optional so a caller with only an id still works, but every caller in the product has the card
   * in hand: this modal was asking for $1,999 against a title and a paragraph of boilerplate, while
   * the close date, page limits, volume structure and build-out readiness sat one prop away.
   */
  card?: Record<string, unknown> | null;
  onClose: () => void;
  onPurchased: (data: { portalId: string; status: string; curationDueAt: string }) => void;
}

/** A card fact worth stating at the moment of purchase, or null when we do not have it. */
function decisionFacts(card: Record<string, unknown> | null | undefined): Array<{ label: string; value: string; alert?: boolean }> {
  if (!card) return [];
  const out: Array<{ label: string; value: string; alert?: boolean }> = [];
  const close = card.closeDate;
  if (typeof close === 'string' && close.trim()) {
    const t = Date.parse(close);
    if (Number.isFinite(t)) {
      const days = Math.ceil((t - Date.now()) / 86_400_000);
      // The estimate flag rides along: a deadline we inferred must not read like one we were told.
      const est = card.datesEstimated === true ? ' (estimated)' : '';
      out.push({
        label: 'Closes',
        value: `${fmtDate(t)}${days >= 0 ? ` · ${days} day${days === 1 ? '' : 's'} left` : ' · closed'}${est}`,
        // A past deadline is the one fact here that should stop someone mid-purchase, so it is not
        // left to read as another gray row. Nothing is BLOCKED — a customer may well want the
        // workspace for a solicitation that reopens, or to reuse the build-out — but they should
        // not find out afterwards.
        alert: days < 0,
      });
    }
  }
  const cs = card.complianceSummary;
  if (cs && typeof cs === 'object' && !Array.isArray(cs)) {
    const c = cs as Record<string, unknown>;
    const num = (k: string) => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? (c[k] as number) : null);
    const tech = num('pageLimitTechnical');
    const vols = num('volumeCount');
    if (tech !== null) out.push({ label: 'Page limit', value: `${tech} pages (technical)` });
    if (vols !== null && vols > 0) out.push({ label: 'Volumes', value: String(vols) });
    const fmt = typeof c.submissionFormat === 'string' ? c.submissionFormat.trim() : '';
    if (fmt) out.push({ label: 'Submission', value: fmt });
  }
  const items = Array.isArray(card.requiredItems) ? (card.requiredItems as unknown[]).filter(Boolean).length : 0;
  if (items > 0) out.push({ label: 'Required items', value: String(items) });
  return out;
}

export default function PurchaseModal({ tenantSlug, opportunityId, title, card, onClose, onPurchased }: PurchaseModalProps) {
  const facts = decisionFacts(card);
  const ready = card?.provisionReady === true;
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

        {/*
          WHAT YOU ARE BUYING INTO — the facts that decide it, at the moment it is decided.

          Every value here already rode the bridge onto the card the customer just clicked. Asking
          someone to commit $1,999 and a fortnight of writing against a title and a price, when the
          deadline and the page limits are one prop away, is the same omission as a ranking with no
          visible reason. Rendered only when we have it: a card the RFP team has not curated yet
          shows nothing, rather than zeros.
        */}
        {(facts.length > 0 || ready) && (
          <div className="mt-3 rounded-lg border border-gray-200 p-3">
            {facts.length > 0 && (
              <dl className="space-y-1">
                {facts.map((f) => (
                  <div key={f.label} className="flex justify-between gap-3 text-xs">
                    <dt className="text-gray-500">{f.label}</dt>
                    <dd className={`text-right font-medium ${f.alert ? 'text-rose-700' : 'text-gray-800'}`}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {ready && (
              <p className={`text-[11px] text-emerald-700 ${facts.length > 0 ? 'mt-2 border-t border-gray-100 pt-2' : ''}`}>
                ✓ Build-out complete — your workspace opens with the compliance matrix, volumes and section molds already in place.
              </p>
            )}
          </div>
        )}

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
