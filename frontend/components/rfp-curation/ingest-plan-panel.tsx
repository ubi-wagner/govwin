'use client';

/**
 * Ingest coordination-plan overlay (#12) — renders the rfp_ingest_manager's advisory plan.
 *
 * The "Assess readiness" button returns an immediate DETERMINISTIC snapshot; the manager's richer
 * LLM plan (agent plan · blockers · next actions) lands async in the workflow instance. This reads
 * it back from GET .../assessment and renders it through the shared `AdvisoryOverlay` — advisory
 * agent output laid OVER the workspace in the overlay language (dotted accent, summonable,
 * dismissible), not a card blended into the native curation furniture. Recommended agents render as
 * `OverlayVerb` chips (the ActOnSelection language). Self-hides until a real structured plan exists,
 * and re-fetches when `refreshKey` bumps (so it appears once the async plan lands). Advisory +
 * read-only — nothing here runs an agent or changes state.
 */
import { useCallback, useEffect, useState } from 'react';
import { AdvisoryOverlay, OverlayVerb } from '@/components/ui/advisory-overlay';

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

const OVERLAY_ACCENT = '#6d5ef0'; // the overlay-language indigo (matches ov-sections)

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
    } catch { /* best-effort — the overlay just stays hidden */ } finally { setBusy(false); }
  }, [solId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!data?.hasAny) return null;

  const pct = data.readiness != null ? Math.round(Math.max(0, Math.min(1, data.readiness)) * 100) : null;

  return (
    <AdvisoryOverlay
      title="Ingest coordination plan"
      agent="rfp_ingest_manager"
      accent={OVERLAY_ACCENT}
      onRefresh={load}
      busy={busy}
      generatedAt={data.generatedAt}
      summonLabel="Advisory: ingest plan"
    >
      {data.summary && <p className="text-sm text-gray-800">{data.summary}</p>}

      {pct != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-16">Readiness</span>
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden max-w-xs">
            <div className="h-full" style={{ width: `${pct}%`, backgroundColor: OVERLAY_ACCENT }} />
          </div>
          <span className="text-xs font-medium tabular-nums" style={{ color: OVERLAY_ACCENT }}>{pct}%</span>
        </div>
      )}

      {data.agentPlan.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Run next</p>
          <ul className="mt-1 space-y-1">
            {data.agentPlan.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                {p.priority != null && <span className="text-gray-400 tabular-nums">{p.priority}.</span>}
                <span className="font-mono" style={{ color: OVERLAY_ACCENT }}>{p.agent}</span>
                <OverlayVerb label={p.action} accent={OVERLAY_ACCENT} title={`Recommended: ${p.action} ${p.agent}`} />
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
    </AdvisoryOverlay>
  );
}
