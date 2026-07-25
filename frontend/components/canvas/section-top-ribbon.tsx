'use client';

/**
 * SectionTopRibbon — persistent top bar for the section canvas editor.
 *
 * Replaces the thin "← Back | title" bar with a full proposal-context ribbon:
 *   ← Back  |  Volume  ›  Section title                [v3] [status] [comp]
 *             ─────────────────────────────────────────────────────────────
 *             [Save]  [Undo]  [Redo]  [Lock ✓]  [Export ▾]  [Panel ⊟]
 *
 * Receives the same save/export/lock handlers that CanvasEditorPage already
 * wires, so the inner CanvasEditor's header row can be slimmed to just the
 * content-level controls (no need to duplicate section metadata there).
 */

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { ComplianceItem } from '@/components/portal/section-compliance-chip';
import { SectionComplianceChip } from '@/components/portal/section-compliance-chip';

export interface SectionRibbonProps {
  // Navigation
  backUrl: string;
  backLabel: string;

  // Section metadata
  sectionTitle: string;
  sectionNumber?: string;
  volumeName?: string;
  version?: number;
  status?: string;
  pageAllocation?: number | null;
  nodeCount?: number;

  // Lock state
  isLocked: boolean;
  canLock: boolean;

  // Edit state
  dirty: boolean;
  saving: boolean;
  saveError?: string | null;

  // Compliance
  complianceItems?: ComplianceItem[];

  // Capabilities
  canExport: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoSteps: number;
  redoSteps: number;
  undoTrail?: string[];
  redoTrail?: string[];

  // Actions
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onLock: () => void;
  onExport: (format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => void;
  onTogglePanel: () => void;
  panelOpen: boolean;

  // Format — determines which export options apply
  canvasFormat: string;
  hasTable: boolean;
  readOnly: boolean;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  empty:       { label: 'Empty',       cls: 'bg-gray-100 text-gray-500'    },
  ai_drafted:  { label: 'AI Draft',    cls: 'bg-indigo-100 text-indigo-700' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-100 text-blue-700'    },
  review:      { label: 'Review',      cls: 'bg-amber-100 text-amber-700'  },
  complete:    { label: 'Complete',    cls: 'bg-emerald-100 text-emerald-700'},
  accepted:    { label: 'Accepted',    cls: 'bg-emerald-100 text-emerald-700'},
};

export function SectionTopRibbon({
  backUrl,
  backLabel,
  sectionTitle,
  sectionNumber,
  volumeName,
  version,
  status,
  pageAllocation,
  nodeCount,
  isLocked,
  canLock,
  dirty,
  saving,
  saveError,
  complianceItems,
  canExport,
  canUndo,
  canRedo,
  undoSteps,
  redoSteps,
  undoTrail,
  redoTrail,
  onSave,
  onUndo,
  onRedo,
  onLock,
  onExport,
  onTogglePanel,
  panelOpen,
  canvasFormat,
  hasTable,
  readOnly,
}: SectionRibbonProps) {
  const [exportOpen,    setExportOpen]    = useState(false);
  const [undoTrailOpen, setUndoTrailOpen] = useState(false);
  const [redoTrailOpen, setRedoTrailOpen] = useState(false);
  const exportRef  = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    function handler(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen]);

  const statusInfo = STATUS_MAP[status ?? ''] ?? STATUS_MAP['empty'];
  const isLetter   = canvasFormat === 'letter' || canvasFormat === 'custom';
  const isSlide    = canvasFormat.startsWith('slide');
  const pageEst    = nodeCount != null ? Math.ceil(nodeCount / 3) : null;
  const pageColor  =
    pageAllocation && pageEst != null
      ? pageEst > pageAllocation   ? 'text-red-600'
      : pageEst > pageAllocation * 0.9 ? 'text-amber-600'
      : 'text-gray-500'
      : 'text-gray-500';

  const btn   = 'inline-flex items-center justify-center h-7 px-2.5 rounded text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const idle  = 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50';
  const blue  = 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700';
  const green = 'border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700';

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm z-20 sticky top-0">

      {/* ── Row 1: breadcrumb + metadata ───────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100">
        <Link
          href={backUrl}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium shrink-0 flex items-center gap-1"
        >
          ← {backLabel}
        </Link>

        <span className="text-gray-300 shrink-0" aria-hidden>/</span>

        {/* Breadcrumb path */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {volumeName && (
            <>
              <span className="text-xs text-gray-400 shrink-0 truncate max-w-[120px]">{volumeName}</span>
              <span className="text-gray-300 shrink-0" aria-hidden>›</span>
            </>
          )}
          <span className="text-sm font-semibold text-gray-900 truncate">
            {sectionNumber ? `${sectionNumber}. ` : ''}{sectionTitle}
          </span>
        </div>

        {/* Right-side metadata chips */}
        <div className="flex items-center gap-2 shrink-0">
          {version != null && (
            <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded font-mono">
              v{version}
            </span>
          )}

          {/* Page budget */}
          {pageAllocation != null && pageEst != null && (
            <span className={`text-[10px] font-medium tabular-nums ${pageColor}`} title="Estimated pages vs. allocated">
              {pageEst}/{pageAllocation}p
            </span>
          )}

          {status && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusInfo.cls}`}>
              {statusInfo.label}
            </span>
          )}

          {isLocked && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide bg-amber-100 text-amber-700 flex items-center gap-0.5">
              🔒 Locked
            </span>
          )}

          {complianceItems && complianceItems.length > 0 && (
            <SectionComplianceChip items={complianceItems} />
          )}
        </div>
      </div>

      {/* ── Row 2: action bar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-1.5">

        {/* Save state */}
        {saveError && (
          <span className="text-xs text-red-600 mr-1 max-w-[200px] truncate" title={saveError}>
            {saveError}
          </span>
        )}

        {!readOnly && (
          <>
            {/* Undo with history trail popover */}
            <div className="relative">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                onMouseEnter={() => undoTrail && undoTrail.length > 0 && setUndoTrailOpen(true)}
                onMouseLeave={() => setUndoTrailOpen(false)}
                className={`${btn} ${idle}`}
                title={`Undo (Ctrl+Z) — ${undoSteps} step${undoSteps !== 1 ? 's' : ''}`}
              >
                ↩{undoSteps > 0 ? ` (${undoSteps})` : ' Undo'}
              </button>
              {undoTrailOpen && undoTrail && undoTrail.length > 0 && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[170px]"
                  onMouseEnter={() => setUndoTrailOpen(true)}
                  onMouseLeave={() => setUndoTrailOpen(false)}
                >
                  <div className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide font-semibold border-b border-gray-100">
                    Undo history
                  </div>
                  {undoTrail.slice(0, 6).map((label, i) => (
                    <div key={i} className={`px-3 py-1.5 text-xs flex items-center gap-2 ${i === 0 ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>
                      {i === 0 && <span className="text-[9px]">↩</span>}
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Redo with history trail popover */}
            <div className="relative">
              <button
                onClick={onRedo}
                disabled={!canRedo}
                onMouseEnter={() => redoTrail && redoTrail.length > 0 && setRedoTrailOpen(true)}
                onMouseLeave={() => setRedoTrailOpen(false)}
                className={`${btn} ${idle}`}
                title={`Redo (Ctrl+Shift+Z) — ${redoSteps} step${redoSteps !== 1 ? 's' : ''}`}
              >
                ↪{redoSteps > 0 ? ` (${redoSteps})` : ' Redo'}
              </button>
              {redoTrailOpen && redoTrail && redoTrail.length > 0 && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[170px]"
                  onMouseEnter={() => setRedoTrailOpen(true)}
                  onMouseLeave={() => setRedoTrailOpen(false)}
                >
                  <div className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide font-semibold border-b border-gray-100">
                    Redo available
                  </div>
                  {redoTrail.slice(0, 6).map((label, i) => (
                    <div key={i} className={`px-3 py-1.5 text-xs flex items-center gap-2 ${i === 0 ? 'text-emerald-600 font-medium' : 'text-gray-500'}`}>
                      {i === 0 && <span className="text-[9px]">↪</span>}
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <span className="mx-1 h-5 w-px bg-gray-200 shrink-0" aria-hidden />

            {/* Save */}
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              className={`${btn} ${dirty && !saving ? blue : idle} font-medium`}
            >
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved ✓'}
            </button>

            {/* Complete & Lock */}
            {canLock && !isLocked && (
              <button
                onClick={onLock}
                disabled={saving}
                className={`${btn} ${green} font-medium`}
                title="Save + accept & lock this section for the current stage"
              >
                ✓ Accept &amp; Lock
              </button>
            )}
          </>
        )}

        {readOnly && (
          <span className="text-xs text-gray-400 italic">read-only</span>
        )}

        <span className="flex-1" />

        {/* Export dropdown */}
        {canExport && (
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen((v) => !v)}
              className={`${btn} ${idle} gap-1`}
              title="Export this section"
            >
              Export <span className="text-gray-400 text-[10px]">▾</span>
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                {isLetter && (
                  <>
                    <button
                      onClick={() => { onExport('docx'); setExportOpen(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Download .docx
                    </button>
                    <button
                      onClick={() => { onExport('pdf'); setExportOpen(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Download .pdf
                    </button>
                  </>
                )}
                {isSlide && (
                  <button
                    onClick={() => { onExport('pptx'); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Download .pptx
                  </button>
                )}
                {hasTable && (
                  <button
                    onClick={() => { onExport('xlsx'); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Download .xlsx
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Panel toggle */}
        <button
          onClick={onTogglePanel}
          className={`${btn} ${panelOpen ? 'bg-gray-100 border-gray-300 text-gray-700' : idle}`}
          title={panelOpen ? 'Hide properties panel' : 'Show properties panel'}
        >
          {panelOpen ? '⊟ Panel' : '⊞ Panel'}
        </button>
      </div>
    </div>
  );
}
