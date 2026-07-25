'use client';

/**
 * LibrarySeedPanel — admin UI for the library-seed-on-provision flow.
 *
 * Rendered in the proposal admin panel's "Library Seed" tab.
 * Shows the live seed job state and drives the admin through:
 *   analyzing       → [spinner]
 *   awaiting_selection → candidate picker
 *   mapping         → [spinner]
 *   awaiting_review → section/atom decision tree + Apply button
 *   applied         → confirmation summary
 *   skipped         → "No matches found" empty state
 *   (null)          → "No seed job" empty state
 */

import { useCallback, useEffect, useState } from 'react';

interface AtomEntry {
  atom_id: string;
  content?: string;
  similarity?: number;
  action: 'reuse' | 'regen' | 'skip';
}

interface SectionMappingEntry {
  source_section_id?: string;
  source_section_title?: string;
  match_score?: number;
  atoms: AtomEntry[];
}

interface CandidateProposal {
  proposal_id: string;
  title: string;
  match_score: number;
  matching_sections?: number;
  section_count?: number;
  top_match_reasons?: string[];
}

interface SeedJob {
  id: string;
  status: string;
  candidateProposals: CandidateProposal[];
  sourceProposalId: string | null;
  sectionMapping: Record<string, SectionMappingEntry>;
  sectionDecisions: Record<string, Record<string, string>>;
  errorMessage: string | null;
  updatedAt: string;
}

interface Props {
  tenantSlug: string;
  proposalId: string;
}

export function LibrarySeedPanel({ tenantSlug, proposalId }: Props) {
  const [job, setJob] = useState<SeedJob | null | undefined>(undefined); // undefined = loading
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local decision overrides: {sectionId: {atomId: action}}
  const [decisions, setDecisions] = useState<Record<string, Record<string, string>>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const baseUrl = `/api/portal/${tenantSlug}/proposals/${proposalId}/seed-job`;

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(baseUrl);
      if (!res.ok) { setJob(null); return; }
      const json = await res.json();
      const fetched: SeedJob | null = json.data ?? null;
      setJob(fetched);
      // Sync local decisions from job
      if (fetched?.sectionDecisions) {
        setDecisions(fetched.sectionDecisions);
      }
    } catch {
      setJob(null);
    }
  }, [baseUrl]);

  // Initial load
  useEffect(() => { fetchJob(); }, [fetchJob]);

  // Poll while analyzing or mapping
  useEffect(() => {
    if (!job || !['analyzing', 'mapping'].includes(job.status)) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const id = setInterval(fetchJob, 4000);
    return () => clearInterval(id);
  }, [job?.status, fetchJob]);

  const handleSelect = useCallback(async (candidateProposalId: string) => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedJobId: job.id, sourceProposalId: candidateProposalId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Selection failed'); return; }
      await fetchJob();
    } catch { setError('Network error'); }
    finally { setBusy(false); }
  }, [job, baseUrl, fetchJob]);

  const handleSkip = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      // Mark the job as skipped via a direct decide call with empty decisions then apply
      await fetch(`${baseUrl}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedJobId: job.id, decisions: {} }),
      });
      // Optimistic update
      setJob((prev) => prev ? { ...prev, status: 'skipped' } : prev);
    } catch { setError('Network error'); }
    finally { setBusy(false); }
  }, [job, baseUrl]);

  const handleDecideAtom = useCallback((sectionId: string, atomId: string, action: string) => {
    setDecisions((prev) => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] ?? {}), [atomId]: action },
    }));
  }, []);

  const handleSaveDecisions = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedJobId: job.id, decisions }),
      });
      if (!res.ok) { const j = await res.json(); setError(j.error ?? 'Save failed'); }
    } catch { setError('Network error'); }
    finally { setBusy(false); }
  }, [job, baseUrl, decisions]);

  const handleApply = useCallback(async () => {
    if (!job) return;
    // Save decisions first, then apply
    setBusy(true);
    setError(null);
    try {
      await fetch(`${baseUrl}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedJobId: job.id, decisions }),
      });
      const res = await fetch(`${baseUrl}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedJobId: job.id }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Apply failed'); return; }
      await fetchJob();
    } catch { setError('Network error'); }
    finally { setBusy(false); }
  }, [job, baseUrl, decisions, fetchJob]);

  const toggleSection = (id: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Loading ───────────────────────────────────────────────────────────
  if (job === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-6">
        <Spinner /> Loading seed job…
      </div>
    );
  }

  // ── No job ─────────────────────────────────────────────────────────
  if (job === null) {
    return (
      <EmptyState
        icon="📚"
        title="No seed job found"
        body="A seed job is created automatically when a proposal is provisioned. If this proposal was created before this feature was added, no seed job exists."
      />
    );
  }

  const btnBase = 'inline-flex items-center justify-center h-7 px-3 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const btnIdle = `${btnBase} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`;
  const btnBlue = `${btnBase} border-blue-500 bg-blue-600 text-white hover:bg-blue-700`;
  const btnGreen = `${btnBase} border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700`;

  // ── Analyzing ─────────────────────────────────────────────────────
  if (job.status === 'analyzing') {
    return (
      <StatusCard icon={<Spinner />} title="Analyzing your library…">
        <p className="text-xs text-gray-500 mt-1">
          The AI is scanning prior proposals for content that matches this opportunity's compliance requirements.
        </p>
      </StatusCard>
    );
  }

  // ── Skipped / no candidates ───────────────────────────────────────
  if (job.status === 'skipped' || (job.status === 'awaiting_selection' && job.candidateProposals.length === 0)) {
    return (
      <EmptyState
        icon="🔍"
        title="No strong matches found"
        body="The AI did not find prior proposals with enough content overlap to recommend seeding. The section drafter will generate fresh content."
      />
    );
  }

  // ── Awaiting selection ────────────────────────────────────────────
  if (job.status === 'awaiting_selection') {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Seed from a prior proposal</p>
          <p className="text-xs text-gray-500 mt-0.5">
            The AI found {job.candidateProposals.length} prior proposal{job.candidateProposals.length !== 1 ? 's' : ''} with content that matches this opportunity's requirements. Select one to map its sections and atoms onto the new build.
          </p>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <div className="space-y-2">
          {job.candidateProposals.map((c) => (
            <div key={c.proposal_id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 truncate">{c.title}</span>
                    <MatchBadge score={c.match_score} />
                  </div>
                  {c.matching_sections != null && c.section_count != null && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {c.matching_sections}/{c.section_count} sections match
                    </p>
                  )}
                  {c.top_match_reasons && c.top_match_reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {c.top_match_reasons.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-[11px] text-gray-500">· {r}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={() => handleSelect(c.proposal_id)}
                  disabled={busy}
                  className={btnBlue}
                >
                  {busy ? 'Selecting…' : 'Select'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={handleSkip} disabled={busy} className={btnIdle}>
          Skip — build from scratch
        </button>
      </div>
    );
  }

  // ── Mapping ───────────────────────────────────────────────────────
  if (job.status === 'mapping') {
    return (
      <StatusCard icon={<Spinner />} title="Mapping sections and atoms…">
        <p className="text-xs text-gray-500 mt-1">
          Mapping source sections and atoms onto this proposal. This takes ~30 seconds.
        </p>
      </StatusCard>
    );
  }

  // ── Awaiting review ───────────────────────────────────────────────
  if (job.status === 'awaiting_review') {
    const sectionEntries = Object.entries(job.sectionMapping ?? {});
    const reuseCount = sectionEntries.reduce((n, [, se]) =>
      n + se.atoms.filter((a) => {
        const ov = decisions[Object.keys(job.sectionMapping).find((k) => k === Object.keys(job.sectionMapping).find((x) => x)) ?? '']?.[a.atom_id];
        return (ov ?? a.action) === 'reuse';
      }).length, 0
    );

    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Review atom mapping</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Choose what to do with each matched atom. Reused atoms appear in
            <span className="text-red-600 italic font-medium mx-1">red italic</span>
            in the canvas for review.
          </p>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <div className="space-y-2">
          {sectionEntries.map(([sectionId, se]) => {
            const isOpen = expandedSections.has(sectionId);
            const sectionDec = decisions[sectionId] ?? {};
            const reuseN = se.atoms.filter((a) => (sectionDec[a.atom_id] ?? a.action) === 'reuse').length;
            const regenN = se.atoms.filter((a) => (sectionDec[a.atom_id] ?? a.action) === 'regen').length;

            return (
              <div key={sectionId} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection(sectionId)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-gray-400">{isOpen ? '▼' : '▶'}</span>
                    <span className="text-xs font-medium text-gray-800 truncate">
                      {se.source_section_title ?? 'Section'}
                    </span>
                    {se.match_score != null && (
                      <MatchBadge score={se.match_score} compact />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[10px]">
                    {reuseN > 0 && <span className="text-emerald-600">{reuseN} reuse</span>}
                    {regenN > 0 && <span className="text-amber-600">{regenN} regen</span>}
                    <span className="text-gray-400">{se.atoms.length} atom{se.atoms.length !== 1 ? 's' : ''}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="divide-y divide-gray-100">
                    {se.atoms.map((atom) => {
                      const currentAction = sectionDec[atom.atom_id] ?? atom.action;
                      return (
                        <div key={atom.atom_id} className="px-3 py-2">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-700 line-clamp-2">
                                {atom.content ? atom.content.slice(0, 180) : '(no content preview)'}
                              </p>
                              {atom.similarity != null && (
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                  {Math.round(atom.similarity * 100)}% similarity
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {(['reuse', 'regen', 'skip'] as const).map((act) => (
                                <button
                                  key={act}
                                  onClick={() => handleDecideAtom(sectionId, atom.atom_id, act)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                    currentAction === act
                                      ? act === 'reuse'
                                        ? 'bg-emerald-600 border-emerald-500 text-white'
                                        : act === 'regen'
                                          ? 'bg-amber-500 border-amber-400 text-white'
                                          : 'bg-gray-500 border-gray-400 text-white'
                                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                  }`}
                                >
                                  {act}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleApply} disabled={busy} className={btnGreen}>
            {busy ? 'Applying…' : `Apply Seed${reuseCount > 0 ? ` (${reuseCount} reuse)` : ''}`}
          </button>
          <button onClick={handleSaveDecisions} disabled={busy} className={btnIdle}>
            Save decisions
          </button>
          <button onClick={handleSkip} disabled={busy} className={btnIdle}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  // ── Applied ───────────────────────────────────────────────────────
  if (job.status === 'applied') {
    const sectionCount = Object.keys(job.sectionMapping ?? {}).length;
    return (
      <StatusCard icon="✓" iconCls="text-emerald-600" title="Library seed applied">
        <p className="text-xs text-gray-500 mt-1">
          {sectionCount} section{sectionCount !== 1 ? 's' : ''} have been pre-populated with reused atoms
          (shown in <span className="text-red-600 italic">red italic</span> in the canvas).
          Review and edit each section before locking.
        </p>
      </StatusCard>
    );
  }

  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
  );
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="text-center py-8">
      <span className="text-3xl">{icon}</span>
      <p className="text-sm font-medium text-gray-700 mt-2">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">{body}</p>
    </div>
  );
}

function StatusCard({
  icon,
  iconCls = 'text-blue-500',
  title,
  children,
}: {
  icon: React.ReactNode;
  iconCls?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
      <span className={`mt-0.5 text-lg ${iconCls}`}>{icon}</span>
      <div>
        <p className="text-sm font-medium text-gray-800">{title}</p>
        {children}
      </div>
    </div>
  );
}

function MatchBadge({ score, compact }: { score: number; compact?: boolean }) {
  const pct = Math.round(score * 100);
  const cls =
    pct >= 70 ? 'bg-emerald-100 text-emerald-700'
    : pct >= 50 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-500';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {compact ? `${pct}%` : `★ ${pct}% match`}
    </span>
  );
}
