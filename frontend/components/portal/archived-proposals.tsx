'use client';

/**
 * ArchivedProposals — the retrievable "Archived" section of the proposals list (V1-11).
 * Each archived proposal stays visible + exportable, and (for admins) can be RESTORED or permanently
 * DELETED. Shows how long ago it was archived and flags purge-eligibility per the retention window.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface ArchivedItem {
  id: string;
  title: string;
  agency: string | null;
  topicNumber: string | null;
  sectionCount: number;
  archivedAt: string | null;
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function ArchivedProposals({
  tenantSlug,
  items,
  canManage,
  canExport,
  retentionDays,
}: {
  tenantSlug: string;
  items: ArchivedItem[];
  canManage: boolean;
  canExport: boolean;
  retentionDays: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [list, setList] = useState(items);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const act = async (id: string, action: 'restore') => {
    setBusy(id);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Action failed');
        return;
      }
      setList((prev) => prev.filter((p) => p.id !== id));
      router.refresh();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(null);
    }
  };

  if (list.length === 0) return null;

  return (
    <div className="mt-8 border-t border-gray-200 pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        <span>{open ? '▾' : '▸'}</span>
        Archived ({list.length})
      </button>
      {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
      {open && (
        <ul className="mt-3 space-y-2">
          {list.map((p) => {
            const d = daysAgo(p.archivedAt);
            const purgeEligible = d !== null && d >= retentionDays;
            return (
              <li key={p.id} className="flex items-start justify-between gap-3 bg-gray-50/70 border border-gray-200 rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/portal/${tenantSlug}/proposals/${p.id}`} className="font-medium text-gray-800 hover:text-indigo-700 truncate block">
                    {p.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-gray-500">
                    {p.agency && <span>{p.agency}</span>}
                    {p.topicNumber && <span>Topic {p.topicNumber}</span>}
                    <span>{p.sectionCount} section{p.sectionCount !== 1 ? 's' : ''}</span>
                    <span>{d === null ? 'archived' : d === 0 ? 'archived today' : `archived ${d} day${d !== 1 ? 's' : ''} ago`}</span>
                    {purgeEligible && <span className="text-amber-600 font-medium">· cold-storage eligible (&gt;{retentionDays}d)</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {canExport && (
                    <a
                      href={`/api/portal/${tenantSlug}/proposals/${p.id}/package?format=zip`}
                      className="text-[11px] text-indigo-600 hover:underline"
                    >
                      Export
                    </a>
                  )}
                  {canManage && (
                    <>
                      <button onClick={() => act(p.id, 'restore')} disabled={busy === p.id} className="px-2.5 py-1 text-[11px] font-medium text-indigo-700 border border-indigo-300 rounded hover:bg-indigo-50 disabled:opacity-50">
                        Restore
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
