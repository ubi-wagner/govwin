'use client';

/**
 * AgentWorkforce (#117) — RFP-admin oversight of the AgentFabric archetypes.
 *
 * A roster of every agent: its scope (platform vs tenant), what wakes it, whether it's
 * live/wired/dormant, and its live queue stats (pending·running·done·failed + last run)
 * from agent_task_queue. Tenant-space agents are marked "tenant-bound" — they act with
 * tenant_user authority, discreet to their assigned tenant. This is the surface an RFP
 * admin uses to watch throughput/errors and decide where tuning is needed.
 */
import { useEffect, useState } from 'react';

type Status = 'live' | 'wired' | 'dormant';
type Pod =
  | 'Tenant — build & pursue'
  | 'Master — ingestion (platform)'
  | 'Our-org — RFP-admin ops'
  | 'Our-org — CMS content';
interface Agent {
  role: string;
  label: string;
  scope: 'platform' | 'tenant';
  trigger: string;
  status: Status;
  does: string;
  pod: Pod;
}

const POD_ORDER: Pod[] = [
  'Tenant — build & pursue',
  'Master — ingestion (platform)',
  'Our-org — RFP-admin ops',
  'Our-org — CMS content',
];

// The 21 archetypes registered in the pipeline AgentFabric, grouped by pod. Tenant-scope
// agents are role-bound to their assigned tenant (tenant_user authority; the trigger's
// tenant_id is fixed by the task, never chosen by the model). Platform/our-org agents run at
// our authority on master + cross-tenant data (no tenant to bind), and land into admin review.
const ROSTER: Agent[] = [
  // ── Tenant — build & pursue ──────────────────────────────────────────────
  { role: 'section_drafter', label: 'Section Drafter', scope: 'tenant', trigger: 'Section draft requested (build)', status: 'live', pod: 'Tenant — build & pursue', does: 'Drafts a section grounded on the tenant’s library atoms.' },
  { role: 'compliance_reviewer', label: 'Compliance Reviewer', scope: 'tenant', trigger: 'Compliance check (inline + advance)', status: 'live', pod: 'Tenant — build & pursue', does: 'Checks a draft against the compliance matrix.' },
  { role: 'color_team_reviewer', label: 'Color Team Reviewer', scope: 'tenant', trigger: 'Review requested (advance queue)', status: 'live', pod: 'Tenant — build & pursue', does: 'Red/gold-team review before a stage advance.' },
  { role: 'librarian', label: 'Librarian', scope: 'tenant', trigger: 'Package atomized / document locked', status: 'live', pod: 'Tenant — build & pursue', does: 'Catalogs, scores, dedupes & assesses freshness of new atoms.' },
  { role: 'scoring_strategist', label: 'Scoring Strategist', scope: 'tenant', trigger: 'Card pinned (per-tenant producer)', status: 'live', pod: 'Tenant — build & pursue', does: 'Scores & ranks opportunities into the tenant’s buckets (±15).' },
  { role: 'opportunity_analyst', label: 'Opportunity Analyst', scope: 'tenant', trigger: 'Card pinned (per-tenant producer)', status: 'live', pod: 'Tenant — build & pursue', does: 'Assesses fit of a new opportunity for the tenant.' },
  { role: 'proposal_architect', label: 'Proposal Architect', scope: 'tenant', trigger: 'Proposal created', status: 'live', pod: 'Tenant — build & pursue', does: 'Shapes the response skeleton from the solicitation.' },
  { role: 'capture_strategist', label: 'Capture Strategist', scope: 'tenant', trigger: 'Proposal created', status: 'live', pod: 'Tenant — build & pursue', does: 'Win themes, positioning, teaming & risk register.' },
  { role: 'cost_estimator', label: 'Cost Estimator', scope: 'tenant', trigger: 'Proposal created', status: 'live', pod: 'Tenant — build & pursue', does: 'Cost-volume realism guidance from the solicitation constraints.' },
  { role: 'pp_matcher', label: 'Past-Performance Matcher', scope: 'tenant', trigger: 'Proposal created', status: 'live', pod: 'Tenant — build & pursue', does: 'Surfaces relevant PP atoms & flags teaming gaps.' },
  { role: 'packaging_specialist', label: 'Packaging Specialist', scope: 'tenant', trigger: 'Advanced to final', status: 'live', pod: 'Tenant — build & pursue', does: 'Reviews the final submission package (volumes, forms, format).' },
  { role: 'partner_coordinator', label: 'Partner Coordinator', scope: 'tenant', trigger: 'Collaborator invited', status: 'live', pod: 'Tenant — build & pursue', does: 'Drafts partner welcome/onboarding; flags teaming risks (human-gated).' },
  { role: 'onboarding_agent', label: 'Onboarding Concierge', scope: 'tenant', trigger: 'Application accepted', status: 'live', pod: 'Tenant — build & pursue', does: 'Cold-starts a new tenant: profile, buckets, first atomize, getting-started ToDos.' },
  { role: 'outcome_analyst', label: 'Outcome Analyst', scope: 'tenant', trigger: 'Outcome recorded', status: 'live', pod: 'Tenant — build & pursue', does: 'Win/loss lesson → memory → scoring calibration.' },
  { role: 'research_scout', label: 'Research Scout', scope: 'tenant', trigger: 'Research requested (proposal AI tab)', status: 'live', pod: 'Tenant — build & pursue', does: 'Browses the web incl. DoD sources (SAM.gov/SBIR.gov/DSIP) for market research & prior art; web results injection-fenced, budget-capped, human-gated.' },
  // ── Master — ingestion (platform) ────────────────────────────────────────
  { role: 'opportunity_scout', label: 'Opportunity Scout', scope: 'platform', trigger: 'Opportunities detected (+ crawl findings)', status: 'live', pod: 'Master — ingestion (platform)', does: 'Prioritizes the triage backlog + crawler leads; flags likely updates/amendments.' },
  { role: 'ingest_analyst', label: 'Ingest Analyst', scope: 'platform', trigger: 'RFP uploaded', status: 'live', pod: 'Master — ingestion (platform)', does: 'Shredded solicitation → structured curation draft.' },
  { role: 'matrix_stager', label: 'Matrix Stager', scope: 'platform', trigger: 'RFP uploaded', status: 'live', pod: 'Master — ingestion (platform)', does: 'Curated solicitation → compliance-matrix rows.' },
  { role: 'skeleton_architect', label: 'Skeleton Architect', scope: 'platform', trigger: 'RFP uploaded', status: 'live', pod: 'Master — ingestion (platform)', does: 'Matrix → master response skeleton (tenant architect tailors it).' },
  { role: 'amendment_monitor', label: 'Amendment Monitor', scope: 'platform', trigger: 'Source change detected', status: 'live', pod: 'Master — ingestion (platform)', does: 'Flags compliance-affecting amendments.' },
  // ── Our-org — RFP-admin ops (POD 4) ──────────────────────────────────────
  { role: 'curation_qa', label: 'Curation QA', scope: 'platform', trigger: 'Curation submitted for review', status: 'live', pod: 'Our-org — RFP-admin ops', does: 'Pre-release QC of a curated solicitation before push.' },
  { role: 'ops_digest', label: 'Ops Digest', scope: 'platform', trigger: 'Scheduled — daily', status: 'live', pod: 'Our-org — RFP-admin ops', does: 'Scheduled health digest for master_admin (workforce, pipeline, SLA).' },
  // ── Our-org — CMS content ────────────────────────────────────────────────
  { role: 'content_generator', label: 'Content Generator', scope: 'platform', trigger: 'Content requested', status: 'live', pod: 'Our-org — CMS content', does: 'Drafts new web/social copy from a brief, in our published voice (human-approved).' },
  { role: 'content_curator', label: 'Content Curator', scope: 'platform', trigger: 'Scheduled — weekly (crawl findings)', status: 'live', pod: 'Our-org — CMS content', does: 'The social/web content scout: curates crawler findings into reshare drafts.' },
  { role: 'social_scheduler', label: 'Social Scheduler', scope: 'platform', trigger: 'Scheduled — daily', status: 'live', pod: 'Our-org — CMS content', does: 'Publisher: drafts a week of social posts from published content (human-approved).' },
];

interface Stat { pending: number; running: number; done: number; failed: number; lastRun: string | null }
interface TenantRow { tenantId: string; tenant: string; total: number; done: number; failed: number; active: number; agents: number; lastRun: string | null }

const STATUS_STYLE: Record<Status, string> = {
  live: 'bg-emerald-100 text-emerald-700',
  wired: 'bg-blue-100 text-blue-700',
  dormant: 'bg-gray-100 text-gray-500',
};

export function AgentWorkforce() {
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [byTenant, setByTenant] = useState<TenantRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/admin/agents/workforce')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { setStats(j?.data?.stats ?? {}); setByTenant(j?.data?.byTenant ?? []); })
      .catch(() => { /* stats are best-effort; roster still renders */ })
      .finally(() => setLoaded(true));
  }, []);

  const fmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">
        The AI workforce. <span className="font-medium text-emerald-700">Live</span> agents run today;{' '}
        <span className="font-medium text-blue-700">wired</span> agents have a producer and run on the next
        trigger; <span className="font-medium text-gray-500">dormant</span> agents are registered and awaiting
        wiring. Tenant-space agents are <span className="font-medium">tenant-bound</span> — they act only inside
        their assigned tenant, with tenant-user authority.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Wakes on</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Queue (30d)</th>
              <th className="px-3 py-2 font-medium">Last run</th>
            </tr>
          </thead>
          <tbody>
            {POD_ORDER.flatMap((pod) => [
              <tr key={`pod-${pod}`} className="border-t border-gray-200 bg-gray-50/70">
                <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {pod}
                </td>
              </tr>,
              ...ROSTER.filter((a) => a.pod === pod).map((a) => {
                const s = stats[a.role];
                return (
                  <tr key={a.role} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{a.label}</div>
                      <div className="text-xs text-gray-500">{a.does}</div>
                    </td>
                    <td className="px-3 py-2">
                      {a.scope === 'tenant' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700" title="Role-bound to its assigned tenant (tenant_user authority)">
                          🔒 Tenant-bound
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">Platform</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{a.trigger}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-700 tabular-nums">
                      {s
                        ? <span>{s.pending}·<span className="text-blue-600">{s.running}</span>·<span className="text-emerald-600">{s.done}</span>{s.failed ? <>·<span className="text-rose-600">{s.failed}✕</span></> : null}</span>
                        : <span className="text-gray-300">{loaded ? '0' : '…'}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(s?.lastRun)}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Queue = pending · <span className="text-blue-600">running</span> ·{' '}
        <span className="text-emerald-600">done</span> · <span className="text-rose-600">failed</span> over 30 days.
        Tuning (prompts, guardrails, model per archetype) is managed in the pipeline —
        surfaced here for oversight; an inline tuning editor is the next increment.
      </p>

      {/* Usage rolled up by tenant — which customers are working the agents, how hard. */}
      <h3 className="mt-8 mb-2 text-sm font-semibold text-gray-800">Usage by tenant (30 days)</h3>
      {byTenant.length === 0 ? (
        <p className="text-xs text-gray-400">{loaded ? 'No agent activity yet.' : 'Loading…'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium text-right">Agents used</th>
                <th className="px-3 py-2 font-medium text-right">Total runs</th>
                <th className="px-3 py-2 font-medium text-right">Done</th>
                <th className="px-3 py-2 font-medium text-right">Active</th>
                <th className="px-3 py-2 font-medium text-right">Failed</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {byTenant.map((t) => (
                <tr key={t.tenantId} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-800">{t.tenant}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.agents}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{t.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{t.done}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-600">{t.active}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.failed ? <span className="text-rose-600">{t.failed}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmt(t.lastRun)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">
        This rolls up agent <span className="font-medium">usage</span> (counts, status, timing) forward for
        oversight — never tenant content. Control flows both ways (tune or pause an agent), but to inspect an
        agent&apos;s actual <span className="font-medium">output</span> for a company you descend into its space
        (shadow) — tenant data stays in the tenant (the forward-only bridge).
      </p>
    </div>
  );
}
