'use client';

/**
 * The tenant "Your automation" roll-up (UI-gaps T2/T4/T5). Sits above the grammar editor on
 * /automation and gives the admin an at-a-glance view they never had: policy coverage by scope,
 * the team-wide open ToDo / nudge / escalation board, and what automation config each build
 * actually launched with. Reads GET /api/portal/[slug]/automation-overview (read-only).
 */
import { useEffect, useState } from 'react';

interface Coverage { scope: 'discovery' | 'build'; enabled: number; configured: number; total: number }
interface OverviewTask {
  id: string; title: string; taskType: string; status: string; assigneeRole: string | null;
  dueAt: string | null; nudgeSchedule: number[]; nudgesSent: number;
  entityType: string | null; entityId: string | null; stepName: string | null;
}
interface OverviewPortal {
  id: string; label: string; status: string; currentStageIndex: number;
  agentFirst: boolean; rfpOversight: boolean; stageCount: number; nudgeDays: number[]; managerCount: number;
}
interface Overview { coverage: Coverage[]; tasks: OverviewTask[]; portals: OverviewPortal[]; openTotal: number; escalatedTotal: number }

function relDue(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: 'no due date', overdue: false };
  const due = new Date(iso).getTime();
  const diffMs = due - Date.now();
  const overdue = diffMs < 0;
  const days = Math.round(Math.abs(diffMs) / 86400000);
  const label = days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  return { text: overdue ? `${label} overdue` : `due in ${label}`, overdue };
}

/**
 * What a ToDo is ABOUT, in the reader's words.
 *
 * `entityType` is the internal name of the row a task points at, and it was rendered raw — a
 * customer's automation panel read `· project_modification`. That is the same defect as 48 library
 * atoms titled `bulleted_list` and a `doc:<uuid>` chip: our vocabulary on their screen, in a place
 * they are meant to read rather than debug. The `customer-finish` probe grades it as `jargon`.
 *
 * Unknown types fall back to the token with its underscores opened out — a noun a person can at
 * least read — rather than being hidden. Hiding would make a new entity type silently lose its
 * label, and a missing word is harder to notice than an ugly one.
 */
const ENTITY_NOUN: Record<string, string> = {
  proposal: 'proposal',
  proposal_section: 'section',
  solicitation: 'solicitation',
  opportunity: 'opportunity',
  project: 'project',
  project_milestone: 'milestone',
  project_deliverable: 'deliverable',
  project_modification: 'contract modification',
  project_invoice: 'invoice',
  contract: 'contract',
  library_atom: 'library item',
  task: 'to-do',
};

function entityNoun(t: string): string {
  return ENTITY_NOUN[t] ?? t.replace(/_/g, ' ');
}

export function AutomationOverviewCard({ tenantSlug }: { tenantSlug: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/automation-overview`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: 'Failed to load' }));
          if (!cancelled) setError(j.error || 'Failed to load automation overview');
          return;
        }
        const j = await res.json();
        if (!cancelled) setData(j.data as Overview);
      } catch {
        if (!cancelled) setError('Network error loading automation overview');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  if (loading) return <div className="text-sm text-gray-400 py-6">Loading your automation…</div>;
  if (error) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-6">{error}</div>;
  if (!data) return null;

  // TRUE totals over ALL open tasks (the board list below caps at 30) — the "across your team"
  // tiles must count everything, not just the rendered slice (sweep D2/D3).
  const openTotal = data.openTotal;
  const escalated = data.escalatedTotal;

  return (
    <div className="space-y-4 mb-8">
      {/* Coverage tiles + headline counts */}
      <div className="grid gap-3 sm:grid-cols-4">
        {data.coverage.map((c) => (
          <div key={c.scope} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {c.scope === 'discovery' ? 'Discovery alerts' : 'Build gates'}
            </div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{c.enabled}<span className="text-base font-normal text-gray-400">/{c.total} on</span></div>
            <div className="text-[11px] text-gray-500">{c.configured} customized</div>
          </div>
        ))}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Open ToDos</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{openTotal}</div>
          <div className="text-[11px] text-gray-500">across your team</div>
        </div>
        <div className={`rounded-lg border p-4 ${escalated > 0 ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Escalated</div>
          <div className={`mt-1 text-2xl font-bold ${escalated > 0 ? 'text-rose-700' : 'text-gray-900'}`}>{escalated}</div>
          <div className="text-[11px] text-gray-500">overdue / final nudge</div>
        </div>
      </div>

      {/* Team ToDo / nudge / escalation board */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900">Team ToDos &amp; nudges</h2>
        <p className="text-xs text-gray-500 mb-3">
          {openTotal > data.tasks.length ? `Top ${data.tasks.length} of ${openTotal} open tasks (soonest-due first)` : 'Your open automation tasks (soonest-due first)'}, with nudge stage and escalation state.
        </p>
        {data.tasks.length === 0 ? (
          <div className="text-sm text-gray-400 py-3">No open automation ToDos right now.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.tasks.map((t) => {
              const due = relDue(t.dueAt);
              const finalNudge = t.nudgeSchedule.length > 0 && t.nudgesSent >= t.nudgeSchedule.length;
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-800 truncate">{t.title}</div>
                    <div className="text-[11px] text-gray-400">
                      {t.assigneeRole ? t.assigneeRole.replace('_', ' ') : 'unassigned'}
                      {t.entityType ? ` · ${entityNoun(t.entityType)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.nudgeSchedule.length > 0 && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                        nudge {t.nudgesSent}/{t.nudgeSchedule.length}
                      </span>
                    )}
                    {(due.overdue || finalNudge) && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                        {due.overdue ? 'escalated' : 'final nudge'}
                      </span>
                    )}
                    <span className={`text-[11px] ${due.overdue ? 'text-rose-600 font-medium' : 'text-gray-500'}`}>{due.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-portal automation config, read back from guardrail_config */}
      {data.portals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-900">Automation per build</h2>
          <p className="text-xs text-gray-500 mb-3">What each proposal build launched with — its phases, nudge cadence, delegated managers, and oversight.</p>
          <div className="space-y-2">
            {data.portals.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-gray-800 truncate">{p.label}</div>
                  <div className="text-[11px] text-gray-400">{p.status.replace('_', ' ')}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                  {p.agentFirst && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Agent-first</span>}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p.rfpOversight ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.rfpOversight ? 'RFP oversight' : 'oversight off'}
                  </span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{p.stageCount || '—'} phases</span>
                  {p.nudgeDays.length > 0 && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">nudges [{p.nudgeDays.join(',')}]</span>}
                  {p.managerCount > 0 && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{p.managerCount} mgr{p.managerCount > 1 ? 's' : ''}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
