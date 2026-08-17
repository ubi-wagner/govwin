'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [reviewLoading, setReviewLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Full-draft (Proposal Draft Manager) state
  const [fullDraftMode, setFullDraftMode] = useState<'a' | 'b' | 'c'>('a');
  const [voice, setVoice] = useState<string[]>([]);
  // Adversarial-gate (P4-D) — Mode C only. When on, Mode C elevates its review-gate cohort
  // to the reusable AdvisoryOverlay (1:n fan-out → reconcile). Policy picks the overlay's
  // landing: 'hitl' (a human review) or 'auto' (records the reconciled verdict, no TODO).
  const [adversarial, setAdversarial] = useState(false);
  const [adversarialPolicy, setAdversarialPolicy] = useState<'hitl' | 'auto'>('hitl');
  const [fullDraftLoading, setFullDraftLoading] = useState(false);
  const [landLoading, setLandLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  // One-click "draft & stage" orchestration (#8): fire the full draft → poll to completion →
  // auto-stage the revisions for review. Stops at staged review; Accept stays a separate click.
  const [orchestrating, setOrchestrating] = useState(false);
  const [orchestratePhase, setOrchestratePhase] = useState<'drafting' | 'staging' | null>(null);
  // Direct verbatim reuse of an uploaded past proposal into empty sections (W3.2).
  const [pastProposals, setPastProposals] = useState<{ id: string; name: string; sectionCount: number }[]>([]);
  const [reuseCocoonId, setReuseCocoonId] = useState('');
  const [reuseLoading, setReuseLoading] = useState(false);
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

  // Full-draft + research controls: available for admin when the proposal is unlocked.
  const canDraft = isAdmin && !isLocked;

  // Outcome: available for admin only when the proposal is in a stage the
  // outcome route accepts as a precondition (submitted | final). It 409s on
  // 'archived' (outcome already recorded) and 400s on any other stage, so
  // those must not surface the panel.
  const canRecordOutcome =
    isAdmin && ['submitted', 'final'].includes(stage);

  // AI color-team review — enqueues a color_team_reviewer task per section with content; each
  // review posts back as an `ai_review` recommendation in the section's context-box thread.
  const handleAiReview = useCallback(async () => {
    if (!isAdmin || reviewLoading) return;
    setReviewLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/ai-review`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setMessage({ type: 'error', text: err.error || 'AI review failed' });
      } else {
        const json = await res.json();
        const count = json.data?.enqueued ?? 0;
        setMessage({
          type: 'success',
          text:
            count === 0
              ? 'No sections with content to review yet — draft some content first.'
              : `AI color-team review queued for ${count} section${count > 1 ? 's' : ''}. Recommendations will appear in each section's thread shortly.`,
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setReviewLoading(false);
    }
  }, [isAdmin, reviewLoading, tenantSlug, proposalId]);

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
      // The adversarial gate applies only to Mode C (the only mode with a gate cohort).
      const useAdversarial = fullDraftMode === 'c' && adversarial;
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/full-draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: fullDraftMode,
            voice,
            adversarial: useAdversarial,
            ...(useAdversarial ? { adversarialPolicy } : {}),
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setFullDraftMsg({
          type: 'error',
          text: err.error || 'Full draft request failed',
        });
      } else {
        const gateNote = useAdversarial
          ? ` Adversarial gate on (${adversarialPolicy === 'auto' ? 'auto-reconcile' : 'human review'}).`
          : '';
        setFullDraftMsg({
          type: 'success',
          text: `Full draft (Mode ${fullDraftMode.toUpperCase()}) requested. Drafts land in review — watch the section version history as they arrive.${gateNote}`,
        });
      }
    } catch {
      setFullDraftMsg({ type: 'error', text: 'Network error' });
    } finally {
      setFullDraftLoading(false);
    }
  }, [canDraft, fullDraftLoading, fullDraftMode, voice, adversarial, adversarialPolicy, tenantSlug, proposalId]);

  // One-click "Draft & stage for review" (#8) — the last-mile orchestration. Fires the full draft
  // (the same mode/voice/adversarial the manual controls use), polls the run to completion, then
  // auto-chains the read-on-review landing so the drafts appear as PROPOSED revisions without a
  // second manual step. Stops there — "Accept into document" stays a deliberate, separate click.
  const handleDraftAndStage = useCallback(async () => {
    if (!canDraft || orchestrating) return;
    setOrchestrating(true);
    setOrchestratePhase('drafting');
    setFullDraftMsg(null);
    try {
      const useAdversarial = fullDraftMode === 'c' && adversarial;
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/full-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: fullDraftMode,
          voice,
          adversarial: useAdversarial,
          ...(useAdversarial ? { adversarialPolicy } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setFullDraftMsg({ type: 'error', text: err.error || 'Full draft request failed' });
        setOrchestrating(false);
        setOrchestratePhase(null);
        return;
      }

      // Poll the run to completion (paused = HITL landing, or completed), then stage.
      const started = Date.now();
      const poll = async () => {
        try {
          const r = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/full-draft`);
          const j = await r.json().catch(() => ({}));
          const d = j.data as { done?: boolean; failed?: boolean } | undefined;
          if (d?.failed) {
            setFullDraftMsg({ type: 'error', text: 'The draft run failed — see the workflow monitor. Nothing was staged.' });
            setOrchestrating(false);
            setOrchestratePhase(null);
            return;
          }
          if (d?.done) {
            // Auto-chain the read-on-review landing (the only consumer of agent output — human-triggered).
            setOrchestratePhase('staging');
            const lr = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/land-revisions`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
            });
            const lj = await lr.json().catch(() => ({}));
            const n = lj.data?.landed ?? 0;
            setFullDraftMsg({
              type: 'success',
              text: n > 0
                ? `Drafted & staged ${n} section${n > 1 ? 's' : ''} for review — Restore any from a section's history, then Accept into the document below when you're ready.`
                : 'The draft run finished but staged no new revisions (already landed, or it produced none). Try "Stage AI revisions for review".',
            });
            router.refresh();
            setOrchestrating(false);
            setOrchestratePhase(null);
            return;
          }
        } catch { /* transient — keep polling */ }
        if (Date.now() - started > 240_000) {
          setFullDraftMsg({
            type: 'error',
            text: 'Drafting is taking longer than expected — it keeps running in the background. Once it finishes, use "Stage AI revisions for review" to bring the drafts in.',
          });
          setOrchestrating(false);
          setOrchestratePhase(null);
          return;
        }
        setTimeout(poll, 5000);
      };
      setTimeout(poll, 5000);
    } catch {
      setFullDraftMsg({ type: 'error', text: 'Network error' });
      setOrchestrating(false);
      setOrchestratePhase(null);
    }
  }, [canDraft, orchestrating, fullDraftMode, voice, adversarial, adversarialPolicy, tenantSlug, proposalId, router]);

  // Apply AI-proposed revisions — the read-on-review LANDING. The fabric never lands agent output
  // and the workflow engine forbids a pipeline consumer (docs/FULL_DRAFT_LANDING_DESIGN.md), so the
  // admin lands it here: read the latest full-draft run's staged canvases and write them as PROPOSED
  // ai_revision versions in each section's history. Never touches live content — restore what you want.
  const handleLandRevisions = useCallback(async () => {
    if (!canDraft || landLoading) return;
    setLandLoading(true);
    setFullDraftMsg(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/land-revisions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFullDraftMsg({ type: 'error', text: json.error || 'Failed to apply revisions' });
      } else {
        const n = json.data?.landed ?? 0;
        const reason = json.data?.reason;
        setFullDraftMsg({
          type: 'success',
          text:
            n > 0
              ? `Staged ${n} AI revision${n > 1 ? 's' : ''} for review — Restore any from a section's history, or Accept all into the document below.`
              : reason === 'no_full_draft_run'
                ? 'No full-draft run found yet — run a full draft first, then apply its revisions.'
                : 'No new AI-proposed revisions to apply (already landed, or the run staged none yet).',
        });
        router.refresh();
      }
    } catch {
      setFullDraftMsg({ type: 'error', text: 'Network error' });
    } finally {
      setLandLoading(false);
    }
  }, [canDraft, landLoading, tenantSlug, proposalId, router]);

  // Accept AI drafts INTO the document — the one-click apply. Takes each section's latest staged
  // ai_revision and writes it to LIVE content (archive-first + CAS advance, like a save). For the
  // builder who has reviewed and wants the whole draft on the page at once. Fully undoable.
  const handleAcceptAi = useCallback(async () => {
    if (!canDraft || acceptLoading) return;
    if (!window.confirm(
      "Accept the AI drafts into the document? This replaces each section's current content with its " +
      'latest AI revision. The current content of each is saved to history first, so you can undo it.',
    )) return;
    setAcceptLoading(true);
    setFullDraftMsg(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/accept-ai-revisions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFullDraftMsg({ type: 'error', text: json.error || 'Failed to accept AI drafts' });
      } else {
        const n = json.data?.applied ?? 0;
        setFullDraftMsg({
          type: 'success',
          text: n > 0
            ? `Accepted ${n} AI draft${n > 1 ? 's' : ''} into the document. Open any section to review — the previous content is in its history.`
            : json.data?.reason === 'no_ai_revisions'
              ? 'No staged AI revisions to accept — run a full draft and Stage its revisions first.'
              : 'No new AI drafts to accept (already applied, or sections are locked).',
        });
        router.refresh();
      }
    } catch {
      setFullDraftMsg({ type: 'error', text: 'Network error' });
    } finally {
      setAcceptLoading(false);
    }
  }, [canDraft, acceptLoading, tenantSlug, proposalId, router]);

  // Load the tenant's uploaded past proposals (for verbatim reuse into this build).
  useEffect(() => {
    if (userRole !== 'admin') return;
    fetch(`/api/portal/${tenantSlug}/library/past-proposals`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data?.pastProposals) setPastProposals(j.data.pastProposals); })
      .catch(() => { /* non-fatal */ });
  }, [tenantSlug, userRole]);

  const handleReusePast = useCallback(async () => {
    if (!canDraft || reuseLoading || !reuseCocoonId) return;
    if (!window.confirm(
      "Reuse this past proposal verbatim into the build's EMPTY matching sections? " +
      'Existing content is untouched; imported text is marked red-italic and stays editable.',
    )) return;
    setReuseLoading(true);
    setFullDraftMsg(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/reuse-past`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cocoonId: reuseCocoonId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFullDraftMsg({ type: 'error', text: json.error || 'Reuse failed' });
      } else {
        const n = json.data?.applied ?? 0;
        const um = (json.data?.unmatched ?? []).length;
        setFullDraftMsg({
          type: 'success',
          text: n > 0
            ? `Reused past content into ${n} empty section${n > 1 ? 's' : ''}${um ? ` (${um} had no title match)` : ''}. Open a section to review — imported text is red-italic.`
            : 'No empty sections matched this past proposal by title (existing content is never overwritten).',
        });
        router.refresh();
      }
    } catch {
      setFullDraftMsg({ type: 'error', text: 'Network error' });
    } finally {
      setReuseLoading(false);
    }
  }, [canDraft, reuseLoading, reuseCocoonId, tenantSlug, proposalId, router]);

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
        const contract = json.data?.contractStarted as { contractId: string; kickoffLaunched: boolean } | null;
        setOutcomeRecorded(true);
        setMessage({
          type: 'success',
          text:
            `Outcome recorded as "${selectedOutcome}". ${atomsUpdated} library atom${atomsUpdated !== 1 ? 's' : ''} updated.` +
            (contract
              ? ` 🏆 Contract started${contract.kickoffLaunched ? ' — a kickoff task is in your queue.' : '.'}`
              : ''),
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
          Run a color-team review of every drafted section. To draft or refine content, use{' '}
          <span className="font-medium text-indigo-700">Proposal Studio</span> above (the recommended
          guided path — draft → refine → compliance), or <span className="font-medium text-indigo-700">Draft
          All Sections</span> on the workspace.
        </p>
        <div className="flex flex-wrap gap-3">
          {/* AI color-team review — queues a per-section color_team_reviewer pass whose
              recommendations post into each section's context-box thread (recommendation_type
              'ai_review'). The same path the on-advance auto-review uses, triggered manually. */}
          <button
            type="button"
            onClick={handleAiReview}
            disabled={!isAdmin || reviewLoading}
            title="Queue an AI color-team review — recommendations post into each section's thread."
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-indigo-200 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {reviewLoading ? (
              <span className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
            ) : (
              <span className="text-indigo-400">&#x2726;</span>
            )}
            {reviewLoading ? 'Queuing review…' : 'AI Review'}
          </button>
        </div>
      </div>

      {/* ── Run full draft (Proposal Draft Manager) ─────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Run full draft</h3>
          <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Advanced</span>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          The Proposal Draft Manager plans from the skeleton, compliance matrix, and your
          library, then drafts across the proposal in a single pass (Mode A/B/C). Prefer{' '}
          <span className="font-medium text-indigo-700">Proposal Studio</span> for a gated,
          review-at-each-step draft; use this for one full-pass run. Every output lands in review
          (redlined &amp; reversible) — it never advances a gate on its own.
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

        {/* Adversarial gate — Mode C only (the only mode with a review-gate cohort) */}
        {fullDraftMode === 'c' && (
          <fieldset className="mb-4 rounded-lg border border-gray-200 p-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={adversarial}
                onChange={(e) => setAdversarial(e.target.checked)}
                disabled={fullDraftLoading}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-gray-900">Adversarial gate</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Elevate the review-gate cohort to a directed 1:n adversarial pass
                  (fan-out → discrepancy → remediation) via the Advisory Overlay.
                </span>
              </span>
            </label>

            {adversarial && (
              <div className="mt-3 pl-7">
                <span className="block text-xs font-medium text-gray-700 mb-2">Landing</span>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: 'hitl', label: 'Human review', desc: 'Findings land in a review task.' },
                    { value: 'auto', label: 'Auto-reconcile', desc: 'Records the reconciled verdict — no review task.' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAdversarialPolicy(opt.value)}
                      disabled={fullDraftLoading}
                      aria-pressed={adversarialPolicy === opt.value}
                      title={opt.desc}
                      className={`px-3 py-1.5 text-xs font-medium border rounded-full transition-colors disabled:opacity-50 ${
                        adversarialPolicy === opt.value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500'
                          : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  The overlay is advisory — it never advances a gate. Mode C still ends in a
                  full-draft review.
                </p>
              </div>
            )}
          </fieldset>
        )}

        {/* One-click path (#8): draft the whole proposal → poll to completion → auto-stage the
            revisions for review, in one click. Stops at staged review — Accept stays separate. */}
        <div className="mb-3">
          <button
            type="button"
            onClick={handleDraftAndStage}
            disabled={!canDraft || orchestrating || fullDraftLoading || landLoading || acceptLoading}
            title="Draft the whole proposal and stage the results as proposed revisions for your review — one click. Accepting into the document stays a separate step."
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {orchestrating ? (
              <span className="w-4 h-4 border-2 border-indigo-200 border-t-white rounded-full animate-spin" />
            ) : (
              <span>&#x2726;</span>
            )}
            {orchestrating
              ? (orchestratePhase === 'staging' ? 'Staging for review…' : 'Drafting…')
              : `Draft & stage for review (Mode ${fullDraftMode.toUpperCase()})`}
          </button>
          <p className="text-xs text-gray-400 mt-1">
            One click: drafts every section, then stages the results as proposed revisions you can review.
            Accepting into the document stays a separate, deliberate step.
          </p>
        </div>

        <p className="text-xs font-medium text-gray-500 mb-1.5">Or step through it manually:</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleFullDraft}
            disabled={!canDraft || fullDraftLoading || orchestrating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-indigo-200 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {fullDraftLoading ? (
              <span className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
            ) : (
              <span className="text-indigo-400">&#x2726;</span>
            )}
            {fullDraftLoading ? 'Requesting…' : `Run full draft (Mode ${fullDraftMode.toUpperCase()})`}
          </button>

          {/* Read-on-review landing: after a full-draft run completes, STAGE its AI revisions as
              proposed versions in each section's history (review-first — Restore any, or Accept all). */}
          <button
            type="button"
            onClick={handleLandRevisions}
            disabled={!canDraft || landLoading || orchestrating}
            title="Stage the latest full-draft run's AI revisions as proposed versions in each section's history (review-first)."
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {landLoading ? (
              <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            ) : (
              <span className="text-gray-400">&#x21A9;</span>
            )}
            {landLoading ? 'Staging…' : 'Stage AI revisions for review'}
          </button>

          {/* One-click apply: write each section's latest staged ai_revision to LIVE content
              (archive-first + CAS, fully undoable). The payoff of the full-draft workforce. */}
          <button
            type="button"
            onClick={handleAcceptAi}
            disabled={!canDraft || acceptLoading || orchestrating}
            title="Accept the staged AI drafts into the document — writes each section's latest AI revision to live content (undoable via each section's history)."
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-emerald-200 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {acceptLoading ? (
              <span className="w-4 h-4 border-2 border-emerald-200 border-t-white rounded-full animate-spin" />
            ) : (
              <span>&#x2713;</span>
            )}
            {acceptLoading ? 'Accepting…' : 'Accept AI drafts into document'}
          </button>
        </div>
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

        {pastProposals.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-600 mb-0.5">Reuse a past proposal (verbatim)</p>
            <p className="text-xs text-gray-400 mb-2">
              Pull an uploaded past win&apos;s content straight into this build&apos;s EMPTY matching sections
              (by title). Imported text is marked red-italic; existing content is never overwritten.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={reuseCocoonId}
                onChange={(e) => setReuseCocoonId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 max-w-xs"
              >
                <option value="">Select an uploaded past proposal…</option>
                {pastProposals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sectionCount} section{p.sectionCount !== 1 ? 's' : ''})</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleReusePast}
                disabled={!canDraft || reuseLoading || !reuseCocoonId}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-amber-200 rounded-lg bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {reuseLoading ? 'Reusing…' : 'Reuse verbatim'}
              </button>
            </div>
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
          <div className="flex flex-wrap gap-3 mb-4">
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
