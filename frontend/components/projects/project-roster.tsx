'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * Who is on the project, and how they get on it.
 *
 * ── THE CONTROL THAT WAS MISSING ─────────────────────────────────────────────────────────────
 * Assignment is the whole access mechanism for an employee, and until this shipped the only way to
 * get a `project_assignments` row was to CREATE the project. The list page told employees to "ask a
 * tenant admin to add you" — an instruction nobody could act on. Without a way in, the whole
 * employee half of the capability was unreachable.
 *
 * The roster is visible to anyone on the project (a person needs to know who else is), and only a
 * tenant_admin can change it.
 */
export interface RosterMember { userId: string; email: string | null; name: string | null }
export interface Candidate { id: string; email: string; name?: string | null }

export function ProjectRoster({
  assignees, candidates, basePath, canManage,
}: {
  assignees: RosterMember[];
  candidates: Candidate[];
  basePath: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');

  const on = new Set(assignees.map((a) => a.userId));
  const available = candidates.filter((c) => !on.has(c.id));

  async function add() {
    if (!pick) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/assignees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pick }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not add them', 'error'); return; }
      setPick('');
      toast('Added to the project', 'success');
      router.refresh();
    } catch {
      toast('Could not add them', 'error');
    } finally { setBusy(false); }
  }

  async function remove(userId: string, who: string) {
    if (!confirm(`Take ${who} off this project? They will lose access to it.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/assignees?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not remove them', 'error'); return; }
      toast('Removed from the project', 'success');
      router.refresh();
    } catch {
      toast('Could not remove them', 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">On this project</div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {assignees.map((a) => (
          <li key={a.userId} className="flex max-w-full items-center gap-1 rounded bg-gray-100 px-2 py-1 text-gray-800">
            {/* A work address is longer than a phone is wide; whole, one chip becomes the row. */}
            <span title={a.email ?? undefined} className="truncate">
              {a.name || a.email || a.userId.slice(0, 8)}
            </span>
            {canManage && (
              <button
                type="button"
                aria-label={`Remove ${a.email ?? 'member'}`}
                disabled={busy}
                onClick={() => void remove(a.userId, a.name || a.email || 'them')}
                className="ml-1 text-gray-400 hover:text-red-700 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </li>
        ))}
        {assignees.length === 0 && <li className="text-gray-500">Nobody yet.</li>}
      </ul>

      {canManage && available.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label="Add someone to this project"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">Add someone…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.email}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !pick}
            onClick={() => void add()}
            className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
