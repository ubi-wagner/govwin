'use client';

/**
 * SectionAssignBar (SPINE-T1) — the per-section owner strip on the section editor. Shows who owns this
 * section (and their open ToDo), and lets an admin / portal manager assign or reassign it to any editor
 * or collaborator. Assigning raises the assignee's `edit_section` ToDo (deep-linked here); locking the
 * section auto-completes it. Read-only for everyone else — they just see the owner.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export interface AssigneeOption { id: string; name: string | null; email: string; kind: 'member' | 'collaborator'; role: string | null }

export function SectionAssignBar({
  tenantSlug, proposalId, sectionId, currentAssigneeId, currentAssigneeName, canAssign, assignees, todoStatus, locked = false,
}: {
  tenantSlug: string; proposalId: string; sectionId: string;
  currentAssigneeId: string | null; currentAssigneeName: string | null;
  canAssign: boolean; assignees: AssigneeOption[]; todoStatus: 'open' | 'in_progress' | 'completed' | null; locked?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [assigneeId, setAssigneeId] = useState(currentAssigneeId ?? '');
  // Re-sync when the prop changes after a router.refresh() or an external reassign (audit C1).
  useEffect(() => { setAssigneeId(currentAssigneeId ?? ''); }, [currentAssigneeId]);
  // A locked section is read-only — assigning an editor is refused server-side; keep the picker enabled
  // only to CLEAR an existing assignment (audit H2).
  const pickerDisabled = busy || (locked && !currentAssigneeId);

  async function save(next: string) {
    setBusy(true);
    setAssigneeId(next);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/assign`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeUserId: next || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j?.error ? `Assign failed: ${j.error}` : 'Assign failed', 'error'); setAssigneeId(currentAssigneeId ?? ''); return; }
      toast.success(next ? 'Section assigned.' : 'Section unassigned.');
      router.refresh();
    } catch { toast('Assign failed — please retry.', 'error'); setAssigneeId(currentAssigneeId ?? ''); }
    finally { setBusy(false); }
  }

  const label = (o: AssigneeOption) => `${o.name || o.email}${o.kind === 'collaborator' ? ' · collaborator' : ''}`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Owner</span>
      {canAssign ? (
        <select value={assigneeId} onChange={(e) => save(e.target.value)} disabled={pickerDisabled}
          className="min-w-[12rem] rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
          title={locked ? 'Section is locked — unlock to assign an editor' : 'Assign this section'}>
          <option value="">Unassigned</option>
          {assignees.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
        </select>
      ) : (
        <span className="font-medium text-gray-700">{currentAssigneeName ?? 'Unassigned'}</span>
      )}
      {todoStatus === 'completed' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">to-do done</span>}
      {(todoStatus === 'open' || todoStatus === 'in_progress') && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">to-do open</span>}
      {busy && <span className="text-xs text-gray-400">saving…</span>}
      <span className="ml-auto text-xs text-gray-400">Assigning raises a section to-do; locking completes it.</span>
    </div>
  );
}
