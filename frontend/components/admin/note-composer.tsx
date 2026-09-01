'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Adding a note to the shared board.
 *
 * The anchor is the field that matters: a note about `/admin/site` lives WITH `/admin/site`, which
 * is what lets it be surfaced where it is relevant and checked for staleness. A free-floating note
 * is a chat log entry. The kind is inferred from the shape so nobody has to think about it — a
 * leading slash is a route, a dot in a path is a file.
 */
export default function NoteComposer({ authorEmail }: { authorEmail: string | null }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [anchor, setAnchor] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, anchor: anchor.trim() || null, authorEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.error ?? `Could not add the note (HTTP ${res.status})`); return; }
      setNote(''); setAnchor('');
      router.refresh();
    } catch {
      setErr('Network error — the note was not saved.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-gray-200 bg-white p-4">
      <textarea
        value={note} onChange={(e) => setNote(e.target.value)} rows={3}
        placeholder="What should we watch for? e.g. /admin/site threw a React #418 once and will not reproduce — eighth occurrence of the client-clock class."
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={anchor} onChange={(e) => setAnchor(e.target.value)}
          placeholder="anchor — /admin/site, or frontend/lib/db.ts (optional)"
          className="min-w-[18rem] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
        />
        <button type="submit" disabled={busy || !note.trim()}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {busy ? 'Adding…' : 'Add note'}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
    </form>
  );
}
