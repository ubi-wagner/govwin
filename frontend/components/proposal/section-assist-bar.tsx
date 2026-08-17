'use client';

/**
 * SectionAssistBar (SPINE-T2) — AI researchers & assistance, reachable FROM the section editor.
 * Every proposal-level AI action already accepts a sectionId; the section editor just never called them
 * section-scoped. This wires three, on the section the builder is looking at:
 *   • Draft with AI   — section_drafter fills an empty section (atom-grounded), landed in-doc (reuses the
 *                       Draft-All tool-invoke + save path, scoped to one section).
 *   • Check compliance — compliance_reviewer scoped to this section (the route already took sectionId).
 *   • Research         — research_scout returns a cited brief for this section, shown inline.
 * Advisory: draft lands via the same save route (archives a version); compliance/research are read-outs.
 * Hidden entirely for a read-only viewer/commenter — assistance is an editor capability.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTool } from '@/lib/hooks/use-tool';
import { createEmptyCanvas, CANVAS_PRESETS, type CanvasNode } from '@/lib/types/canvas-document';
import { toast } from '@/lib/toast';

export function SectionAssistBar({
  tenantSlug, proposalId, sectionId, sectionTitle, isEmpty, canEdit, pageLimit,
}: {
  tenantSlug: string; proposalId: string; sectionId: string; sectionTitle: string;
  isEmpty: boolean; canEdit: boolean; pageLimit: number | null;
}) {
  const router = useRouter();
  const { invoke, loading: drafting } = useTool();
  const [busy, setBusy] = useState<null | 'compliance' | 'research'>(null);
  const [research, setResearch] = useState<string | null>(null);

  if (!canEdit) return null;

  async function draft() {
    try {
      // Atom-grounded single-section draft — the same selector + tool-invoke + save the Draft-All button uses.
      let libraryAtoms: Array<{ id: string; content: string; category: string }> = [];
      try {
        const qs = new URLSearchParams({ limit: '5', sectionId, text: sectionTitle });
        const r = await fetch(`/api/portal/${tenantSlug}/atoms/select?${qs.toString()}`);
        if (r.ok) {
          const ranked = ((await r.json()).data?.atoms ?? []) as Array<{ id: string; content: string | null }>;
          libraryAtoms = ranked.filter((a) => a.content?.trim()).map((a) => ({ id: a.id, content: a.content as string, category: 'section' }));
        }
      } catch { /* draft without library context */ }

      const result = await invoke<{ nodes: CanvasNode[] }>('proposal.draft_section', {
        proposalId, sectionId, sectionTitle, pageLimit: pageLimit ?? undefined, libraryAtoms,
      });
      if (!result?.nodes?.length) { toast('The drafter returned nothing to land.', 'error'); return; }

      const now = new Date().toISOString();
      const doc = createEmptyCanvas({
        documentId: sectionId, canvas: CANVAS_PRESETS.letter_sbir_phase1,
        metadata: { title: sectionTitle, volume_id: '', required_item_id: '', proposal_id: proposalId, solicitation_id: '', created_at: now, last_modified_at: now, last_modified_by: '', version_number: 1, status: 'ai_drafted' },
      });
      doc.nodes = result.nodes;
      const save = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/save`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: doc, status: 'ai_drafted', source: 'ai_draft' }),
      });
      if (!save.ok) { toast('Draft produced but the save failed — retry.', 'error'); return; }
      toast.success('Section drafted with AI.');
      router.refresh();
    } catch { toast('AI drafting failed — please retry.', 'error'); }
  }

  async function checkCompliance() {
    setBusy('compliance');
    setResearch(null);
    try {
      // ai/compliance is synchronous — it returns the per-variable checks for this section directly.
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/ai/compliance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sectionId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j?.error ? `Compliance check failed: ${j.error}` : 'Compliance check failed', 'error'); return; }
      const d = j?.data ?? {};
      const passed = Number(d.passed ?? 0), failed = Number(d.failed ?? 0), partial = Number(d.partial ?? 0);
      const failing = Array.isArray(d.checks) ? d.checks.filter((c: { status?: string }) => c?.status === 'fail' || c?.status === 'partial') : [];
      const lines = failing.slice(0, 6).map((c: { requirement?: string; label?: string; detail?: string; status?: string }) =>
        `• [${c.status}] ${c.requirement ?? c.label ?? 'requirement'}${c.detail ? ` — ${c.detail}` : ''}`).join('\n');
      setResearch(`Compliance for this section — ${passed} pass · ${failed} fail · ${partial} partial${lines ? `\n${lines}` : (failed + partial === 0 ? '\nAll checked requirements pass.' : '')}`);
      toast.success('Compliance checked for this section.');
      router.refresh();
    } catch { toast('Compliance check failed — please retry.', 'error'); } finally { setBusy(null); }
  }

  async function doResearch() {
    setBusy('research');
    setResearch(null);
    try {
      // research_scout is ASYNC: POST queues the task + returns a taskId; the cited brief arrives on a
      // later GET poll (the scout browses the web, fences the results). Poll a bounded number of times.
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/ai/research`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sectionId, question: sectionTitle }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j?.error ? `Research failed: ${j.error}` : 'Research failed', 'error'); return; }
      const taskId = j?.data?.taskId;
      if (!taskId) { setResearch('Research queued — the brief will appear in Activity.'); return; }
      setResearch('Researching… the scout is browsing sources for this section.');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const g = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/ai/research?taskId=${encodeURIComponent(taskId)}`);
        const gj = await g.json().catch(() => ({}));
        if (gj?.data?.status === 'complete') {
          const r = gj.data.result;
          const text = typeof r === 'string' ? r : (r?.summary ?? r?.brief ?? r?.answer ?? JSON.stringify(r, null, 2));
          setResearch(typeof text === 'string' && text.trim() ? text : 'Research complete.');
          toast.success('Research brief ready.');
          return;
        }
      }
      setResearch('Research is still running — the brief will appear in Activity when the scout finishes.');
    } catch { toast('Research failed — please retry.', 'error'); } finally { setBusy(null); }
  }

  return (
    <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-400">AI assist</span>
        {isEmpty && (
          <button onClick={draft} disabled={drafting}
            className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </button>
        )}
        <button onClick={checkCompliance} disabled={busy !== null}
          className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          {busy === 'compliance' ? 'Checking…' : 'Check compliance'}
        </button>
        <button onClick={doResearch} disabled={busy !== null}
          className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          {busy === 'research' ? 'Researching…' : 'Research this section'}
        </button>
        <span className="ml-auto text-xs text-indigo-400">The researcher + drafter are advisory — you review what lands.</span>
      </div>
      {research && (
        <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-indigo-200 bg-white p-2 text-xs text-gray-700">
          {research}
        </div>
      )}
    </div>
  );
}
