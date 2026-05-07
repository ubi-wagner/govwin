'use client';

/**
 * Template Previewer — READ-ONLY preview of CanvasDocument templates.
 *
 * Shows:
 *   - Template selector dropdown (from the template registry)
 *   - Format indicator (page dimensions, margins, font specs)
 *   - Merge field highlighting with hover tooltips
 *   - List of all merge fields extracted from the template
 *   - "Use This Template" action button
 *   - Canvas rendering via CanvasRenderer in read-only mode
 */

import React, { useState, useMemo, useCallback } from 'react';
import { CanvasRenderer } from '@/components/canvas/canvas-renderer';
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { getNodeText } from '@/lib/types/canvas-document';
import { getTemplate, type TemplateKey } from '@/lib/templates';

// --- Template registry metadata (display info for selector) ---

interface TemplateOption {
  key: string;
  label: string;
  summary: string;
  format: 'letter' | 'slide' | 'spreadsheet';
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    key: 'dod-sbir-phase1-technical',
    label: 'SBIR Phase I Technical (15 pages)',
    summary: 'Standard DoD SBIR Phase I technical volume',
    format: 'letter',
  },
  {
    key: 'dod-cso-phase1-briefing',
    label: 'CSO Phase I Briefing (10 slides)',
    summary: 'AFWERX/CSO pitch deck format',
    format: 'slide',
  },
  {
    key: 'dod-sbir-phase1-cost',
    label: 'SBIR Phase I Cost Volume',
    summary: 'Spreadsheet-based cost proposal with formulas',
    format: 'spreadsheet',
  },
];

// --- Merge field descriptions ---

const MERGE_FIELD_DESCRIPTIONS: Record<string, string> = {
  company_name: 'Legal name of the proposing small business',
  topic_number: 'Solicitation topic identifier (e.g., AF241-001)',
  topic_title: 'Full title of the solicitation topic',
  solicitation_number: 'BAA/solicitation reference number',
  cage_code: 'Commercial and Government Entity code',
  uei: 'Unique Entity Identifier (SAM.gov)',
  pi_name: 'Principal Investigator full name',
  pi_phone: 'PI phone number',
  pi_email: 'PI email address',
  pop_months: 'Period of performance in months',
  proposed_cost: 'Total proposed cost in dollars',
  taba_proposed: 'Technical and Business Assistance requested (Yes/No)',
  company_city: 'Company headquarters city',
  company_state: 'Company headquarters state',
  company_website: 'Company website URL',
  n: 'Current page/slide number (auto-generated)',
  N: 'Total page/slide count (auto-generated)',
};

interface Props {
  /** Pre-selected template key. If provided, hides the selector. */
  initialTemplateKey?: string;
  /** Called when user clicks "Use This Template". */
  onUseTemplate?: (templateKey: string) => void;
  /** Whether to show the template selector dropdown. */
  showSelector?: boolean;
}

export function TemplatePreviewer({
  initialTemplateKey,
  onUseTemplate,
  showSelector = true,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string>(
    initialTemplateKey ?? TEMPLATE_OPTIONS[0].key
  );

  const template = useMemo(() => getTemplate(selectedKey), [selectedKey]);

  const selectedOption = TEMPLATE_OPTIONS.find((o) => o.key === selectedKey);

  // Extract all merge fields from the template
  const mergeFields = useMemo(() => {
    if (!template) return [];
    const fields = new Set<string>();
    const regex = /\{([a-z_]+)\}/g;

    // Check all node text
    for (const node of template.nodes) {
      const text = getNodeText(node);
      let match;
      while ((match = regex.exec(text)) !== null) {
        fields.add(match[1]);
      }
    }

    // Check header/footer templates
    if (template.canvas.header) {
      let match;
      while ((match = regex.exec(template.canvas.header.template)) !== null) {
        fields.add(match[1]);
      }
    }
    if (template.canvas.footer) {
      let match;
      while ((match = regex.exec(template.canvas.footer.template)) !== null) {
        fields.add(match[1]);
      }
    }

    return Array.from(fields).sort();
  }, [template]);

  const handleUseTemplate = useCallback(() => {
    if (onUseTemplate) onUseTemplate(selectedKey);
  }, [onUseTemplate, selectedKey]);

  // Noop handlers for read-only rendering
  const noopSelect = useCallback((_id: string | null) => {}, []);
  const noopUpdate = useCallback((_id: string, _content: CanvasNode['content']) => {}, []);

  if (!template) {
    return (
      <div className="p-8 text-center text-gray-400 text-sm">
        Template not found: {selectedKey}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: selector + action */}
      <div className="flex items-center justify-between gap-4">
        {showSelector && (
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Template</label>
            <select
              value={selectedKey}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedKey(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {onUseTemplate && (
          <button
            onClick={handleUseTemplate}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            Use This Template
          </button>
        )}
      </div>

      {/* Format indicator */}
      <FormatIndicator canvas={template.canvas} format={selectedOption?.format ?? 'letter'} />

      {/* Canvas preview */}
      <div className="border rounded-lg overflow-hidden">
        <CanvasRenderer
          document={template}
          selectedNodeId={null}
          onSelectNode={noopSelect}
          onUpdateNode={noopUpdate}
          readOnly={true}
        />
      </div>

      {/* Merge fields panel */}
      <MergeFieldsPanel fields={mergeFields} />
    </div>
  );
}

// --- Format Indicator ---

function FormatIndicator({ canvas, format }: { canvas: CanvasRules; format: string }) {
  const formatLabel = format === 'slide'
    ? 'Slide Deck'
    : format === 'spreadsheet'
    ? 'Spreadsheet'
    : 'Letter Document';

  const formatIcon = format === 'slide'
    ? 'PPTX'
    : format === 'spreadsheet'
    ? 'XLSX'
    : 'DOCX';

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded font-medium ${
        format === 'slide'
          ? 'bg-orange-100 text-orange-700'
          : format === 'spreadsheet'
          ? 'bg-green-100 text-green-700'
          : 'bg-blue-100 text-blue-700'
      }`}>
        {formatIcon} {formatLabel}
      </span>
      <span className="text-gray-500">
        {canvas.width} x {canvas.height}pt
      </span>
      <span className="text-gray-500">
        Margins: {canvas.margins.top}/{canvas.margins.right}/{canvas.margins.bottom}/{canvas.margins.left}pt
      </span>
      <span className="text-gray-500">
        {canvas.font_default.family} {canvas.font_default.size}pt
      </span>
      <span className="text-gray-500">
        {canvas.line_spacing}x spacing
      </span>
      {canvas.max_pages && (
        <span className="text-gray-500">{canvas.max_pages} page limit</span>
      )}
      {canvas.max_slides && (
        <span className="text-gray-500">{canvas.max_slides} slide limit</span>
      )}
    </div>
  );
}

// --- Merge Fields Panel ---

function MergeFieldsPanel({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;

  return (
    <div className="border rounded-lg bg-white">
      <div className="px-4 py-2 border-b bg-gray-50">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Merge Fields ({fields.length})
        </h3>
      </div>
      <div className="p-3 flex flex-wrap gap-2">
        {fields.map((field) => (
          <span
            key={field}
            className="group relative inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs font-mono border border-purple-200 cursor-help"
          >
            {`{${field}}`}
            {/* Tooltip */}
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
              {MERGE_FIELD_DESCRIPTIONS[field] ?? 'Custom merge field'}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
