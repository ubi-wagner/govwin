'use client';

/**
 * Cockpit client controls (docs/PROVISIONING_WORKSPACE_DESIGN.md, PV-3/PV-5):
 *   • ReleasePanel — overlay picker + advisory-confirm + the two-outcome "Complete & Release".
 *   • SlaCountdown — the live 72h SLA countdown.
 * The overlay CONFIG stays server-side; the panel sends only the chosen template id.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export interface Overlay { id: string; name: string; description: string | null; isDefault: boolean; scope: string }

export function ReleasePanel({
  portalId, tenantName, hasMaster, ready, overlays,
}: {
  portalId: string; tenantName: string; hasMaster: boolean; ready: boolean; overlays: Overlay[];
}) {
  const router = useRouter();
  const [overlayId, setOverlayId] = useState<string>(''); // '' = default single-operator guardrails
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsConfirm = hasMaster && !ready;

  async function release() {
    if (needsConfirm && !confirm) {
      toast('The build-out is below the readiness bar — check the confirm box to release anyway.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/provisioning/${portalId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: needsConfirm ? true : undefined, guardrailTemplateId: overlayId || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json?.error ? `Release failed: ${json.error}` : 'Release failed', 'error');
        return;
      }
      const d = json.data ?? {};
      const parts = ['Released.'];
      const cards = d.buildOut?.cardsRefreshed;
      if (typeof cards === 'number') parts.push(`${cards} tenant card${cards === 1 ? '' : 's'} refreshed.`);
      if (d.tasksCreated != null) parts.push(`${d.tasksCreated} workflow to-do(s) created.`);
      toast.success(parts.join(' '));
      router.refresh();
    } catch {
      toast('Release failed — please retry.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="font-semibold mb-3">Complete &amp; Release</h2>

      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Workflow overlay</label>
      <select
        value={overlayId}
        onChange={(e) => setOverlayId(e.target.value)}
        disabled={busy}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-1"
      >
        <option value="">Default — single-operator build</option>
        {overlays.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}{o.scope === 'tenant' ? ` (${tenantName})` : ''}{o.isDefault ? ' ★' : ''}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-400 mb-4">
        The guardrail overlay frozen onto {tenantName}’s portal (stages, collaborators, nudges).
      </p>

      {needsConfirm ? (
        <label className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5 mb-3">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
          <span>The build-out is below the readiness bar. Release anyway (the build provisions from what’s authored + the code registry).</span>
        </label>
      ) : null}

      <button
        onClick={release}
        disabled={busy || (needsConfirm && !confirm)}
        className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded"
      >
        {busy ? 'Releasing…' : 'Complete & Release'}
      </button>
      <p className="text-xs text-gray-400 mt-2">
        {hasMaster
          ? 'Broadcasts the completed master to all tenants, then provisions this buyer’s portal.'
          : 'Provisions this buyer’s portal (no master OPP to broadcast).'}
      </p>
    </section>
  );
}

export function SlaCountdown({ dueAt }: { dueAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const due = new Date(dueAt).getTime();
  const dueLabel = new Date(dueAt).toLocaleString();
  if (now == null) {
    // SSR / first paint — show the deadline without the live delta (avoids hydration drift).
    // suppressHydrationWarning: toLocaleString renders in the SERVER's TZ in the initial HTML
    // and the viewer's TZ on hydration — a guaranteed text mismatch whenever they differ.
    return <p className="text-sm text-gray-600">Due <span className="font-medium" suppressHydrationWarning>{dueLabel}</span></p>;
  }
  const ms = due - now;
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const tone = overdue ? 'text-red-600' : h < 24 ? 'text-amber-600' : 'text-green-600';
  return (
    <div>
      <p className={`text-lg font-semibold ${tone}`}>
        {overdue ? 'Overdue by ' : ''}{h}h {m}m{overdue ? '' : ' remaining'}
      </p>
      <p className="text-xs text-gray-500 mt-1">Due {dueLabel}</p>
    </div>
  );
}
