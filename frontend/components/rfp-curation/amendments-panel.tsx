'use client';

/**
 * AmendmentsPanel — admin review surface for solicitation amendments (M3).
 * Log a detected amendment (label + summary + severity + a structured compliance delta), then CONFIRM
 * it to fan out to every proposal built from the solicitation (each tenant must acknowledge), or
 * DISMISS a false positive. Shows per-amendment fan-out stats (flagged / acknowledged).
 */
import { useState, useEffect, useCallback } from 'react';

type Change = 'added' | 'removed' | 'changed';
interface DeltaItem { change: Change; requirement: string; detail: string }
interface Amendment {
  id: string;
  label: string;
  summary: string;
  complianceDelta: DeltaItem[];
  severity: 'critical' | 'major' | 'minor' | 'info';
  source: string;
  status: 'detected' | 'confirmed' | 'dismissed';
  detectedAt: string;
  reviewedAt: string | null;
  documentId: string | null;
  documentFilename: string | null;
  flagged: number;
  acknowledged: number;
}
interface SolDoc { id: string; originalFilename: string; documentType: string }

const sevTone: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  major: 'bg-amber-100 text-amber-700',
  minor: 'bg-yellow-100 text-yellow-700',
  info: 'bg-gray-100 text-gray-600',
};
const statusTone: Record<string, string> = {
  detected: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-gray-200 text-gray-500',
};

export function AmendmentsPanel({ solId, documents = [] }: { solId: string; documents?: SolDoc[] }) {
  const [items, setItems] = useState<Amendment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Log form state
  const [label, setLabel] = useState('');
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState<Amendment['severity']>('major');
  const [delta, setDelta] = useState<DeltaItem[]>([]);
  // Optional announcing document (mig 190): attach the file via the Documents section
  // (type "Amendment"), then link it here so tenants can OPEN what they're told about.
  // The list comes from the WORKSPACE's `documents` prop (fresh across router.refresh()) —
  // a local one-shot fetch went permanently stale the moment a new file was attached,
  // defeating exactly the upload-then-link flow this select prescribes.
  const [docId, setDocId] = useState('');
  const docs = documents;

  const base = `/api/admin/rfp-curation/${solId}/amendments`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const j = await res.json();
      setItems((j.data?.amendments ?? []) as Amendment[]);
    } catch {
      /* non-fatal */
    }
  }, [base]);

  // Open the announcing document. Popup-blocker-safe: claim the tab SYNCHRONOUSLY inside
  // the click, then point it at the signed URL once fetched (window.open after an await is
  // blocked by Safari + by any browser once transient activation expires).
  const openDocument = (documentId: string) => {
    const w = window.open('', '_blank');
    void (async () => {
      try {
        const res = await fetch(`/api/admin/rfp-document/${documentId}/signed-url`);
        const j = await res.json().catch(() => ({}));
        const url = j?.data?.url as string | undefined;
        if (res.ok && url && w) { w.location.href = url; return; }
        w?.close();
        setMsg({ type: 'error', text: j?.error ?? 'Could not open the document' });
      } catch {
        w?.close();
        setMsg({ type: 'error', text: 'Could not open the document' });
      }
    })();
  };

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!label.trim() || !summary.trim()) {
      setMsg({ type: 'error', text: 'Label and summary are required.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(), summary: summary.trim(), severity,
          complianceDelta: delta.filter((d) => d.requirement.trim()),
          ...(docId ? { documentId: docId } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: 'error', text: j.error || 'Failed to log amendment' });
        return;
      }
      setLabel('');
      setSummary('');
      setSeverity('major');
      setDelta([]);
      setDocId('');
      setShowForm(false);
      setMsg({ type: 'success', text: 'Amendment logged. Confirm it to notify affected tenants.' });
      await load();
    } catch {
      setMsg({ type: 'error', text: 'Network error' });
    } finally {
      setBusy(false);
    }
  }, [base, label, summary, severity, delta, docId, load]);

  const act = useCallback(
    async (id: string, action: 'confirm' | 'dismiss') => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch(`${base}/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg({ type: 'error', text: j.error || 'Action failed' });
          return;
        }
        if (action === 'confirm') {
          setMsg({ type: 'success', text: `Confirmed — fanned out to ${j.data?.flagged ?? 0} proposal(s) across ${j.data?.tenants ?? 0} tenant(s).` });
        } else {
          setMsg({ type: 'success', text: 'Amendment dismissed.' });
        }
        await load();
      } catch {
        setMsg({ type: 'error', text: 'Network error' });
      } finally {
        setBusy(false);
      }
    },
    [base, load],
  );

  const addDeltaRow = () => setDelta((d) => [...d, { change: 'changed', requirement: '', detail: '' }]);
  const setDeltaRow = (i: number, patch: Partial<DeltaItem>) =>
    setDelta((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeDeltaRow = (i: number) => setDelta((d) => d.filter((_, idx) => idx !== i));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Amendments</h3>
          <p className="text-xs text-gray-500">Log a compliance-affecting change, then confirm to notify affected tenants.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-300 rounded-md hover:bg-indigo-50"
        >
          {showForm ? 'Cancel' : '+ Log amendment'}
        </button>
      </div>

      {msg && <p className={`text-xs mb-3 ${msg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}

      {showForm && (
        <div className="mb-4 rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50/60">
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Amendment 0002"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Amendment['severity'])} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="critical">critical</option>
              <option value="major">major</option>
              <option value="minor">minor</option>
              <option value="info">info</option>
            </select>
          </div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Summary of what changed…"
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <div className="space-y-1">
            {delta.map((row, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <select value={row.change} onChange={(e) => setDeltaRow(i, { change: e.target.value as Change })} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                  <option value="added">added</option>
                  <option value="removed">removed</option>
                  <option value="changed">changed</option>
                </select>
                <input value={row.requirement} onChange={(e) => setDeltaRow(i, { requirement: e.target.value })} placeholder="requirement" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
                <input value={row.detail} onChange={(e) => setDeltaRow(i, { detail: e.target.value })} placeholder="detail" className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
                <button onClick={() => removeDeltaRow(i)} className="text-gray-400 hover:text-red-500 text-xs px-1">✕</button>
              </div>
            ))}
            <button onClick={addDeltaRow} className="text-[11px] text-indigo-600 hover:underline">+ add compliance change</button>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500 shrink-0">Announcing document</label>
              <select
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs"
              >
                <option value="">— none —</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>{d.originalFilename} ({d.documentType})</option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              Upload the amendment file in{' '}
              <a href="#section-documents" className="text-indigo-600 hover:underline">Source Documents</a>
              {' '}(type &ldquo;Amendment&rdquo;), then pick it here — tenants open it from their banner.
            </p>
          </div>
          <div className="flex justify-end">
            <button onClick={submit} disabled={busy} className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Log amendment'}
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-gray-400">No amendments logged for this solicitation.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="rounded-lg border border-gray-100 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${statusTone[a.status]}`}>{a.status}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${sevTone[a.severity]}`}>{a.severity}</span>
                    <span className="text-sm font-medium text-gray-900">{a.label}</span>
                    {a.status === 'confirmed' && (
                      <span className="text-[11px] text-gray-500">· {a.acknowledged}/{a.flagged} acknowledged</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{a.summary}</p>
                  {a.documentFilename && a.documentId && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); openDocument(a.documentId!); }}
                      className="text-[11px] text-indigo-600 hover:underline mt-0.5 block"
                      title="Open the announcing document (verify you linked the right file)"
                    >
                      📎 {a.documentFilename}
                    </button>
                  )}
                  {a.complianceDelta.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {a.complianceDelta.map((d, i) => (
                        <li key={i} className="text-[11px] text-gray-500">
                          <span className="font-semibold uppercase">{d.change}</span> · <span className="text-gray-700">{d.requirement}</span>{d.detail ? ` — ${d.detail}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {a.status === 'detected' && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => act(a.id, 'confirm')} disabled={busy} className="px-2.5 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50">Confirm → notify</button>
                    <button onClick={() => act(a.id, 'dismiss')} disabled={busy} className="px-2.5 py-1 text-[11px] font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">Dismiss</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
