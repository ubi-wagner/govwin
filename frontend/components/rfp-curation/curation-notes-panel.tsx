'use client';

/**
 * Curation notes — the master OPP's internal margin (mig 190 `curation_notes`).
 *
 * Append-only admin thread that survives every status (the old note fields were
 * transition-coupled and went dead once the solicitation pushed). Internal by
 * contract: never customer-visible, never on the bridge. Mounted in the curation
 * workspace AND the provisioning cockpit so the 72h-window conversation ("waiting
 * on Component instructions", "buyer asked about the cost form") lives with the
 * record instead of in someone's inbox.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';

interface Note { id: string; authorEmail: string | null; body: string; createdAt: string }

export function CurationNotesPanel({ solId, compact = false }: { solId: string; compact?: boolean }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/rfp-curation/${solId}/notes`);
      if (!res.ok) return;
      const j = await res.json().catch(() => null);
      if (j?.data?.notes) setNotes(j.data.notes);
    } catch { /* panel is best-effort */ }
  }, [solId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/rfp-curation/${solId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j?.error ?? 'Could not add the note');
        return;
      }
      setDraft('');
      toast.success('Note added');
      await load();
    } catch {
      toast.error('Could not add the note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-gray-900">
          Curation notes
          {notes.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">{notes.length}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">internal — never customer-visible</span>
          <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Leave a note on this OPP — decisions, waiting-on, buyer context…"
              className="flex-1 text-sm border border-gray-300 rounded px-2 py-1.5"
            />
            <button
              type="button"
              onClick={() => { void add(); }}
              disabled={busy || !draft.trim()}
              className="self-end px-3 py-1.5 text-sm font-medium rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add note'}
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="mt-2 text-xs text-gray-400">No notes yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className="text-sm border-l-2 border-gray-200 pl-3">
                  <p className="text-gray-800 whitespace-pre-wrap">{n.body}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {n.authorEmail ?? 'admin'} · {new Date(n.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
