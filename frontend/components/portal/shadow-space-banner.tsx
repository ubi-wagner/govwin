'use client';

/**
 * ShadowSpaceBanner — shown ONLY to an RFP-admin who has descended into a customer's
 * space. Makes the transition unmistakable and audited:
 *   - On first entry this session (per tenant), a modal ACKNOWLEDGMENT so the admin
 *     always knows which space they're in, and it emits identity:shadow.descended.
 *   - A persistent banner while they're down there ("acting as company admin · logged").
 *   - "Return to platform" emits identity:shadow.ascended and goes back to /admin.
 * See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ShadowSpaceBanner({ companyName, tenantId }: { companyName: string; tenantId: string }) {
  const router = useRouter();
  const [ackOpen, setAckOpen] = useState(false);

  const post = useCallback((direction: 'down' | 'up') => {
    // Best-effort audit; never block navigation on it.
    fetch('/api/admin/shadow-transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, tenantId }),
    }).catch(() => {});
  }, [tenantId]);

  /**
   * THE MODAL ONLY. The descend EVENT is no longer emitted from here.
   *
   * It used to be, deduped by this same `sessionStorage` key — which is per TAB, so opening the
   * customer's workspace in a second tab emitted a second `shadow.descended` that nothing would
   * ever match with an ascend. The server now opens the bracket on render (`space_presence`,
   * mig 246), idempotently and per (actor, tenant), which is the correct grain.
   *
   * The acknowledgment is still a per-tab thing — it exists so the admin cannot MISS which space
   * they are in, and a new tab genuinely deserves to be told again.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `shadow_ack_${tenantId}`;
    if (!sessionStorage.getItem(key)) {
      setAckOpen(true);
      sessionStorage.setItem(key, '1');
    }
  }, [tenantId]);

  const ascend = useCallback(() => {
    post('up');
    try { sessionStorage.removeItem(`shadow_ack_${tenantId}`); } catch { /* ignore */ }
    router.push('/admin/dashboard');
  }, [post, router, tenantId]);

  return (
    <>
      {/* Persistent banner — always visible while down in the customer's space. */}
      <div className="flex items-center justify-between gap-3 bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900">
        <span>
          🛡 <strong>Shadow admin.</strong> You&apos;re in <strong>{companyName}</strong>&apos;s space, acting as
          their company admin — everything you do here is logged to their audit trail.
        </span>
        <button
          onClick={ascend}
          className="shrink-0 rounded border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
        >
          Return to platform ↑
        </button>
      </div>

      {/* Entry acknowledgment modal — shown once per session-entry. */}
      {ackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Entering {companyName}&apos;s space</h2>
            <p className="mt-2 text-sm text-gray-600">
              You are descending from the RFP Pipeline platform into <strong>{companyName}</strong>. While here you act
              as their <strong>company admin</strong> — not as an RFP admin — so their data-integrity rules apply to you
              exactly as they would to a real company admin. <strong>Every action you take is recorded to {companyName}&apos;s
              audit trail.</strong>
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={ascend} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel — back to platform
              </button>
              <button onClick={() => setAckOpen(false)} className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700">
                I understand — continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
