'use client';

/**
 * Admin Templates Browser — lists all document templates from the
 * in-code registry (and optionally from the DB), with filtering
 * and canvas preview.
 *
 * Route: /admin/templates
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { TemplatePreviewer } from '@/components/admin/template-previewer';
import { getTemplate } from '@/lib/templates';
import type { CanvasDocument } from '@/lib/types/canvas-document';

// --- Template metadata (mirrors the document_templates DB schema) ---

interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  template_type: string;
  agency: string | null;
  program_type: string | null;
  template_key: string;
  node_count: number;
  format: string;
  page_limit: number | null;
  slide_limit: number | null;
  is_system: boolean;
  canvas_doc: CanvasDocument | null;
}

// Build template records from the in-code registry
function buildRegistryRecords(): TemplateRecord[] {
  const entries: Array<{
    key: string;
    name: string;
    description: string;
    template_type: string;
    agency: string | null;
    program_type: string | null;
  }> = [
    {
      key: 'dod-sbir-phase1-technical',
      name: 'DoD SBIR Phase I -- Technical Volume',
      description: 'Standard DoD SBIR Phase I technical volume. Times New Roman 10pt, 1-inch margins, single-spaced. 15-page limit.',
      template_type: 'technical_volume',
      agency: 'DoD',
      program_type: 'sbir_phase_1',
    },
    {
      key: 'dod-cso-phase1-briefing',
      name: 'DoD CSO Phase I -- Pitch Briefing',
      description: 'AFWERX/CSO pitch deck format. Arial 18pt, 16:9 widescreen. 10-slide limit.',
      template_type: 'slide_deck',
      agency: 'AFWERX',
      program_type: 'cso',
    },
    {
      key: 'dod-sbir-phase1-cost',
      name: 'DoD SBIR Phase I -- Cost Volume',
      description: 'Spreadsheet-based cost proposal with rate schedules, labor detail, ODC breakdown, and summary roll-up with formulas.',
      template_type: 'cost_volume',
      agency: 'DoD',
      program_type: 'sbir_phase_1',
    },
  ];

  return entries.map((entry) => {
    const doc = getTemplate(entry.key);
    return {
      id: `registry-${entry.key}`,
      name: entry.name,
      description: entry.description,
      template_type: entry.template_type,
      agency: entry.agency,
      program_type: entry.program_type,
      template_key: entry.key,
      node_count: doc?.nodes.length ?? 0,
      format: doc?.canvas.format ?? 'letter',
      page_limit: doc?.canvas.max_pages ?? null,
      slide_limit: doc?.canvas.max_slides ?? null,
      is_system: true,
      canvas_doc: doc,
    };
  });
}

// --- DB template loader (optional, fails gracefully) ---

function useDbTemplates(): { records: TemplateRecord[]; loading: boolean } {
  const [records, setRecords] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/admin/templates');
        if (!resp.ok) {
          // DB table may not exist yet; that is fine
          if (!cancelled) setLoading(false);
          return;
        }
        const json = await resp.json();
        if (!cancelled && json.data) {
          const mapped: TemplateRecord[] = (json.data as Array<Record<string, unknown>>).map((row) => ({
            id: row.id as string,
            name: row.name as string,
            description: (row.description as string) ?? '',
            template_type: row.template_type as string,
            agency: (row.agency as string) ?? null,
            program_type: (row.program_type as string) ?? null,
            template_key: row.storage_key as string,
            node_count: (row.node_count as number) ?? 0,
            format: ((row.canvas_preset as Record<string, unknown>)?.format as string) ?? 'letter',
            page_limit: ((row.canvas_preset as Record<string, unknown>)?.max_pages as number) ?? null,
            slide_limit: ((row.canvas_preset as Record<string, unknown>)?.max_slides as number) ?? null,
            is_system: (row.is_system as boolean) ?? false,
            canvas_doc: null,
          }));
          setRecords(mapped);
        }
      } catch {
        // API not available; that is fine
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { records, loading };
}

// --- Filter helpers ---

const TEMPLATE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'technical_volume', label: 'Technical Volume' },
  { value: 'cost_volume', label: 'Cost Volume' },
  { value: 'slide_deck', label: 'Slide Deck' },
];

const AGENCIES = [
  { value: '', label: 'All Agencies' },
  { value: 'DoD', label: 'DoD' },
  { value: 'AFWERX', label: 'AFWERX' },
  { value: 'NSF', label: 'NSF' },
];

const PROGRAM_TYPES = [
  { value: '', label: 'All Programs' },
  { value: 'sbir_phase_1', label: 'SBIR Phase 1' },
  { value: 'sbir_phase_2', label: 'SBIR Phase 2' },
  { value: 'cso', label: 'CSO' },
  { value: 'baa', label: 'BAA' },
];

// --- Format badge ---

function formatBadge(format: string) {
  switch (format) {
    case 'letter':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">DOCX</span>;
    case 'slide_16_9':
    case 'slide_4_3':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">PPTX</span>;
    default:
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-200">{format}</span>;
  }
}

// --- Main page component ---

export default function AdminTemplatesPage() {
  const registryRecords = useMemo(() => buildRegistryRecords(), []);
  const { records: dbRecords, loading: dbLoading } = useDbTemplates();

  const [filterType, setFilterType] = useState('');
  const [filterAgency, setFilterAgency] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // Merge registry + DB records, dedup by key
  const allRecords = useMemo(() => {
    const byKey = new Map<string, TemplateRecord>();
    for (const r of registryRecords) byKey.set(r.template_key, r);
    for (const r of dbRecords) {
      if (!byKey.has(r.template_key)) byKey.set(r.template_key, r);
    }
    return Array.from(byKey.values());
  }, [registryRecords, dbRecords]);

  // Apply filters
  const filtered = useMemo(() => {
    return allRecords.filter((r: TemplateRecord) => {
      if (filterType && r.template_type !== filterType) return false;
      if (filterAgency && r.agency !== filterAgency) return false;
      if (filterProgram && r.program_type !== filterProgram) return false;
      return true;
    });
  }, [allRecords, filterType, filterAgency, filterProgram]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Document Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse and preview canvas document templates for proposal artifacts.
          </p>
        </div>
        <span className="text-xs text-gray-400">
          {allRecords.length} template{allRecords.length !== 1 ? 's' : ''}
          {dbLoading && ' (loading...)'}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={filterType}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterType(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {TEMPLATE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={filterAgency}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterAgency(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {AGENCIES.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
        <select
          value={filterProgram}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterProgram(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {PROGRAM_TYPES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {(filterType || filterAgency || filterProgram) && (
          <button
            onClick={() => { setFilterType(''); setFilterAgency(''); setFilterProgram(''); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Template list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No templates match the current filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((record: TemplateRecord) => (
            <div
              key={record.id}
              className="flex items-center gap-4 p-4 bg-white border rounded-lg hover:border-gray-300 transition-colors"
            >
              {/* Format icon */}
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                record.format === 'letter'
                  ? 'bg-blue-100 text-blue-700'
                  : record.format.startsWith('slide')
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 truncate">{record.name}</span>
                  {formatBadge(record.format)}
                  {record.is_system && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">
                      System
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{record.description}</p>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                  <span>{record.node_count} nodes</span>
                  {record.agency && <span>{record.agency}</span>}
                  {record.program_type && <span>{record.program_type.replace(/_/g, ' ')}</span>}
                  {record.page_limit && <span>{record.page_limit} page limit</span>}
                  {record.slide_limit && <span>{record.slide_limit} slide limit</span>}
                </div>
              </div>

              {/* Actions */}
              <button
                onClick={() => setPreviewKey(record.template_key)}
                className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap flex-shrink-0"
              >
                Preview
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewKey && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-8 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-sm font-semibold text-gray-800">Template Preview</h2>
              <button
                onClick={() => setPreviewKey(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-6">
              <TemplatePreviewer
                initialTemplateKey={previewKey}
                showSelector={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
