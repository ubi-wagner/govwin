'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ReadinessReport, ReadinessBlocker, BlockerCategory } from '@/lib/proposal/submission-readiness';

interface Props {
  tenantSlug: string;
  proposalId: string;
  /** Bump to force a re-check (e.g. after a lock action elsewhere on the page). */
  refreshKey?: number;
}

const CATEGORY_LABEL: Record<BlockerCategory, string> = {
  deadline: 'Deadline',
  empty_section: 'Not drafted',
  unlocked_section: 'Not locked',
  orphan_requirement: 'Requirement',
  missing_document: 'Missing form',
  page_overflow: 'Over page limit',
  work_split: 'Work-split',
  format_floor: 'Format',
};

const MAX_SHOWN = 8;

/**
 * Submission-readiness — the single "can this go out the door?" verdict for a proposal. Fetches the
 * roll-up from …/proposals/[p]/readiness and renders a GO / NOT-READY banner with an actionable,
 * deep-linked blocker list. Advisory: it reports; it never locks or submits.
 */
export function SubmissionReadinessCard({ tenantSlug, proposalId, refreshKey = 0 }: Props) {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/readiness`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not compute readiness');
        setReport(null);
      } else {
        setReport(j.data as ReadinessReport);
      }
    } catch {
      setError('Could not reach the readiness service');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, proposalId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const blockers = report?.blockers ?? [];
  const hardBlockers = blockers.filter((b) => b.severity === 'blocker');
  const warnings = blockers.filter((b) => b.severity === 'warning');
  const shown = showAll ? hardBlockers : hardBlockers.slice(0, MAX_SHOWN);
  const ready = !!report?.ready;

  const sectionHref = (b: ReadinessBlocker) =>
    b.sectionId ? `/portal/${tenantSlug}/proposals/${proposalId}/sections/${b.sectionId}` : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Submission readiness</h3>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {report && (
        <>
          {/* Verdict banner */}
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-sm font-semibold ${
              ready ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
          >
            <span aria-hidden>{ready ? '✓' : '⚠'}</span>
            {ready
              ? 'Ready to submit — no blockers'
              : `Not ready — ${report.blockerCount} blocker${report.blockerCount === 1 ? '' : 's'}`}
            {report.warningCount > 0 && (
              <span className="ml-auto text-[11px] font-medium text-gray-500">
                {report.warningCount} advisor{report.warningCount === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-3 text-xs mb-3">
            {(() => {
              const d = report.summary.deadline;
              // Optional-chain the whole block: under a rolling-deploy version skew a new client bundle
              // can hit an old route whose report predates `deadline`/`documents` — match the defensive
              // reads used for volumes/cost below rather than white-screening the card on a TypeError.
              if (!d?.closeDate) return <span className="text-gray-400 font-medium">⏱ no deadline set</span>;
              const dr = d.daysRemaining ?? 0;
              const label = d.past
                ? `closed ${Math.abs(dr)}d ago${d.estimated ? ' (est.)' : ''}`
                : `closes in ${dr}d${d.estimated ? ' (est.)' : ''}`;
              const cls = d.past ? 'text-red-600' : dr <= 7 ? 'text-amber-600' : 'text-gray-600';
              return <span className={`${cls} font-medium`} title={new Date(d.closeDate).toLocaleDateString()}>⏱ {label}</span>;
            })()}
            <span className="text-gray-400">·</span>
            <span className="text-emerald-600 font-medium">{report.summary.sections.locked} locked</span>
            <span className="text-amber-600 font-medium">{report.summary.sections.drafted_unlocked} to lock</span>
            <span className="text-red-600 font-medium">{report.summary.sections.empty} empty</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600 font-medium">
              {report.summary.requirements.satisfied}/{report.summary.requirements.mandatory} requirements met
            </span>
            {(report.summary.documents?.required ?? 0) > 0 && (
              <>
                <span className="text-gray-400">·</span>
                <span className={(report.summary.documents?.missing ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>
                  {report.summary.documents?.provided}/{report.summary.documents?.required} forms provided
                </span>
              </>
            )}
          </div>

          {/* Hard-compliance gauges: rendered page count per volume + cost total + STTR work-split */}
          {((report.summary.volumes && report.summary.volumes.length > 0) || report.summary.workSplit || report.summary.cost) && (
            <div className="flex flex-wrap gap-3 text-xs mb-3 border-t border-gray-100 pt-3">
              {(report.summary.volumes ?? []).map((v, i) => (
                <span key={i} className={v.over ? 'text-red-600 font-semibold' : 'text-gray-600 font-medium'}>
                  {v.name}: {v.pages}/{v.max}{v.unit === 'slides' ? ' slides' : 'pp'}{v.over ? ' — over limit' : ''}
                </span>
              ))}
              {report.summary.cost && report.summary.cost.computable && (
                <span className="text-gray-600 font-medium">
                  Total proposed price ${report.summary.cost.totalPrice.toLocaleString('en-US')}
                </span>
              )}
              {report.summary.workSplit && (
                <span className={report.summary.workSplit.ok ? 'text-gray-600 font-medium' : 'text-red-600 font-semibold'}>
                  Work-split SB {report.summary.workSplit.sbPct}% / RI {report.summary.workSplit.riPct}% (min 40 / 30)
                </span>
              )}
            </div>
          )}

          {/* Blocker list */}
          {hardBlockers.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {shown.map((b, i) => {
                const href = sectionHref(b);
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 mt-0.5 inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-medium uppercase tracking-wide">
                      {CATEGORY_LABEL[b.category]}
                    </span>
                    <span className="text-gray-700 flex-1">{b.message}</span>
                    {href && (
                      <Link href={href} className="shrink-0 text-indigo-600 hover:text-indigo-800 font-medium">
                        Open →
                      </Link>
                    )}
                  </div>
                );
              })}
              {hardBlockers.length > MAX_SHOWN && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  {showAll ? 'Show fewer' : `Show all ${hardBlockers.length} blockers`}
                </button>
              )}
            </div>
          )}

          {/* Advisories */}
          {warnings.length > 0 && (
            <details className="mt-1">
              <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-700">
                {warnings.length} advisor{warnings.length === 1 ? 'y' : 'ies'} (won’t block submission)
              </summary>
              <div className="space-y-1 mt-1.5">
                {warnings.slice(0, MAX_SHOWN).map((w, i) => (
                  <div key={i} className="text-[11px] text-gray-500 pl-2">• {w.message}</div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[11px] text-gray-400 mt-2">
            Rolls up section lock state, requirement coverage, required forms, page &amp; mandated-format
            limits, and the cost roll-up. Advisory — clear every blocker before you submit so the proposal
            can’t be administratively disqualified.
          </p>
        </>
      )}
    </div>
  );
}
