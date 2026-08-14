'use client';

/**
 * New Document Chooser (Tier 2, #3/#4) — quick-create + template browser.
 *
 * Start a standalone document from a BLANK preset (flier / letter / deck /
 * workbook) or from a `document_templates` skeleton (the tenant's own extracted
 * templates + the shared system library), then open it in the canvas editor.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { BlankPreset } from '@/lib/documents/starter';

// Field names are camelCase — the API's rows pass through @/lib/db's global
// snake_case→camelCase transform (e.g. `template_type` → `templateType`).
interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  templateType: string;
  agency: string | null;
  programType: string | null;
  nodeCount: number;
  isSystem: boolean;
  isMine: boolean;
  hasBody: boolean;
  sections: string[];
}

const TYPE_LABEL: Record<string, string> = {
  technical_volume: 'Technical', cost_volume: 'Cost', slide_deck: 'Slides',
  past_performance: 'Past Perf', key_personnel: 'Key Personnel',
  commercialization: 'Commercialization', abstract: 'Abstract',
  cover_sheet: 'Cover', supporting_docs: 'Supporting', custom: 'Custom',
};

const BLANKS: { preset: BlankPreset; icon: string; title: string; blurb: string }[] = [
  { preset: 'flier', icon: '▭', title: 'One-page flier', blurb: 'A single letter-size page — capability statement, sell sheet, one-pager.' },
  { preset: 'letter', icon: '📄', title: 'Blank document', blurb: 'Letter-size, multi-page — white paper, cover letter, SOW, narrative.' },
  { preset: 'deck', icon: '▦', title: 'Slide deck', blurb: '16:9 slides — pitch, briefing, capability overview.' },
  { preset: 'sheet', icon: '▧', title: 'Workbook', blurb: 'Spreadsheet — budget, cost table, pricing sheet.' },
];

export function NewDocumentChooser({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/templates`);
        if (!cancelled && res.ok) {
          const json = await res.json();
          setTemplates((json.data?.templates ?? []) as TemplateRow[]);
        } else if (!cancelled) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? 'Could not load templates');
        }
      } catch {
        if (!cancelled) setError('Could not load templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const create = useCallback(async (payload: { preset: BlankPreset } | { templateId: string }) => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...payload, ...(name.trim() ? { title: name.trim() } : {}) };
      const res = await fetch(`/api/portal/${tenantSlug}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Could not create the document');
      // Navigate to the editor — keep `busy` set (we're leaving this page).
      router.push(`/portal/${tenantSlug}/documents/${json.data.documentId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the document');
      setBusy(false);
    }
  }, [tenantSlug, router, name]);

  // The pristine starter stable lives in the owned template-card gallery now (Phase 5, template bridge);
  // this chooser lists only the tenant's OWN saved templates (skeletons extracted from past proposals).
  const mine = useMemo(() => templates.filter((t) => t.isMine && !t.isSystem), [templates]);
  const filterFn = useCallback((t: TemplateRow) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [t.name, t.description ?? '', t.agency ?? '', t.programType ?? '', TYPE_LABEL[t.templateType] ?? '']
      .join(' ').toLowerCase().includes(needle);
  }, [q]);
  const mineF = mine.filter(filterFn);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">New document</h1>
          <p className="text-sm text-gray-500 mt-1">
            Start blank, or from one of your templates — a one-page flier to a full volume.
          </p>
        </div>
        <Link href={`/portal/${tenantSlug}/documents`} className="text-sm text-blue-600 hover:underline">
          &larr; Back to Documents
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* ── Optional name ───────────────────────────────────────── */}
      <div className="mb-6 max-w-md">
        <label className="block text-xs font-medium text-gray-600 mb-1">Document name <span className="text-gray-400 font-normal">(optional)</span></label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Immobileyes Capability Statement"
          maxLength={200}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>

      {/* ── Start blank ─────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Start blank</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {BLANKS.map((b) => (
            <button
              key={b.preset}
              onClick={() => create({ preset: b.preset })}
              disabled={busy}
              className="text-left rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="text-2xl mb-2 text-gray-400">{b.icon}</div>
              <div className="font-medium text-gray-900">{b.title}</div>
              <div className="text-xs text-gray-500 mt-1 leading-snug">{b.blurb}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Browse the pristine template library (owned cards) ──── */}
      <section className="mb-10">
        <Link
          href={`/portal/${tenantSlug}/templates`}
          className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 hover:border-blue-300 hover:bg-blue-100 transition"
        >
          <div>
            <div className="text-sm font-semibold text-blue-800">Browse the template library →</div>
            <div className="text-xs text-blue-700/80 mt-0.5">
              Pristine agency volumes, brochures, and capability decks — yours to reuse, with preview.
            </div>
          </div>
          <span className="text-2xl text-blue-400">▦</span>
        </Link>
      </section>

      {/* ── Start from one of your saved templates ──────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Your saved templates</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            className="w-56 border border-gray-300 rounded px-2 py-1 text-xs"
          />
        </div>

        {loading && <p className="text-sm text-gray-400 py-6 text-center">Loading your templates…</p>}

        {!loading && mine.length === 0 && (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-sm text-gray-500">No saved templates yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Save a volume as a template from a proposal, start blank above, or browse the template library.
            </p>
          </div>
        )}

        {!loading && mineF.length > 0 && (
          <TemplateGrid rows={mineF} busy={busy} onUse={(id) => create({ templateId: id })} />
        )}

        {!loading && mine.length > 0 && mineF.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">No templates match “{q}”.</p>
        )}
      </section>
    </div>
  );
}

function TemplateGrid({ rows, busy, onUse }: { rows: TemplateRow[]; busy: boolean; onUse: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((t) => (
        <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="font-medium text-gray-900 text-sm leading-snug">{t.name}</span>
            <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600">
              {TYPE_LABEL[t.templateType] ?? t.templateType}
            </span>
          </div>
          {(t.agency || t.programType) && (
            <div className="text-[11px] text-gray-400 mb-1">
              {[t.agency, t.programType].filter(Boolean).join(' · ')}
            </div>
          )}
          {t.description && (
            <p className="text-xs text-gray-500 line-clamp-2 mb-2">{t.description}</p>
          )}
          {t.sections?.length > 0 && (
            <div className="text-[11px] text-gray-400 mb-2 line-clamp-1" title={t.sections.join(', ')}>
              {t.sections.length} section{t.sections.length !== 1 ? 's' : ''}: {t.sections.slice(0, 3).join(', ')}{t.sections.length > 3 ? '…' : ''}
            </div>
          )}
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="text-[10px] text-gray-400">
              {t.hasBody ? `${t.nodeCount} blocks` : t.sections?.length > 0 ? 'outline' : 'page rules'}
            </span>
            <button
              onClick={() => onUse(t.id)}
              disabled={busy}
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Use template
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
