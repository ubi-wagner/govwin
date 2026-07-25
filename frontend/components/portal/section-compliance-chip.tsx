'use client';

/**
 * SectionComplianceChip — compact compliance status for a single section.
 *
 * Reads from the compliance items already loaded on the workspace page
 * (filtered by section_id). Shows passed / total with a color-coded badge.
 * Clicking expands a popover listing the requirements.
 */

import { useState, useRef, useEffect } from 'react';

export interface ComplianceItem {
  id?: string;
  requirement?: string;
  label?: string;
  status?: string;
  details?: string | null;
  sectionId?: string | null;
}

interface Props {
  items: ComplianceItem[];
  compact?: boolean;
}

function statusIcon(status?: string) {
  if (status === 'satisfied')     return { icon: '✓', cls: 'text-emerald-600' };
  if (status === 'not_applicable') return { icon: '–', cls: 'text-gray-400'   };
  return                                  { icon: '✗', cls: 'text-red-500'    };
}

export function SectionComplianceChip({ items, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  if (items.length === 0) return null;

  const total    = items.length;
  const passed   = items.filter((i) => i.status === 'satisfied').length;
  const na       = items.filter((i) => i.status === 'not_applicable').length;
  const eligible = total - na;
  const allPass  = passed === eligible && eligible > 0;
  const anyFail  = items.some((i) => i.status !== 'satisfied' && i.status !== 'not_applicable');

  const chipCls = allPass
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : anyFail
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-amber-50 border-amber-200 text-amber-700';

  const icon = allPass ? '✓' : anyFail ? '✗' : '·';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors hover:opacity-80 ${chipCls}`}
        title="Section compliance status — click to view requirements"
      >
        <span>{icon}</span>
        {!compact && (
          <span>Comp {passed}/{eligible}</span>
        )}
        {compact && (
          <span>{passed}/{eligible}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <p className="text-[11px] font-semibold text-gray-700 mb-2 uppercase tracking-wider">
            Compliance Requirements
          </p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {items.map((item, idx) => {
              const { icon: ic, cls } = statusIcon(item.status);
              return (
                <div key={item.id ?? idx} className="flex items-start gap-2">
                  <span className={`text-xs font-bold shrink-0 mt-0.5 ${cls}`}>{ic}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-700 leading-snug">
                      {item.requirement ?? item.label ?? 'Requirement'}
                    </p>
                    {item.details && (
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{item.details}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 text-[10px] text-gray-400 hover:text-gray-600"
          >Close</button>
        </div>
      )}
    </div>
  );
}
