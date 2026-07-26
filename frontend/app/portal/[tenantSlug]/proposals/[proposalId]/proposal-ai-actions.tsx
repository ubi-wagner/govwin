'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  tenantSlug: string;
  proposalId: string;
  stage: string;
  userRole: 'admin' | 'contributor' | 'external';
  isLocked: boolean;
};

// ── Proposal Draft Manager (P3) — mode + voice controls ─────────────────
// Mode picker → the pipeline workflow branch (OnFullDraftRequested{A,B,C});
// Voice multi-select → proposals.voice, threaded into narrative drafting.
const DRAFT_MODE_OPTIONS: {
  value: 'a' | 'b' | 'c';
  label: string;
  version: string;
  desc: string;
}[] = [
  { value: 'a', label: 'A · HITL + AI', version: 'V0.1', desc: 'Stage ranked atoms + merge — you drive section-by-section.' },
  { value: 'b', label: 'B · Restyle', version: 'V0.2', desc: 'Controlled restyle + reformat — locking sets the style.' },
  { value: 'c', label: 'C · Full auto', version: 'V0.5', desc: 'Full auto-draft across volumes + the review gate cohort.' },
];

const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'passive', label: 'Passive' },
  { value: 'persuasive', label: 'Persuasive' },
  { value: 'technical', label: 'Technical' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'research', label: 'Research' },
  { value: 'development', label: 'Development' },
];

export function ProposalAiActions({
  tenantSlug,
  proposalId,
  stage,
  userRole,
  isLocked,
}: Props) {
  const router = useRouter();
  const [draftLoading, setDraftLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Full-draft (Proposal Draft Manager) state
  const [fullDraftMode, setFullDraftMode] = useState<'a' | 'b' | 'c'>('a');
  const [voice, setVoice] = useState<string[]>([]);
  const [fullDraftLoading, setFullDraftLoading] = useState(false);
  const [fullDraftMsg, setFullDraftMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Research (R&D scout) state
  const [researchQ, setResearchQ] = useState('market research, prior art, and the competitor landscape for this opportunity');
  const [researching, setResearching] = useState(false);
  const [brief, setBrief] = useState<any | null>(null);
  const [researchErr, setResearchErr] = useState<string | null>(null);

  // Outcome state
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<
    'awarded' | 'rejected' | 'withdrawn' | null
  >(null);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [outcomeRecorded, setOutcomeRecorded] = useState(false);

  const isAdmin = userRole === 'admin';

  // AI Draft: available for admin when not locked
  const canDraft = isAdmin && !isLocked;
  // Outcome: available for admin only when the proposal is in a stage the
  // outcome route accepts as a precondition (submitted | final). It 409s on
  // 'archived' (outcome already recorded) and 400s on any other stage, so
  // those must not surface the panel.
  const canRecordOutcome =
    isAdmin && ['submitted', 'final'].includes(stage);

  const handleDraft = useCallback(async () => {
    if (!canDraft || draftLoading) return;
    setDraftLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/ai/draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setMessage({ type: 'error', text: err.error || 'Draft failed' });
      } else {
        const json = await res.json();
        const count = json.data?.sections_queued ?? 0;
        if (count === 0) {
          setMessage({
            type: 'success',
            text: 'No empty sections to draft.',
          });
        } else {
          setMessage({
            type: 'success',
            text: `AI drafting queued for ${count} section${count > 1 ? 's' : ''}. Content will update shortly.`,
          });
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setDraftLoading(false);
    }
  }, [canDraft, draftLoading, tenantSlug, proposalId]);

  const toggleVoice = useCallback((token: string) => {
    setVoice((prev) =>
      prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token],
    );
  }, []);

  const handleFullDraft = useCallback(async () => {
    if (!canDraft || fullDraftLoading) return;
    setFullDraftLoading(true);
    setFullDraftMsg(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/full-draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: fullDraftMode, voice }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setFullDraftMsg({
          type: 'error',
          text: err.error || 'Full draft request failed',
        });
      } else {
        setFullDraftMsg({
          type: 'success',
          text: `Full draft (Mode ${fullDraftMode.toUpperCase()}) requested. Drafts land in review — watch the section version history as they arrive.`,
        });
      }
    } catch {
      setFullDraftMsg({ type: 'error', text: 'Network error' });
    } finally {
      setFullDraftLoading(false);
    }
  }, [canDraft, fullDraftLoading, fullDraftMode, voice, tenantSlug, proposalId]);

  const handleResearch = useCallback(async () => {
    if (researching || !researchQ.trim()) return;
    setResearching(true); setResearchErr(null); setBrief(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/ai/research`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: researchQ.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setResearchErr(json.error || 'Research failed'); setResearching(false); return; }
      const taskId = json.data?.taskId;
      // Poll for the brief (the scout runs in the pipeline: browse → fence → synthesize).
      const started = Date.now();
      const poll = async () => {
        try {
          const r = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/ai/research?taskId=${taskId}`);
          const j = await r.json();
          const st = j.data?.status;
          if (st && st !== 'running' && st !== 'queued') {
            let result = j.data?.result;
            if (typeof result === 'string') { try { result = JSON.parse(result); } catch { /* keep string */ } }
            setBrief(result ?? { summary: 'The scout returned no result.' });
            setResearching(false); return;
          }
        } catch { /* keep polling */ }
        if (Date.now() - started > 90_000) { setResearchErr('Research is taking longer than expected — check back shortly (it keeps running in the background).'); setResearching(false); return; }
        setTimeout(poll, 4000);
      };
      setTimeout(poll, 3000);
    } catch {
      setResearchErr('Network error'); setResearching(false);
    }
  }, [researching, researchQ, tenantSlug, proposalId]);

  const handleOutcome = useCallback(async () => {
    if (!selectedOutcome || outcomeLoading) return;
    setOutcomeLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/outcome`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome: selectedOutcome,
            notes: outcomeNotes.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setMessage({
          type: 'error',
          text: err.error || 'Failed to record outcome',
        });
      } else {
        const json = await res.json();
        const atomsUpdated = json.data?.atomsUpdated ?? 0;
        setOutcomeRecorded(true);
        setMessage({
          type: 'success',
          text: `Outcome recorded as "${selectedOutcome}". ${atomsUpdated} library atom${atomsUpdated !== 1 ? 's' : ''} updated.`,
        });
        router.refresh();
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setOutcomeLoading(false);
    }
  }, [selectedOutcome, outcomeLoading, outcomeNotes, tenantSlug, proposalId, router]);

  if (!isAdmin) return null;

  const outcomeOptions: {
    value: 'awarded' | 'rejected' | 'withdrawn';
    label: string;
    color: string;
    activeColor: string;
  }[] = [
    {
      value: 'awarded',
      label: 'Won',
      color: 'border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50',
      activeColor: 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500',
    },
    {
      value: 'rejected',
      label: 'Lost',
      color: 'border-gray-200 text-gray-600 hover:border-red-300 hover:bg-red-50',
      activeColor: 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500',
    },
    {
      value: 'withdrawn',
      label: 'Withdrawn',
      color: 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50',
      activeColor: 'border-amber-500 bg-amber-50 text-amber-700 ring-1 ring-amber-500',
    },
  ];

  return (
    <div className="space-y-5">
      {/* ── AI Actions ──────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          AI Actions
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Use AI to draft empty sections or review existing content for quality
          and compliance.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleDraft}
            disabled={!canDraft || draftLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-indigo-200 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {draftLoading ? (
              <span className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
            ) : (
              <span className="text-indigo-400">&#x2726;</span>
            )}
            {draftLoading ? 'Drafting...' : 'Draft with AI'}
          </button>

          {/* AI color-team review runs via the pipeline agent workforce, which
              is built but not yet wired for V1. Disabled rather than emitting a
              request that nothing processes (admins review sections manually
              during the review stage). */}
          <button
            type="button"
            disabled
            title="AI color-team review is coming soon. During the review stage an admin reviews sections."
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
          >
            <span className="text-gray-300">&#x2726;</span>
            AI Review (coming soon)
          </button>
        </div>
      </div>

      {/* ── Run full draft (Proposal Draft Manager) ─────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Run full draft</h3>
        <p className="text-sm text-gray-500 mb-4">
          The Proposal Draft Manager plans from the skeleton, compliance matrix, and your
          library, then drafts across the proposal. Every output lands in review (redlined
          &amp; reversible) — it never advances a gate on its own.
        </p>

        {/* Mode picker */}
        <fieldset className="mb-4">
          <legend className="text-xs font-medium text-gray-700 mb-2">Mode</legend>
          <div className="space-y-2">
            {DRAFT_MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  fullDraftMode === opt.value
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                    : 'border-gray-200 hover:border-indigo-300'
                }`}
              >
                <input
                  type="radio"
                  name="full-draft-mode"
                  value={opt.value}
                  checked={fullDraftMode === opt.value}
                  onChange={() => setFullDraftMode(opt.value)}
                  disabled={fullDraftLoading}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                    <span className="text-xs font-semibold text-indigo-600">{opt.version}</span>
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Voice multi-select */}
        <fieldset className="mb-4">
          <legend className="text-xs font-medium text-gray-700 mb-2">
            Voice of Proposal <span className="font-normal text-gray-400">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {VOICE_OPTIONS.map((opt) => {
              const active = voice.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleVoice(opt.value)}
                  disabled={fullDraftLoading}
                  aria-pressed={active}
                  className={`px-3 py-1.5 text-xs font-medium border rounded-full transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500'
                      : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Threaded into narrative drafting as tone &amp; emphasis. Cost/spec artifacts ignore it.
          </p>
        </fieldset>

        <button
          onClick={handleFullDraft}
          disabled={!canDraft || fullDraftLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-indigo-200 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {fullDraftLoading ? (
            <span className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          ) : (
            <span className="text-indigo-400">&#x2726;</span>
          )}
          {fullDraftLoading ? 'Requesting…' : `Run full draft (Mode ${fullDraftMode.toUpperCase()})`}
        </button>
        {isLocked && (
          <p className="text-xs text-amber-600 mt-2">
            This proposal is locked — unlock it to run a full draft.
          </p>
        )}

        {fullDraftMsg && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              fullDraftMsg.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {fullDraftMsg.text}
          </div>
        )}
      </div>

      {/* ── R&D — Research this opportunity (Research Scout) ─────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Research this opportunity</h3>
        <p className="text-sm text-gray-500 mb-3">
          The Research Scout browses the web—including DoD sources (SAM.gov, SBIR.gov, DSIP)—for market
          research, prior art, and the competitor landscape, then returns a <b>cited brief for your review</b>.
          Web results are treated as untrusted data, and the run counts against your AI budget.
        </p>
        <textarea
          value={researchQ}
          onChange={(e) => setResearchQ(e.target.value)}
          rows={2}
          disabled={researching}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3 disabled:opacity-60"
        />
        <button
          onClick={handleResearch}
          disabled={researching || !researchQ.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-blue-200 rounded-lg bg-white text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {researching ? (
            <><span className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" /> Researching…</>
          ) : (<><span className="text-blue-400">&#x1F50E;</span> Research this opportunity</>)}
        </button>

        {researchErr && <div className="mt-3 rounded-lg px-3 py-2 text-sm bg-amber-50 border border-amber-200 text-amber-800">{researchErr}</div>}

        {brief && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            {brief.web_access === false && (
              <div className="mb-2 text-amber-700">No web sources were available for this run — nothing was fabricated.</div>
            )}
            {brief.topic && <div className="font-semibold text-slate-800">{brief.topic}</div>}
            {brief.summary && <p className="mt-1 text-slate-600">{brief.summary}</p>}
            {Array.isArray(brief.findings) && brief.findings.length > 0 && (
              <ul className="mt-3 space-y-2">
                {brief.findings.map((f: any, i: number) => (
                  <li key={i} className="border-l-2 border-blue-300 pl-3">
                    <span className="text-slate-700">{f.claim}</span>
                    {f.source_url && <a href={f.source_url} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 hover:underline">[source]</a>}
                    {f.confidence && <span className="ml-1 text-xs text-slate-400">· {f.confidence}</span>}
                  </li>
                ))}
              </ul>
            )}
            {Array.isArray(brief.competitors) && brief.competitors.length > 0 && (
              <div className="mt-3 text-slate-600"><b>Competitors:</b> {brief.competitors.join(', ')}</div>
            )}
            <div className="mt-3 text-xs text-slate-400">Advisory — review before use. Add relevant findings to your Library as atoms.</div>
          </div>
        )}
      </div>

      {/* ── Outcome Recording ──────────────────────────────────────── */}
      {canRecordOutcome && !outcomeRecorded && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Record Outcome
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Record the final outcome for this proposal. This updates library
            atom scores to improve future drafts.
          </p>

          {/* Outcome buttons */}
          <div className="flex gap-3 mb-4">
            {outcomeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedOutcome(opt.value)}
                disabled={outcomeLoading}
                className={`px-4 py-2 text-sm font-medium border rounded-lg transition-all disabled:opacity-50 ${
                  selectedOutcome === opt.value ? opt.activeColor : opt.color
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Notes textarea */}
          {selectedOutcome && (
            <div className="space-y-3">
              <textarea
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.target.value)}
                placeholder="Optional notes (e.g., feedback from evaluators, reason for withdrawal)..."
                maxLength={2000}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {outcomeNotes.length}/2000
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedOutcome(null);
                      setOutcomeNotes('');
                    }}
                    disabled={outcomeLoading}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleOutcome}
                    disabled={outcomeLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {outcomeLoading ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving...
                      </>
                    ) : (
                      `Record as ${outcomeOptions.find((o) => o.value === selectedOutcome)?.label}`
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outcome already recorded confirmation */}
      {outcomeRecorded && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-sm font-medium text-emerald-700">
            Outcome recorded successfully. Library atom scores have been
            updated.
          </p>
        </div>
      )}

      {/* ── Status message ─────────────────────────────────────────── */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
