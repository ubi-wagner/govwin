'use client';

/**
 * Ingest Studio — the 4-gate panel (docs/INGEST_STUDIO_DESIGN.md).
 *
 * Deliberately the SAME vocabulary as the Proposal Studio gates: at every phase the admin has
 * exactly three affordances — comment + regenerate, approve → next, or run the rest
 * automatically. An admin who has learned one surface has learned the other.
 *
 * What this panel is really for is the thing a compliance matrix cannot show on its own: the
 * matrix currently on screen may be STAGED (proposed, reviewed, not landed) or LANDED (live, what
 * every tenant will build against). Those look identical in a table of values, and confusing them
 * is how a fabricated page limit reaches a customer. So the panel leads with the phase, shows what
 * was actually READ versus defaulted, and refuses to hide a blocker.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

type Phase = 'not_started' | 'extract' | 'matrix' | 'review' | 'landed' | 'molds' | 'complete';

interface Finding { severity: 'blocker' | 'warning' | 'info'; field: string | null; issue: string; fix: string }
interface Audit {
  read?: number; defaulted?: number; deferred?: number; unknown?: number; fieldsTotal?: number;
  coverage?: number; findings?: Finding[]; unresolvedDeferrals?: Array<{ field: string; label: string }>;
}
interface Draft {
  id: string; status: string; createdAt: string; reviewedAt: string | null;
  audit: Audit; review: Record<string, unknown>; guidance: string | null;
  parsed?: { volumes?: Array<{ name: string }>; compliance?: Record<string, unknown> };
}
interface Molds {
  itemsToMold: number; itemsWithMold: number;
  outlineStagedAt: string | null; outlineSource: 'agent' | 'matrix' | null; sectionsProposed: number;
}
interface OutlineVol { volumeNumber: number; volume: string; dsipOnly: boolean; sections: Array<{ section: string; pageBudget: number | null; characterBudget: number | null }> }
interface State {
  phase: Phase; phaseLabel: string; nextPhase: Phase;
  sourceReady: boolean; sourceChars: number; draft: Draft | null;
  molds: Molds | null;
  outline: { source: 'agent' | 'matrix'; volumes: OutlineVol[]; notes: string | null } | null;
}

/** The gates, in order. `molds` is the separate mold-manager phase — a different job. */
const GATES: Array<{ phase: Phase; title: string; what: string; who: string }> = [
  { phase: 'extract', title: 'Extract', what: 'Read the solicitation text into a structured reading', who: 'ingest_analyst' },
  { phase: 'matrix', title: 'Stage matrix', what: 'Propose a compliance matrix — staged, not landed', who: 'matrix_stager' },
  { phase: 'review', title: 'Adversarial review', what: 'Challenge every staged value against its citation', who: 'curation_qa × 3 lenses → advisory_manager' },
  { phase: 'landed', title: 'Land', what: 'Promote the reviewed matrix — the only writer', who: 'you, or an automation policy' },
  { phase: 'molds', title: 'Build molds', what: 'Author volumes + section molds from the LANDED matrix', who: 'skeleton_architect' },
];

const ORDER: Phase[] = ['not_started', 'extract', 'matrix', 'review', 'landed', 'molds', 'complete'];
const rank = (p: Phase) => ORDER.indexOf(p);

export function IngestStudio({ solId }: { solId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/rfp-curation/${solId}/ingest-phase`, { cache: 'no-store' });
      if (!r.ok) return;
      setState((await r.json()).data as State);
    } catch { /* transient — the panel simply keeps its last state */ }
  }, [solId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: string) => {
    setBusy(action);
    try {
      const r = await fetch(`/api/admin/rfp-curation/${solId}/ingest-phase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, guidance: comment || undefined }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        // A refused land is not a failure — it is the gate doing its job. Show WHY, in full.
        if (json.code === 'LAND_BLOCKED') {
          toast.error(json.error);
          for (const b of (json.detail?.blockers ?? []) as string[]) toast.info(b);
          return;
        }
        toast.error(json.error || 'Phase action failed');
        return;
      }
      const d = json.data ?? {};
      if (action === 'land') {
        toast.success(`Landed: ${d.volumes} volumes · ${d.items} section molds · ${d.topics} topic(s)`);
      } else if (action === 'propose_molds') {
        const n = (d.volumes as OutlineVol[] | undefined)?.reduce((a, v) => a + v.sections.length, 0) ?? 0;
        toast.success(`Skeleton proposed — ${n} section(s), ${d.source === 'agent' ? 'from skeleton_architect' : 'derived from the landed matrix'}`);
      } else if (action === 'build_molds') {
        toast.success(`${d.built} mold(s) built · ${d.molds?.itemsWithMold ?? 0} of ${d.molds?.itemsToMold ?? 0} items covered`);
      } else if (action === 'approve') {
        toast.success(`Advanced to ${d.phaseLabel}`);
      } else {
        const a = d.draft?.audit as Audit | undefined;
        toast.success(
          `${d.phaseLabel}: matrix staged — ${a?.read ?? 0}/${a?.fieldsTotal ?? 0} fields read from the document`,
        );
      }
      setComment('');
      await load();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Phase action failed');
    } finally {
      setBusy(null);
    }
  };

  if (!state) return null;

  const cur = rank(state.phase);
  const audit = state.draft?.audit ?? {};
  const findings = audit.findings ?? [];
  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const staged = state.draft && state.draft.status !== 'landed';
  const started = state.phase !== 'not_started';

  return (
    <div className="mb-6 border border-indigo-200 rounded-lg bg-indigo-50/40">
      {/* ── Header: the one fact a matrix of values cannot tell you ── */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-indigo-900">Ingest Studio</h3>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            state.phase === 'landed' || state.phase === 'complete'
              ? 'bg-green-100 text-green-800'
              : staged ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
          }`}>
            {staged ? 'Matrix STAGED — not landed' : state.phase === 'not_started' ? 'Not started' : state.phaseLabel}
          </span>
          {!state.sourceReady && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium"
                  title={`${state.sourceChars} characters extracted`}>
              Source text not ready
            </span>
          )}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="text-xs text-indigo-700 hover:text-indigo-900">
          {open ? 'Hide gates' : 'Show gates'}
        </button>
      </div>

      {/* ── Coverage: read vs guessed, before anything else ── */}
      {state.draft && (
        <div className="px-4 py-2 flex flex-wrap items-center gap-4 text-xs border-b border-indigo-100">
          <span className="text-gray-700">
            <strong className="text-sky-800">{audit.read ?? 0}</strong>/{audit.fieldsTotal ?? 0} read from the document
          </span>
          {(audit.defaulted ?? 0) > 0 && <span className="text-red-700">{audit.defaulted} on system defaults</span>}
          {(audit.deferred ?? 0) > 0 && <span className="text-violet-700">{audit.deferred} set elsewhere</span>}
          {state.draft.reviewedAt && <span className="text-emerald-700">adversarial review complete</span>}
        </div>
      )}

      {/* ── Blockers are never collapsed ── */}
      {blockers.length > 0 && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          {blockers.map((f, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <p className="text-xs font-semibold text-red-800">⛔ {f.issue}</p>
              <p className="text-xs text-red-700 mt-0.5">{f.fix}</p>
            </div>
          ))}
          <p className="text-xs text-red-900 mt-2 font-medium">
            Automation cannot land a matrix with an unresolved blocker — a person has to.
          </p>
        </div>
      )}

      {open && (
        <div className="p-4 space-y-3">
          {/* ── The gates ── */}
          <ol className="space-y-2">
            {GATES.map((g) => {
              const gi = rank(g.phase);
              const done = cur > gi;
              const active = cur === gi;
              return (
                <li key={g.phase} className={`flex items-start gap-3 p-2 rounded ${active ? 'bg-white border border-indigo-300' : ''}`}>
                  <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full text-[10px] flex items-center justify-center font-bold ${
                    done ? 'bg-green-600 text-white' : active ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {done ? '✓' : gi}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm ${active ? 'font-semibold text-indigo-900' : 'text-gray-700'}`}>{g.title}</p>
                    <p className="text-xs text-gray-500">{g.what}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{g.who}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* ── The three affordances, same as Proposal Studio ── */}
          <div className="pt-2 border-t border-indigo-100">
            <label className="block text-xs text-gray-600 mb-1" htmlFor="ingest-guidance">
              Comment for the agents on a regenerate (threaded in as guidance)
            </label>
            <textarea
              id="ingest-guidance"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="e.g. the page limit is in the Component instructions, not the BAA — read that document"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mb-2"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void act(started ? 'regenerate' : 'start')}
                disabled={!!busy || !state.sourceReady}
                title={!state.sourceReady ? 'The shred has not produced usable text yet' : undefined}
                className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy === 'start' || busy === 'regenerate' ? 'Running…' : started ? '↻ Comment & regenerate' : '▶ Start ingest'}
              </button>
              <button
                onClick={() => void act('approve')}
                disabled={!!busy || !started || state.phase === 'complete'}
                className="px-3 py-1.5 text-xs font-medium rounded bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {busy === 'approve' ? 'Advancing…' : '✓ Approve → next'}
              </button>
              <button
                onClick={() => void act('land')}
                disabled={!!busy || !staged}
                title={staged ? 'Promote the staged matrix into the live compliance matrix' : 'Nothing staged to land'}
                className="px-3 py-1.5 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy === 'land' ? 'Landing…' : '⇢ Land the matrix'}
              </button>
              <button
                onClick={() => void act('auto')}
                disabled={!!busy || !state.sourceReady}
                title="Run the remaining phases without stopping at each gate. Blockers still stop a land."
                className="px-3 py-1.5 text-xs font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {busy === 'auto' ? 'Running…' : '⚡ Run all automatically'}
              </button>
            </div>
          </div>

          {/* ── The MOLDS gate ────────────────────────────────────────────────
              This gate used to be a dead end: skeleton_architect ran advisorily and its proposal
              went nowhere, so an admin arrived here with nothing to review and no button. The
              counter is the point — a phase whose workflow instance finished is not the same
              thing as a solicitation whose items have molds, and only one of those facts is
              worth anything to the buyer who provisions off it. */}
          {state.molds && state.molds.itemsToMold > 0 && rank(state.phase) >= rank('landed') && (
            <div className="rounded border border-indigo-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs">
                  <span className="font-semibold text-indigo-900">Molds</span>
                  <span className={`ml-2 px-2 py-0.5 rounded font-medium ${
                    state.molds.itemsWithMold === state.molds.itemsToMold
                      ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {state.molds.itemsWithMold} of {state.molds.itemsToMold} items have a mold
                  </span>
                  {state.molds.outlineSource && (
                    <span className="ml-2 text-gray-500">
                      skeleton proposed {state.molds.outlineSource === 'agent'
                        ? 'by skeleton_architect'
                        : 'from the landed matrix'} · {state.molds.sectionsProposed} section(s)
                    </span>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => void act('propose_molds')}
                    disabled={!!busy}
                    title="Stage a master response skeleton for review. Writes no molds."
                    className="px-3 py-1.5 text-xs font-medium rounded bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {busy === 'propose_molds' ? 'Proposing…' : state.outline ? '↻ Re-propose skeleton' : '◇ Propose skeleton'}
                  </button>
                  <button
                    onClick={() => void act('build_molds')}
                    disabled={!!busy || !state.outline}
                    title={state.outline ? 'Build a mold for every authored item from the reviewed skeleton' : 'Propose a skeleton first'}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busy === 'build_molds' ? 'Building…' : '⇢ Build the molds'}
                  </button>
                </div>
              </div>

              {state.outline && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-indigo-700">
                    Review the proposed skeleton
                  </summary>
                  <div className="mt-2 space-y-2">
                    {state.outline.notes && <p className="text-gray-600 italic">{state.outline.notes}</p>}
                    {state.outline.volumes.map((v) => (
                      <div key={v.volumeNumber}>
                        <p className="font-medium text-gray-800">
                          Volume {v.volumeNumber} — {v.volume}
                          {v.dsipOnly && (
                            <span className="ml-2 font-normal text-gray-500">
                              completed in DSIP · nothing authored here
                            </span>
                          )}
                        </p>
                        <ul className="ml-4 mt-0.5 space-y-0.5">
                          {v.sections.map((sec, i) => (
                            <li key={i} className="text-gray-700">
                              • {sec.section}
                              {sec.pageBudget != null && <span className="text-gray-500"> — {sec.pageBudget}pp</span>}
                              {sec.characterBudget != null && (
                                <span className="text-gray-500"> — {sec.characterBudget.toLocaleString()} characters</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* ── Warnings, collapsed under the controls ── */}
          {warnings.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-800">{warnings.length} warning(s)</summary>
              <ul className="mt-1 space-y-1">
                {warnings.map((f, i) => (
                  <li key={i} className="text-amber-800">• {f.issue}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
