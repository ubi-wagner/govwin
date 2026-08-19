'use client';

/**
 * LibraryBrowser (P3.2) — the faceted, sortable library browse surface.
 *
 * Filter chips (kind × form × context, driven by the API's facet counts) + a grain
 * toggle (foundation | section | group | primitive) + search, over GET
 * /library/atoms. Foundations open in the canvas editor; every row offers a
 * native-format download (P3.3).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { buildLibraryQuery, type LibraryFilters } from '@/lib/library/library-query';

interface Atom {
  id: string; grain: string; title: string | null; summary: string | null;
  memberCount: number; usageCount: number; tags: string[];
}
interface ApiResult { atoms: Atom[]; total: number; facets: Record<string, Record<string, number>> }

const GRAINS = [
  { value: '', label: 'All' },
  { value: 'foundation', label: 'Foundations' },
  { value: 'section', label: 'Sections' },
  { value: 'group', label: 'Groups' },
  { value: 'primitive', label: 'Atoms' },
];
const DIMS: Array<{ dim: keyof LibraryFilters; label: string }> = [
  { dim: 'kind', label: 'Kind' }, { dim: 'form', label: 'Form' }, { dim: 'context', label: 'Context' },
];
const DOWNLOAD_FORM: Record<string, string> = { doc: 'docx', ppt: 'pptx', sheet: 'xlsx', pdf: 'pdf' };

export function LibraryBrowser({ tenantSlug }: { tenantSlug: string }) {
  const [filters, setFilters] = useState<LibraryFilters>({ grain: 'foundation' });
  const [qInput, setQInput] = useState('');
  const [res, setRes] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Debounce the search box into filters.q.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: qInput || undefined })), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // res.ok BEFORE reading the body: a 403/500 also returns parseable JSON, so without this a
    // server failure rendered as a confident, silent EMPTY library ("0 atoms") — the user reads
    // that as "I have nothing saved", not "this request failed".
    fetch(`/api/portal/${tenantSlug}/library/atoms?${buildLibraryQuery(filters)}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b?.error ?? `library load failed (${r.status})`);
        return b;
      })
      .then((b) => { if (!cancelled) { setErr(null); setRes(b.data ?? { atoms: [], total: 0, facets: {} }); } })
      .catch((e) => {
        if (cancelled) return;
        console.error('[library-browser] load failed', e);
        setErr('Could not load your library. Refresh to try again.');
        setRes({ atoms: [], total: 0, facets: {} });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantSlug, filters]);

  const toggle = useCallback((dim: keyof LibraryFilters, value: string) => {
    setFilters((f) => ({ ...f, [dim]: f[dim] === value ? undefined : value }));
  }, []);

  const facets = res?.facets ?? {};
  const activeChips = useMemo(() => DIMS.some(({ dim }) => filters[dim]) || filters.q, [filters]);
  const formOf = (tags: string[]) => tags.find((t) => t.startsWith('form:'))?.slice(5);

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs transition-colors ${active ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800">Browse library {res && <span className="ml-1 font-normal text-gray-400">({res.total})</span>}</h2>
        <input
          value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search title / summary…"
          className="w-52 rounded border px-2.5 py-1 text-sm"
        />
      </div>

      {/* grain toggle */}
      <div className="mb-2 flex flex-wrap gap-1">
        {GRAINS.map((g) => (
          <button key={g.value} onClick={() => setFilters((f) => ({ ...f, grain: g.value || undefined }))}
            className={`rounded px-2.5 py-1 text-xs ${(filters.grain ?? '') === g.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {g.label}
          </button>
        ))}
      </div>

      {/* taxonomy chips from facet counts */}
      {DIMS.map(({ dim, label }) => {
        const values = Object.entries(facets[dim] ?? {});
        if (values.length === 0) return null;
        return (
          <div key={dim} className="mb-1.5 flex flex-wrap items-center gap-1">
            <span className="mr-1 w-14 shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
            {values.sort((a, b) => a[0].localeCompare(b[0])).map(([val, n]) => (
              <button key={val} onClick={() => toggle(dim, val)} className={chip(filters[dim] === val)}>
                {val} <span className="text-gray-400">{n}</span>
              </button>
            ))}
          </div>
        );
      })}

      {activeChips && (
        <button onClick={() => { setFilters({ grain: filters.grain }); setQInput(''); }} className="mb-2 mt-1 text-[11px] text-gray-400 hover:text-rose-600">✕ clear filters</button>
      )}

      {/* results */}
      <div className="mt-3">
        {loading && <p className="text-sm text-gray-400">Loading…</p>}
        {err && !loading && (
          <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</p>
        )}
        {!loading && res && res.atoms.length === 0 && (
          <p className="rounded border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">Nothing matches these filters.</p>
        )}
        {!loading && res && res.atoms.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {res.atoms.map((a) => {
              const fmt = DOWNLOAD_FORM[formOf(a.tags) ?? ''];
              return (
                <li key={a.id} className="rounded border p-3 hover:border-gray-300">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800">{a.title || 'Untitled'}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{a.grain}</span>
                        {a.tags.filter((t) => /^(kind|form|context|vehicle):/.test(t)).map((t) => (
                          <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{t.split(':')[1]}</span>
                        ))}
                        {a.memberCount > 0 && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">{a.memberCount} members</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {a.grain === 'foundation' && (
                        <Link href={`/portal/${tenantSlug}/library/foundation/${a.id}`} className="text-xs text-blue-600 hover:underline">Open</Link>
                      )}
                      {fmt && <a href={`/api/portal/${tenantSlug}/library/atoms/${a.id}/download?format=${fmt}`} className="text-[11px] text-gray-500 hover:text-gray-800">↓ .{fmt}</a>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
