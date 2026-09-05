'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Move a note along `watching → seen → resolved`. The transition is compare-and-swap on the
 *  server, so two people advancing the same note cannot both win. */
const NEXT: Record<string, { to: string; label: string } | null> = {
  watching: { to: 'seen', label: 'Mark seen' },
  seen: { to: 'resolved', label: 'Resolve' },
  resolved: null,
};

export default function NoteActions({ id, state }: { id: string; state: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = NEXT[state];
  if (!next) return <span className="text-xs text-gray-400">resolved</span>;

  async function advance() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: state, to: next!.to }),
      });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <button onClick={advance} disabled={busy}
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
      {busy ? '…' : next.label}
    </button>
  );
}
