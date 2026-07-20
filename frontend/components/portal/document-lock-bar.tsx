'use client';

/**
 * DocumentLockBar (#18) — the "full lock for download" affordance above the document editor.
 *
 * A draft can be worked/collaborated on freely. "Lock for download" finalizes it (status
 * 'final') and — when it was regenerated from a past proposal — PROMOTES its working atom
 * copies to new FOUNDATION atoms in the library, carrying their derived_from lineage back
 * to the seminal proposal (non-destructive). Additive banner: it never touches the editor.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DocumentLockBar({
  tenantSlug, documentId, initialStatus,
}: {
  tenantSlug: string; documentId: string; initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [promoted, setPromoted] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const lock = async () => {
    if (!confirm('Lock this document for download? It becomes final, and any content regenerated from a past proposal is committed to your library as new foundation atoms (with lineage back to the originals).')) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/documents/${documentId}/lock`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data?.locked) {
        setStatus('final');
        setPromoted(json.data.promotedAtoms ?? 0);
        router.refresh(); // flip the editor to read-only
      } else {
        setErr(json.error || 'Could not lock the document');
      }
    } catch {
      setErr('Could not lock the document');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'final') {
    return (
      <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        <span aria-hidden>🔒</span>
        <span className="font-medium">Locked for download.</span>
        <span className="text-emerald-700">
          {promoted != null
            ? (promoted > 0
                ? `${promoted} section${promoted === 1 ? '' : 's'} committed to your library as new foundation atoms — with lineage back to the source.`
                : 'This document is final. Download it from the editor’s export menu.')
            : 'This document is final — download it from the editor’s export menu.'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2">
      <p className="text-sm text-amber-800">
        <span className="font-medium">Draft.</span> Edit and collaborate freely, then lock it for download —
        anything regenerated from a past proposal is committed back to your library with lineage.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {err && <span className="text-xs text-rose-600">{err}</span>}
        <button
          onClick={lock}
          disabled={busy}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Locking…' : 'Lock for download'}
        </button>
      </div>
    </div>
  );
}
