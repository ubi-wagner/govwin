'use client';

/**
 * Scout candidate review→release queue (#176). The single surface an rfp_admin works to turn a
 * scout finding into either a NEW intake (→ RFP curation) or an UPDATE (→ amendment on the matched
 * opportunity), or dismiss it. Each row shows the deterministic NEW/UPDATE classification + the
 * matched opportunity, and the admin releases or dismisses in place.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from '@/lib/toast';
import { TimeAgo } from '@/components/ui/time-ago';

interface Candidate {
  id: string;
  sourceName: string | null;
  kind: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
  discoveredAt: string;
  status: string;
  classification: 'new' | 'update' | 'unknown';
  matchOpportunityId: string | null;
  matchTitle: string | null;
  matchIsActive: boolean | null;
  similarityScore: number | null;
  matchReason: string | null;
  raw: Record<string, unknown>;
}

const CLASS_BADGE: Record<string, string> = {
  new: 'bg-green-100 text-green-700 border-green-300',
  update: 'bg-amber-100 text-amber-700 border-amber-300',
  unknown: 'bg-gray-100 text-gray-600 border-gray-300',
};


function rawStr(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export default function ScoutCandidateQueue() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Per-row release-as-new editor (agency is required to stage intake; findings often lack it).
  const [editing, setEditing] = useState<Record<string, { title: string; agency: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/scout-review');
      if (!res.ok) { toast.error('Failed to load candidates'); return; }
      const json = await res.json();
      setCandidates(json.data?.candidates ?? []);
    } catch { toast.error('Failed to load candidates'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, body: Record<string, unknown>, ok: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/scout-review/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? 'Action failed'); return; }
      toast.success(ok);
      await load();
    } catch { toast.error('Action failed'); }
    finally { setBusy(null); }
  }

  function startReleaseNew(c: Candidate) {
    setEditing((e) => ({
      ...e,
      [c.id]: { title: rawStr(c.raw, 'title') || c.title || '', agency: rawStr(c.raw, 'agency') },
    }));
  }

  if (loading) return <p className="text-sm text-gray-400">Loading candidate opportunities…</p>;

  const pending = candidates.filter((c) => c.status === 'new' || c.status === 'reviewed');

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Candidate opportunities — new or updated</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Scout findings classified against the master list. Release a <b>new</b> one into RFP intake, or
            log an <b>update</b> (amendment) on the matched opportunity.
          </p>
        </div>
        <button onClick={() => void load()} className="text-xs text-blue-600 hover:underline">Refresh</button>
      </div>

      {pending.length === 0 ? (
        <div className="border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center text-sm text-gray-400">
          No candidate opportunities awaiting review. Scout findings land here for a new/update decision.
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((c) => {
            const ed = editing[c.id];
            const isBusy = busy === c.id;
            return (
              <div key={c.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${CLASS_BADGE[c.classification]}`}>
                    {c.classification === 'update' ? 'UPDATE' : c.classification === 'new' ? 'NEW' : 'UNKNOWN'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800">{c.title ?? '(untitled)'}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {c.sourceName ?? 'scout'} · <TimeAgo iso={c.discoveredAt} />
                      {c.url && <> · <a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">source ↗</a></>}
                    </div>
                    {c.snippet && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{c.snippet}</p>}
                    {(c.classification === 'update' || c.classification === 'unknown') && c.matchTitle && (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                        Matches: <b>{c.matchTitle}</b>{c.matchIsActive ? ' (live)' : ''}
                        {c.similarityScore != null && <> · {Math.round(c.similarityScore * 100)}%</>}
                        {c.matchReason && <> · {c.matchReason}</>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Release-as-new inline editor */}
                {ed ? (
                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-gray-600">Title
                        <input value={ed.title} onChange={(e) => setEditing((s) => ({ ...s, [c.id]: { ...ed, title: e.target.value } }))}
                          className="w-full mt-0.5 px-2 py-1 border border-gray-300 rounded text-sm" />
                      </label>
                      <label className="text-xs text-gray-600">Agency <span className="text-red-500">*</span>
                        <input value={ed.agency} onChange={(e) => setEditing((s) => ({ ...s, [c.id]: { ...ed, agency: e.target.value } }))}
                          placeholder="required to stage intake"
                          className="w-full mt-0.5 px-2 py-1 border border-gray-300 rounded text-sm" />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={isBusy || !ed.agency.trim() || !ed.title.trim()}
                        onClick={() => act(c.id, { action: 'release_new', title: ed.title, agency: ed.agency }, 'Staged into RFP intake')}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                        Stage into intake
                      </button>
                      <button onClick={() => setEditing((s) => { const n = { ...s }; delete n[c.id]; return n; })}
                        className="px-3 py-1 text-gray-600 hover:text-gray-800 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button disabled={isBusy} onClick={() => startReleaseNew(c)}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                      Release as new
                    </button>
                    <button disabled={isBusy || !c.matchOpportunityId}
                      title={c.matchOpportunityId ? 'Log an amendment on the matched opportunity' : 'No matched opportunity to update'}
                      onClick={() => act(c.id, { action: 'release_update' }, 'Amendment logged on the matched opportunity')}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-medium rounded">
                      Release as update
                    </button>
                    <button disabled={isBusy} onClick={() => act(c.id, { action: 'classify' }, 'Re-classified')}
                      className="px-3 py-1 border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs rounded">
                      Re-classify
                    </button>
                    <button disabled={isBusy} onClick={() => act(c.id, { action: 'dismiss' }, 'Dismissed')}
                      className="px-3 py-1 border border-gray-300 hover:bg-gray-50 text-gray-500 text-xs rounded ml-auto">
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
