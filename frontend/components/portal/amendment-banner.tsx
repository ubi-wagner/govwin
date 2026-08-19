'use client';

/**
 * AmendmentBanner — surfaces confirmed solicitation amendments that were fanned out to THIS proposal
 * and not yet acknowledged. The tenant reviews the compliance delta and acknowledges (tenant_admin+),
 * which clears the banner. Reads GET /amendments; acknowledges via POST { flagId }.
 */
import { useState, useEffect, useCallback } from 'react';

interface DeltaItem {
  change: 'added' | 'removed' | 'changed';
  requirement: string;
  detail: string;
}
interface Flag {
  flagId: string;
  acknowledgedAt: string | null;
  amendmentId: string;
  label: string;
  summary: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  complianceDelta: DeltaItem[];
  detectedAt: string;
  documentId: string | null;
  documentFilename: string | null;
}

const sevTone: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  major: 'bg-amber-100 text-amber-700',
  minor: 'bg-yellow-100 text-yellow-700',
  info: 'bg-gray-100 text-gray-600',
};
const changeTone: Record<string, string> = {
  added: 'text-emerald-700',
  removed: 'text-red-700',
  changed: 'text-amber-700',
};

export function AmendmentBanner({
  tenantSlug,
  proposalId,
  canAcknowledge,
}: {
  tenantSlug: string;
  proposalId: string;
  canAcknowledge: boolean;
}) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/amendments`);
      if (!res.ok) return;
      const j = await res.json();
      setFlags(((j.data?.flags ?? []) as Flag[]).filter((f) => !f.acknowledgedAt));
    } catch {
      /* non-fatal */
    }
  }, [tenantSlug, proposalId]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = useCallback(
    async (flagId: string) => {
      setBusy(flagId);
      setErr(null);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/amendments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flagId }),
        });
        // 409 = already acknowledged (e.g. by a co-admin) → drop it locally too, not an error.
        if (res.ok || res.status === 409) {
          setFlags((prev) => prev.filter((f) => f.flagId !== flagId));
        } else {
          const j = await res.json().catch(() => ({}));
          setErr(j.error || 'Could not acknowledge the change');
        }
      } catch {
        setErr('Network error');
      } finally {
        setBusy(null);
      }
    },
    [tenantSlug, proposalId],
  );

  // The amendment's announcing document (flag-gated signed URL). Popup-blocker-safe:
  // the tab is claimed SYNCHRONOUSLY in the click (window.open after an await is blocked
  // by Safari, and by every browser once transient activation expires), then pointed at
  // the signed URL when it arrives.
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const openDocument = useCallback((amendmentId: string) => {
    if (docBusy) return;
    setErr(null);
    setDocBusy(amendmentId);
    const w = window.open('', '_blank');
    void (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/amendments/${amendmentId}/document`);
        const j = await res.json().catch(() => ({}));
        const url = j?.data?.url as string | undefined;
        if (res.ok && url && w) { w.location.href = url; return; }
        w?.close();
        setErr(j?.error || 'Could not open the amendment document');
      } catch {
        w?.close();
        setErr('Could not open the amendment document');
      } finally {
        setDocBusy(null);
      }
    })();
  }, [tenantSlug, proposalId, docBusy]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (flags.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-600">⚠</span>
        <h3 className="text-sm font-semibold text-amber-900">
          This solicitation was amended — review {flags.length === 1 ? 'the change' : 'the changes'}
        </h3>
      </div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      <ul className="space-y-2">
        {flags.map((f) => (
          <li key={f.flagId} className="rounded border border-amber-200 bg-white px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${sevTone[f.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                    {f.severity}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{f.label}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{f.summary}</p>
                {f.documentFilename && (
                  <button
                    onClick={() => openDocument(f.amendmentId)}
                    disabled={docBusy === f.amendmentId}
                    className="text-[11px] text-indigo-600 hover:underline mt-1 block disabled:opacity-50"
                  >
                    📎 {docBusy === f.amendmentId ? 'Opening…' : `Open ${f.documentFilename}`}
                  </button>
                )}
                {f.complianceDelta.length > 0 && (
                  <button onClick={() => toggle(f.flagId)} className="text-[11px] text-indigo-600 hover:underline mt-1">
                    {expanded.has(f.flagId) ? 'Hide' : 'Show'} {f.complianceDelta.length} compliance change{f.complianceDelta.length > 1 ? 's' : ''}
                  </button>
                )}
                {expanded.has(f.flagId) && (
                  <ul className="mt-1 space-y-1">
                    {f.complianceDelta.map((d, i) => (
                      <li key={i} className="text-[11px] text-gray-600">
                        <span className={`font-semibold uppercase ${changeTone[d.change] ?? 'text-gray-600'}`}>{d.change}</span>
                        {' · '}
                        <span className="font-medium text-gray-800">{d.requirement}</span>
                        {d.detail ? ` — ${d.detail}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {canAcknowledge && (
                <button
                  onClick={() => acknowledge(f.flagId)}
                  disabled={busy === f.flagId}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50"
                >
                  {busy === f.flagId ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!canAcknowledge && (
        <p className="text-[11px] text-amber-700 mt-2">An admin must acknowledge these changes.</p>
      )}
    </div>
  );
}
