'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * Who closes each phase, and the sweep (A4).
 *
 * ── THE CONTROL HAS TO STATE THE ASYMMETRY ───────────────────────────────────────────────────
 * A person reading "AI manager" beside a milestone will reasonably assume the AI decides the phase
 * is finished. It does not: the same checks a human's click hits still apply, and the AI can only
 * ADD a reason to stop. If the control does not say that, the customer's model of the feature is
 * wrong in the more dangerous direction.
 *
 * ── AND THE SWEEP REPORTS WHAT IT DECLINED ───────────────────────────────────────────────────
 * Not just what it closed. A sweep that surfaces only its successes makes "nothing to do" and "two
 * phases were held back" look identical, which is how somebody stops reading the result.
 */
export interface GateMilestone {
  id: string;
  code: string | null;
  title: string;
  status: string;
  gateCloser: string;
}

export function GateCloserControl({
  milestones, basePath, canEdit,
}: {
  milestones: GateMilestone[];
  basePath: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Array<{ milestoneId: string; closed: boolean; reason: string }> | null>(null);

  const pending = milestones.filter((m) => m.status === 'pending');
  const aiGated = pending.filter((m) => m.gateCloser === 'ai_manager');

  async function send(body: unknown, okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/gate-closer`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not do that', 'error'); return null; }
      toast(okMsg, 'success');
      router.refresh();
      return json?.data ?? null;
    } catch {
      toast('Could not do that', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">Who closes each phase</h2>
          <p className="text-xs text-gray-500">
            The AI manager runs the same checks your click does — every task done, every deliverable
            accepted. It can only <span className="font-medium">hold a phase back</span>, never let
            one through early.
          </p>
        </div>
        {canEdit && aiGated.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const data = await send({ action: 'sweep' }, 'Sweep complete');
              if (data) setOutcomes(data.outcomes ?? []);
            }}
            className="rounded border border-gray-900 px-2 py-1 text-xs text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Checking…' : `Let it try (${aiGated.length})`}
          </button>
        )}
      </header>

      {pending.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No phases still running.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {pending.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="text-sm text-gray-900">
                {m.code ? <span className="font-mono text-xs text-gray-500">{m.code} </span> : null}
                {m.title}
              </span>
              {canEdit ? (
                <select
                  value={m.gateCloser}
                  disabled={busy}
                  onChange={(e) => void send(
                    { action: 'set', milestoneId: m.id, gateCloser: e.target.value },
                    e.target.value === 'ai_manager' ? 'The AI manager may now close it' : 'You close this one',
                  )}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-xs disabled:opacity-50"
                >
                  <option value="human">A person closes it</option>
                  <option value="ai_manager">AI manager may close it</option>
                </select>
              ) : (
                <span className="text-xs text-gray-500">
                  {m.gateCloser === 'ai_manager' ? 'AI manager may close it' : 'A person closes it'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Both halves. Silence about a decline is what makes a result stop being read. */}
      {outcomes && outcomes.length > 0 && (
        <ul className="space-y-0.5 border-t border-gray-200 bg-gray-50 px-4 py-2">
          {outcomes.map((o) => (
            <li key={o.milestoneId} className={`text-xs ${o.closed ? 'text-emerald-800' : 'text-gray-600'}`}>
              {o.closed ? '✓ ' : '· '}{o.reason}
            </li>
          ))}
        </ul>
      )}
      {outcomes && outcomes.length === 0 && (
        <p className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
          Nothing was assigned to the AI manager, so nothing was checked.
        </p>
      )}
    </section>
  );
}
