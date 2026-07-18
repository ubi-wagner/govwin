'use client';

/**
 * VolumeLayoutGauge — the real page-budget readout for one volume, from the
 * layout endpoint (assemble molds → paginate). Shows "8 / 15 pages" with a
 * green/amber/red budget color and, on click, the per-section page spans — so a
 * builder sees the flowed page count (and whether it's within the compliance
 * cap) WHILE authoring, not only at download. Spreadsheets report tab count.
 */
import { useCallback, useEffect, useState } from 'react';

interface PerSection { title: string | null; startPage: number; endPage: number; pagesUsed: number }
interface LayoutData {
  unit: 'pages' | 'slides' | 'tabs';
  format: string;
  totalPages?: number;
  maxPages?: number | null;
  over?: boolean;
  tabs?: number;
  perSection?: PerSection[];
}

export function VolumeLayoutGauge({ tenantSlug, proposalId, artifactId }: { tenantSlug: string; proposalId: string; artifactId: string }) {
  const [data, setData] = useState<LayoutData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/artifacts/${artifactId}/layout`);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) { setData(json.data as LayoutData); setState('ok'); }
      else setState('error');
    } catch { setState('error'); }
  }, [tenantSlug, proposalId, artifactId]);

  useEffect(() => { load(); }, [load]);

  if (state === 'loading') return <span className="text-xs text-gray-300">measuring…</span>;
  if (state === 'error' || !data) return null; // stay quiet on failure — non-critical guidance

  if (data.unit === 'tabs') {
    return <span className="text-xs text-gray-500" title="Spreadsheet volume — worksheets, not pages">{data.tabs} tab{data.tabs === 1 ? '' : 's'}</span>;
  }

  const total = data.totalPages ?? 0;
  const cap = data.maxPages ?? null;
  const unit = data.unit === 'slides' ? 'slide' : 'page';
  const ratio = cap ? total / cap : 0;
  const color = data.over
    ? 'text-rose-700 bg-rose-50 border-rose-200'
    : cap && ratio >= 0.9
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : cap
        ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
        : 'text-gray-600 bg-gray-50 border-gray-200';

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${color}`}
        title={data.over ? `Over the ${cap}-${unit} limit — tighten to fit` : cap ? `${total} of ${cap} ${unit}s used` : `${total} ${unit}s (no limit set)`}
      >
        {total}{cap ? ` / ${cap}` : ''} {unit}{total === 1 && !cap ? '' : 's'}
        {data.over && <span aria-hidden>⚠</span>}
      </button>
      {open && data.perSection && data.perSection.length > 0 && (
        <div className="absolute right-0 top-full mt-1 z-20 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-left">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Section layout</span>
            <button onClick={() => load()} className="text-[10px] text-blue-600 hover:underline" title="Recompute">refresh</button>
          </div>
          <ul className="space-y-0.5 max-h-56 overflow-y-auto">
            {data.perSection.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-700">{s.title || `Section ${i + 1}`}</span>
                <span className="shrink-0 text-gray-400">{s.startPage === s.endPage ? `p${s.startPage}` : `p${s.startPage}–${s.endPage}`}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 pt-1 border-t border-gray-100 text-[10px] text-gray-400">Estimate — the download uses the exact renderer.</p>
        </div>
      )}
    </span>
  );
}
