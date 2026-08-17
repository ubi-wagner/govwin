'use client';

/**
 * Ingest coordination-plan panel (#12) — renders the rfp_ingest_manager's advisory plan.
 *
 * The "Assess readiness" button returns an immediate DETERMINISTIC snapshot; the manager's richer
 * LLM plan (agent plan · blockers · next actions) lands async in the workflow instance. This panel
 * reads it back from GET .../assessment and renders it. It self-hides until a real structured plan
 * exists, and re-fetches when `refreshKey` bumps (so it appears once the async plan lands).
 * Advisory + read-only — nothing here runs an agent or changes state.
 */
import { useCallback, useEffect, useState } from 'react';

interface AgentAction { agent: string; action: string; why: string; priority: number | null }
interface Blocker { area: string; issue: string; fix: string }
interface Assessment {
  stage: string | null;
  readiness: number | null;
  summary: string | null;
  agentPlan: AgentAction[];
  blockers: Blocker[];
  nextActions: string[];
  generatedAt: string | null;
  hasAny: boolean;
}

const AREA_CLS: Record<string, string> = {
  shred: 'bg-amber-100 text-amber-800', extract: 'bg-cyan-100 text-cyan-800',
  matrix: 'bg-violet-100 text-violet-800', skeleton: 'bg-indigo-100 text-indigo-800',
  quality: 'bg-rose-100 text-rose-800',
};

export function IngestPlanPanel({ solId, refreshKey = 0 }: { solId: string; refreshKey?: number }) {
  const [data, setData] = useState<Assessment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/rfp-curation/${solId}/assessment`);
      if (res.ok) { const j = await res.json().catch(() => ({})); setData((j.data as Assessment) ?? null); }
    } catch { /* best-effort — the panel just stays hidden */ } finally { setBusy(false); }
  }, [solId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!data?.hasAny) return null;

  const pct = data.readiness != null ? Math.round(Math.max(0, Math.min(1, data.readiness)) * 100) : null;

  return (
    <div className="mb-4 rounded-lg border border-indigo-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-indigo-900">🤖 Ingest coordination plan</span>
          <span className="text-[11px] text-gray-400">rfp_ingest_manager · advisory</span>
        </div>
        <button onClick={load} disabled={busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-50">
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {data.summary && <p className="mt-2 text-sm text-gray-800">{data.summary}</p>}

      {pct != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-16">Readiness</span>
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden max-w-xs">
            <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-medium text-indigo-800 tabular-nums">{pct}%</span>
        </div>
      )}

      {data.agentPlan.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Run next</p>
          <ul className="mt-1 space-y-1">
            {data.agentPlan.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                {p.priority != null && <span className="text-gray-400 tabular-nums">{p.priority}.</span>}
                <span className="font-mono text-indigo-700">{p.agent}</span>
                <span className="rounded bg-gray-100 px-1 text-[10px] uppercase text-gray-600">{p.action}</span>
                {p.why && <span className="text-gray-600 break-words">— {p.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.blockers.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Blocking release</p>
          <ul className="mt-1 space-y-1">
            {data.blockers.map((b, i) => (
              <li key={i} className="text-xs">
                {b.area && <span className={`mr-1.5 rounded px-1 text-[10px] uppercase ${AREA_CLS[b.area] ?? 'bg-gray-100 text-gray-600'}`}>{b.area}</span>}
                <span className="text-gray-800">{b.issue}</span>
                {b.fix && <span className="text-gray-500"> — fix: {b.fix}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.nextActions.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Next actions</p>
          <ol className="mt-1 list-decimal list-inside space-y-0.5 text-xs text-gray-700">
            {data.nextActions.map((a, i) => <li key={i} className="break-words">{a}</li>)}
          </ol>
        </div>
      )}

      {data.generatedAt && (
        <p className="mt-2 text-[11px] text-gray-400">Generated {new Date(data.generatedAt).toLocaleString()} — advisory; you decide what runs.</p>
      )}
    </div>
  );
}
