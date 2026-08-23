'use client';

/**
 * Sheet Editor — spreadsheet grid editor for spreadsheet-format documents.
 *
 * Replaces the standard CanvasEditor when the document format is 'spreadsheet'.
 * Each table node in the document represents a worksheet/sheet. Provides cell
 * editing, sheet tabs, add/remove rows and columns, and a formula bar.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  CanvasDocument,
  CanvasNode,
  TableContent,
  TableCell as TableCellType,
  TableCellStyle,
} from '@/lib/types/canvas-document';
import { createNode, withCanvasDefaults } from '@/lib/types/canvas-document';
import { parseNumericText, isNumericCell, formatCellDisplay, NUMBER_FORMATS } from '@/lib/numeric-cell';
import { SheetMediaStrip } from './sheet-media-strip';
import { CanvasOverlayBar, overlayClass, useOverlays, OVERLAYS, documentHasGroups } from './canvas-overlays';

// ─── Types ──────────────────────────────────────────────────────────

interface SheetEditorProps {
  initialDocument: CanvasDocument;
  onSave: (doc: CanvasDocument) => Promise<void>;
  onExport?: (doc: CanvasDocument, format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => Promise<void>;
  actorId: string;
  actorName: string;
  readOnly?: boolean;
}

interface CellPosition {
  row: number; // -1 for header row
  col: number;
}

interface SheetInfo {
  nodeId: string;
  name: string;
  content: TableContent;
  /** the worksheet's table-node provenance source (for the Provenance overlay). */
  source?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function cellText(cell: string | TableCellType): string {
  return typeof cell === 'string' ? cell : cell.text;
}

/**
 * Build a cell from the committed edit value, preserving existing cell style.
 *  • A value beginning with `=` is stored as a real `formula` (the xlsx exporter writes
 *    it as an Excel formula that Excel computes on open) — previously `=A1+B1` was
 *    silently kept as literal text.
 *  • A literal on a NUMERIC cell re-derives `value` from the text, so exports + the cost
 *    readiness roll-up (which read `value`) reflect the edit, not a stale provisioned
 *    number (the cost-volume numeric-cell sync).
 *  • A plain literal on a plain cell stays a bare string when it can, and clears any
 *    prior formula.
 */
function buildCell(existing: string | TableCellType | undefined, value: string): string | TableCellType {
  const isFormula = value.trimStart().startsWith('=');
  const base: TableCellType = typeof existing === 'object' && existing ? { ...existing, text: value } : { text: value };
  if (isFormula) return { ...base, formula: value };
  // literal — drop a stale formula
  const { formula: _drop, ...rest } = base;
  // re-derive the numeric value from the edited text for cost-volume cells
  if (typeof existing === 'object' && existing && isNumericCell(existing)) {
    const v = parseNumericText(value);
    (rest as TableCellType).value = v == null ? undefined : v;
  }
  return Object.keys(rest).length === 1 ? value : rest;
}

function getSheets(doc: CanvasDocument): SheetInfo[] {
  const tableNodes = doc.nodes.filter((n) => n.type === 'table');
  return tableNodes.map((node, i) => {
    const content = node.content as TableContent;
    const name = content.sheet_name ?? `Sheet ${i + 1}`;
    return {
      nodeId: node.id,
      name,
      content,
      source: node.provenance?.source,
    };
  });
}

function colLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/** Per-cell border override for the grid (the base class draws a thin grid line). */
function borderCss(border?: 'none' | 'thin' | 'thick'): React.CSSProperties {
  if (border === 'none') return { borderColor: 'transparent' };
  if (border === 'thick') return { borderWidth: 2, borderColor: '#334155' };
  return {};
}

// ─── Component ──────────────────────────────────────────────────────

export function SheetEditor({
  initialDocument,
  onSave,
  onExport,
  actorId,
  actorName,
  readOnly = false,
}: SheetEditorProps) {
  // Same partial-canvas normalization as the doc editor (B78) — the ribbon reads
  // `doc.canvas.font_default.family` straight into an <input value>.
  const [doc, setDoc] = useState<CanvasDocument>(() => withCanvasDefaults(initialDocument));
  const [activeSheet, setActiveSheet] = useState(0);
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renamingSheet, setRenamingSheet] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [undoStack, setUndoStack] = useState<CanvasDocument[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasDocument[]>([]);

  const sheets = useMemo(() => getSheets(doc), [doc]);

  // Ensure activeSheet is within bounds
  const clampedSheet = Math.min(activeSheet, Math.max(0, sheets.length - 1));
  if (clampedSheet !== activeSheet && sheets.length > 0) {
    setActiveSheet(clampedSheet);
  }

  const currentSheet = sheets[clampedSheet] ?? null;
  // Structure-as-overlay (Phase 1): on a sheet, Atoms outlines the worksheet/table primitive
  // and Provenance gutters it by source. Reuses the same overlay CSS via the grid's data-attrs.
  const { active: overlays, toggle: toggleOverlay } = useOverlays();
  const headers = currentSheet?.content.headers ?? [];
  const rows = currentSheet?.content.rows ?? [];
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);

  // ─── Document mutation helpers ─────────────────────────────────────

  const updateDoc = useCallback(
    (updater: (prev: CanvasDocument) => CanvasDocument) => {
      setDoc((prev) => {
        // Push previous state onto undo stack (limit 50)
        setUndoStack(stack => {
          const next = [...stack, prev];
          return next.length > 50 ? next.slice(-50) : next;
        });
        // Clear redo stack on new edit
        setRedoStack([]);

        const next = updater(prev);
        return {
          ...next,
          metadata: {
            ...next.metadata,
            last_modified_at: new Date().toISOString(),
            last_modified_by: actorId,
            version_number: prev.metadata.version_number + 1,
          },
        };
      });
      setDirty(true);
    },
    [actorId],
  );

  const updateNodeContent = useCallback(
    (nodeId: string, content: TableContent) => {
      updateDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            content,
            history: [
              ...n.history,
              {
                actor_id: actorId,
                actor_name: actorName,
                action: 'edited' as const,
                timestamp: new Date().toISOString(),
              },
            ],
          };
        }),
      }));
    },
    [updateDoc, actorId, actorName],
  );

  // ─── Cell editing ──────────────────────────────────────────────────

  const getCellValue = useCallback(
    (row: number, col: number): string => {
      if (!currentSheet) return '';
      if (row === -1) {
        const h = currentSheet.content.headers[col];
        return h != null ? cellText(h) : '';
      }
      const r = currentSheet.content.rows[row];
      if (!r) return '';
      const c = r[col];
      return c != null ? cellText(c) : '';
    },
    [currentSheet],
  );

  const startEdit = useCallback(
    (row: number, col: number, value: string) => {
      if (readOnly) return;
      setEditingCell({ row, col });
      setEditValue(value);
    },
    [readOnly],
  );

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingCell || !currentSheet) return;

    const content: TableContent = { ...currentSheet.content };

    if (editingCell.row === -1) {
      // Editing header — preserve existing cell styles
      const newHeaders = [...content.headers];
      newHeaders[editingCell.col] = buildCell(newHeaders[editingCell.col], editValue);
      updateNodeContent(currentSheet.nodeId, { ...content, headers: newHeaders });
    } else {
      // Editing data cell — preserve existing cell styles
      const newRows = content.rows.map((r) => [...r]);
      // Ensure row exists
      while (newRows.length <= editingCell.row) {
        newRows.push(new Array(colCount).fill(''));
      }
      // Ensure column exists in row
      while (newRows[editingCell.row].length <= editingCell.col) {
        newRows[editingCell.row].push('');
      }
      newRows[editingCell.row][editingCell.col] = buildCell(newRows[editingCell.row][editingCell.col], editValue);
      updateNodeContent(currentSheet.nodeId, { ...content, rows: newRows });
    }

    setEditingCell(null);
    setEditValue('');
  }, [editingCell, currentSheet, editValue, updateNodeContent, colCount]);

  const commitAndMove = useCallback(
    (dRow: number, dCol: number) => {
      commitEdit();
      if (activeCell) {
        const newRow = activeCell.row + dRow;
        const newCol = activeCell.col + dCol;
        // Clamp within bounds
        const maxRow = rows.length - 1;
        const maxCol = colCount - 1;
        if (newCol > maxCol && dCol > 0) {
          // Wrap to next row
          setActiveCell({ row: Math.min(newRow + 1, maxRow), col: 0 });
        } else if (newCol < 0 && dCol < 0) {
          // Wrap to previous row
          setActiveCell({ row: Math.max(newRow - 1, -1), col: maxCol });
        } else {
          setActiveCell({
            row: Math.max(-1, Math.min(newRow, maxRow)),
            col: Math.max(0, Math.min(newCol, maxCol)),
          });
        }
      }
    },
    [commitEdit, activeCell, rows.length, colCount],
  );

  // ─── Structural operations ─────────────────────────────────────────

  const handleAddRow = useCallback(() => {
    if (!currentSheet || readOnly) return;
    const content = { ...currentSheet.content };
    const newRow = new Array(colCount).fill('') as string[];
    updateNodeContent(currentSheet.nodeId, {
      ...content,
      rows: [...content.rows, newRow],
    });
  }, [currentSheet, readOnly, colCount, updateNodeContent]);

  const handleAddColumn = useCallback(() => {
    if (!currentSheet || readOnly) return;
    const content = { ...currentSheet.content };
    const colIdx = content.headers.length;
    const newHeaders = [...content.headers, `Column ${colLetter(colIdx)}`];
    const newRows = content.rows.map((r) => [...r, '']);
    updateNodeContent(currentSheet.nodeId, {
      ...content,
      headers: newHeaders,
      rows: newRows,
    });
  }, [currentSheet, readOnly, updateNodeContent]);

  const handleAddSheet = useCallback(() => {
    if (readOnly) return;
    const sheetNumber = sheets.length + 1;
    const newTable = createNode({
      type: 'table',
      content: {
        headers: ['Column A', 'Column B', 'Column C'],
        rows: [
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ],
        sheet_name: `Sheet ${sheetNumber}`,
      } as TableContent,
      source: 'manual',
      actorId,
      actorName,
    });

    updateDoc((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newTable],
    }));

    setActiveSheet(sheets.length);
    setActiveCell(null);
    setEditingCell(null);
  }, [readOnly, sheets.length, actorId, actorName, updateDoc]);

  // ─── Delete / Rename operations ─────────────────────────────────────

  const handleDeleteRow = useCallback((rowIndex: number) => {
    const sheet = sheets[clampedSheet];
    if (!sheet || readOnly) return;
    const content = sheet.content;
    if (content.rows.length <= 1) return;
    updateDoc(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== sheet.nodeId) return n;
        const tc = n.content as TableContent;
        return { ...n, content: { ...tc, rows: tc.rows.filter((_, i) => i !== rowIndex) } };
      }),
    }));
  }, [sheets, clampedSheet, readOnly, updateDoc]);

  const handleDeleteColumn = useCallback((colIndex: number) => {
    const sheet = sheets[clampedSheet];
    if (!sheet || readOnly) return;
    const content = sheet.content;
    if (content.headers.length <= 1) return;
    updateDoc(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== sheet.nodeId) return n;
        const tc = n.content as TableContent;
        return {
          ...n,
          content: {
            ...tc,
            headers: tc.headers.filter((_, i) => i !== colIndex),
            rows: tc.rows.map(row => row.filter((_, i) => i !== colIndex)),
          },
        };
      }),
    }));
  }, [sheets, clampedSheet, readOnly, updateDoc]);

  const handleDeleteSheet = useCallback((sheetIndex: number) => {
    if (sheets.length <= 1 || readOnly) return;
    if (!window.confirm(`Delete sheet "${sheets[sheetIndex].name}"?`)) return;
    const nodeId = sheets[sheetIndex].nodeId;
    updateDoc(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
    }));
    if (activeSheet >= sheets.length - 1) {
      setActiveSheet(Math.max(0, sheets.length - 2));
    }
  }, [sheets, readOnly, updateDoc, activeSheet]);

  // ── Media (images + shapes) — a workbook logo / figure / shape. The xlsx exporter
  // already renders image + shape nodes as floating pictures; these add/remove them.
  const handleAddImageNode = useCallback((storageKey: string, w: number, h: number, alt: string) => {
    const newNode = createNode({
      type: 'image',
      content: { storage_key: storageKey, width: Math.min(w, 480), height: Math.min(h, 360), alt_text: alt } as unknown as CanvasNode['content'],
      source: 'manual', actorId, actorName,
    });
    updateDoc((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
  }, [updateDoc, actorId, actorName]);

  const handleAddShapeNode = useCallback(() => {
    const newNode = createNode({
      type: 'shape',
      content: { shape: 'rectangle', text: '' } as unknown as CanvasNode['content'],
      style: { fill: { color: '#DCE6F1' }, border: { color: '#94A3B8', width: 1 } } as unknown as CanvasNode['style'],
      source: 'manual', actorId, actorName,
    });
    updateDoc((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
  }, [updateDoc, actorId, actorName]);

  const handleDeleteMediaNode = useCallback((nodeId: string) => {
    updateDoc((prev) => ({ ...prev, nodes: prev.nodes.filter((n) => n.id !== nodeId) }));
  }, [updateDoc]);

  const commitSheetRename = useCallback((sheetIndex: number, newName: string) => {
    const sheet = sheets[sheetIndex];
    if (!sheet || !newName.trim()) return;
    updateDoc(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== sheet.nodeId) return n;
        return { ...n, content: { ...(n.content as TableContent), sheet_name: newName.trim() } };
      }),
    }));
  }, [sheets, updateDoc]);

  // ─── Cell formatting helpers ────────────────────────────────────────

  function getActiveCellStyle(): TableCellStyle | null {
    if (!activeCell || !currentSheet) return null;
    const { row, col } = activeCell;
    let cellVal: string | TableCellType;
    if (row === -1) {
      cellVal = currentSheet.content.headers[col];
    } else {
      cellVal = currentSheet.content.rows[row]?.[col];
    }
    if (!cellVal || typeof cellVal === 'string') return null;
    return cellVal.style ?? null;
  }

  function updateCellStyle(stylePatch: Partial<TableCellStyle>) {
    if (!activeCell || !currentSheet || readOnly) return;
    const { row, col } = activeCell;

    updateDoc(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== currentSheet.nodeId) return n;
        const tc = n.content as TableContent;

        if (row === -1) {
          // Header cell
          const headers = tc.headers.map((h, i) => {
            if (i !== col) return h;
            const cell: TableCellType = typeof h === 'string' ? { text: h } : { ...h };
            cell.style = { ...(cell.style || {}), ...stylePatch };
            return cell;
          });
          return { ...n, content: { ...tc, headers } };
        } else {
          // Data cell
          const rows = tc.rows.map((r, ri) => {
            if (ri !== row) return r;
            return r.map((c, ci) => {
              if (ci !== col) return c;
              const cell: TableCellType = typeof c === 'string' ? { text: c } : { ...c };
              cell.style = { ...(cell.style || {}), ...stylePatch };
              return cell;
            });
          });
          return { ...n, content: { ...tc, rows } };
        }
      }),
    }));
  }

  function toggleCellBold() {
    const current = getActiveCellStyle();
    updateCellStyle({ bold: !current?.bold });
  }

  function setCellAlignment(align: 'left' | 'center' | 'right') {
    updateCellStyle({ alignment: align });
  }

  function setCellBg(bg: string | undefined) {
    updateCellStyle({ bg });
  }

  function setCellFg(fg: string | undefined) {
    updateCellStyle({ fg });
  }

  function setCellBorder(border: TableCellStyle['border']) {
    updateCellStyle({ border });
  }

  // ── Number format (currency / percent / thousands) — lives on the cell (not `style`),
  // and is the SAME Excel code the .xlsx export writes, so display == export.
  function getActiveCellNumberFormat(): string {
    if (!activeCell || !currentSheet) return '';
    const { row, col } = activeCell;
    const cv = row === -1 ? currentSheet.content.headers[col] : currentSheet.content.rows[row]?.[col];
    return cv && typeof cv !== 'string' ? cv.number_format ?? '' : '';
  }

  function setCellNumberFormat(code: string) {
    if (!activeCell || !currentSheet || readOnly) return;
    const { row, col } = activeCell;
    const patch = (c: string | TableCellType): TableCellType => {
      const cell: TableCellType = typeof c === 'string' ? { text: c } : { ...c };
      if (code) {
        cell.number_format = code;
        // Ensure there's a numeric value to format (derive from the shown text if needed).
        if (typeof cell.value !== 'number') { const v = parseNumericText(cell.text); if (v != null) cell.value = v; }
      } else {
        delete cell.number_format;
      }
      return cell;
    };
    updateDoc(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== currentSheet.nodeId) return n;
        const tc = n.content as TableContent;
        if (row === -1) return { ...n, content: { ...tc, headers: tc.headers.map((h, i) => i === col ? patch(h) : h) } };
        return { ...n, content: { ...tc, rows: tc.rows.map((r, ri) => ri === row ? r.map((c, ci) => ci === col ? patch(c) : c) : r) } };
      }),
    }));
  }

  // ─── Undo / Redo ───────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    setRedoStack(stack => [...stack, doc]);
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(stack => stack.slice(0, -1));
    setDoc(prev);
    setDirty(true);
  }, [undoStack, doc]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    setUndoStack(stack => [...stack, doc]);
    const next = redoStack[redoStack.length - 1];
    setRedoStack(stack => stack.slice(0, -1));
    setDoc(next);
    setDirty(true);
  }, [redoStack, doc]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y') && (e.shiftKey || e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ─── Save / Export ─────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(doc);
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [doc, onSave]);

  // ─── Keyboard navigation on the grid ──────────────────────────────

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, col: number) => {
      if (editingCell) return; // Let input handle its own keys
      if (readOnly) return;

      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        startEdit(row, col, getCellValue(row, col));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        startEdit(row, col, '');
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Start typing into cell.
        //
        // `preventDefault` is REQUIRED here, and its absence was the one branch missing it.
        // `startEdit` seeds the editor with this keystroke, and React flushes the state update
        // synchronously (a keydown is a discrete event), so the <input autoFocus> is mounted and
        // focused before the browser applies this same keystroke's DEFAULT text insertion — which
        // then lands in the freshly focused input. The character arrives twice: typing "Direct
        // labor" into an empty cell produced "DDirect labor", and 184500 became 1184500. Caught by
        // driving the grid for the guide captures (docs/assets/guides/customer/24-canvas-sheet).
        e.preventDefault();
        startEdit(row, col, e.key);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveCell({ row: Math.min(row + 1, rows.length - 1), col });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveCell({ row: Math.max(row - 1, -1), col });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveCell({ row, col: Math.min(col + 1, colCount - 1) });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveCell({ row, col: Math.max(col - 1, 0) });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          setActiveCell({ row, col: Math.max(col - 1, 0) });
        } else {
          setActiveCell({ row, col: Math.min(col + 1, colCount - 1) });
        }
      }
    },
    [editingCell, readOnly, startEdit, getCellValue, rows.length, colCount],
  );

  // ─── Create default sheet if none exist ─────────────────────────────
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (sheets.length === 0 && !readOnly && !initialized) {
      const defaultTable = createNode({
        type: 'table',
        content: {
          headers: ['Column A', 'Column B', 'Column C', 'Column D'],
          rows: [
            ['', '', '', ''],
            ['', '', '', ''],
            ['', '', '', ''],
            ['', '', '', ''],
            ['', '', '', ''],
          ],
          sheet_name: 'Sheet 1',
        } as TableContent,
        source: 'manual',
        actorId,
        actorName,
      });

      updateDoc((prev) => ({
        ...prev,
        nodes: [...prev.nodes, defaultTable],
      }));
      setInitialized(true);
    }
  }, [sheets.length, readOnly, initialized, actorId, actorName, updateDoc]);

  // ─── Render ────────────────────────────────────────────────────────

  if (sheets.length === 0 && !readOnly) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Initializing spreadsheet...
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No sheets in this spreadsheet.
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-white ${overlayClass(overlays)}`}>
      {/* Structure overlays — Atoms outlines the sheet/table primitive; Provenance gutters it. */}
      <div className="border-b bg-white px-4 py-1.5">
        <CanvasOverlayBar
          active={overlays}
          onToggle={toggleOverlay}
          // A sheet is one grid primitive — `sections` says nothing here, and `groups` only when
          // this workbook actually carries them (today, none do).
          items={OVERLAYS.filter((o) => o.key === 'atoms' || o.key === 'provenance'
            || (o.key === 'groups' && documentHasGroups(doc)))}
        />
      </div>
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-white flex-shrink-0">
        {/* Document title */}
        <h2 className="font-semibold text-sm text-gray-800 truncate max-w-xs">
          {doc.metadata.title}
        </h2>

        <span
          className={`text-xs px-2 py-0.5 rounded ${
            doc.metadata.status === 'accepted'
              ? 'bg-green-100 text-green-700'
              : doc.metadata.status === 'review'
                ? 'bg-yellow-100 text-yellow-700'
                : doc.metadata.status === 'ai_drafted'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600'
          }`}
        >
          {doc.metadata.status.replace('_', ' ')}
        </span>

        {dirty && <span className="text-xs text-orange-500">unsaved</span>}

        <div className="flex-1" />

        {/* Cell reference */}
        <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded w-12 text-center">
          {activeCell
            ? `${colLetter(activeCell.col)}${activeCell.row === -1 ? 'H' : activeCell.row + 1}`
            : '-'}
        </span>

        {/* Formula bar */}
        <div className="flex items-center border rounded px-2 py-1 w-64">
          <span className="text-xs text-gray-400 mr-2">fx</span>
          <input
            type="text"
            value={
              editingCell
                ? editValue
                : activeCell
                  ? getCellValue(activeCell.row, activeCell.col)
                  : ''
            }
            onChange={(e) => {
              if (activeCell && !readOnly) {
                setEditValue(e.target.value);
                if (!editingCell) {
                  setEditingCell(activeCell);
                }
              }
            }}
            onBlur={() => {
              if (editingCell) commitEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === 'Escape') {
                cancelEdit();
              }
            }}
            className="flex-1 text-sm outline-none"
            placeholder="Select a cell"
            readOnly={readOnly}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-xs text-red-600 mr-2">{saveError}</span>
          )}
          {onExport && (
            <button
              onClick={async () => {
                try {
                  await onExport(doc, 'xlsx');
                } catch (err) {
                  setSaveError(err instanceof Error ? err.message : 'Export failed');
                }
              }}
              className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
            >
              Export .xlsx
            </button>
          )}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
            title={`Undo (Ctrl+Z) — ${undoStack.length} step${undoStack.length !== 1 ? 's' : ''}`}
          >
            Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
            title={`Redo (Ctrl+Shift+Z) — ${redoStack.length} step${redoStack.length !== 1 ? 's' : ''}`}
          >
            Redo
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Format bar ── */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1 border-b bg-gray-50 flex-shrink-0 text-xs">
          {/* Bold */}
          <button
            onClick={() => toggleCellBold()}
            className={`px-2 py-1 font-bold border rounded ${
              getActiveCellStyle()?.bold ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-gray-200 hover:bg-gray-100'
            }`}
            title="Bold"
          >B</button>

          {/* Alignment */}
          <span className="w-px h-4 bg-gray-300 mx-1" />
          {(['left', 'center', 'right'] as const).map(align => (
            <button
              key={align}
              onClick={() => setCellAlignment(align)}
              className={`px-2 py-1 border rounded ${
                getActiveCellStyle()?.alignment === align ? 'bg-blue-100 border-blue-300' : 'border-gray-200 hover:bg-gray-100'
              }`}
              title={`Align ${align}`}
            >
              {align === 'left' ? '⇤' : align === 'right' ? '⇥' : '⇔'}
            </button>
          ))}

          {/* Background color */}
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <label className="text-[10px] text-gray-500">Fill:</label>
          <input
            type="color"
            value={getActiveCellStyle()?.bg || '#ffffff'}
            onChange={(e) => setCellBg(e.target.value === '#ffffff' ? undefined : e.target.value)}
            className="w-6 h-6 border rounded cursor-pointer"
            title="Cell background color"
          />
          {getActiveCellStyle()?.bg && (
            <button onClick={() => setCellBg(undefined)} className="text-[10px] text-red-500 hover:underline">clear</button>
          )}

          {/* Text color (fg) */}
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <label className="text-[10px] text-gray-500 flex items-center gap-1">A
            <input
              type="color"
              value={getActiveCellStyle()?.fg || '#111827'}
              onChange={(e) => setCellFg(e.target.value)}
              className="w-6 h-6 border rounded cursor-pointer"
              title="Text color"
            />
          </label>
          {getActiveCellStyle()?.fg && (
            <button onClick={() => setCellFg(undefined)} className="text-[10px] text-red-500 hover:underline">clear</button>
          )}

          {/* Border (per cell) */}
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <label className="text-[10px] text-gray-500">Border:</label>
          <select
            value={getActiveCellStyle()?.border ?? 'thin'}
            onChange={(e) => setCellBorder(e.target.value as TableCellStyle['border'])}
            disabled={!activeCell}
            className="text-xs border rounded px-1 py-0.5 disabled:opacity-40"
            title="Cell border (also exported to .xlsx)"
          >
            <option value="none">None</option>
            <option value="thin">Thin</option>
            <option value="thick">Thick</option>
          </select>

          {/* Number format (per cell) — currency / percent / thousands. */}
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <label className="text-[10px] text-gray-500">Number:</label>
          <select
            value={getActiveCellNumberFormat()}
            onChange={(e) => setCellNumberFormat(e.target.value)}
            disabled={!activeCell}
            className="text-xs border rounded px-1 py-0.5 disabled:opacity-40"
            title="Number format (also carried into the .xlsx export)"
          >
            {NUMBER_FORMATS.map(f => (
              <option key={f.label} value={f.code}>{f.label}</option>
            ))}
          </select>

          {/* Sheet-wide defaults (NOT per-cell) — labelled so they aren't mistaken for the
              per-cell controls beside them. The cell model has no per-cell font size/family. */}
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <label className="text-[10px] text-gray-500">Sheet font:</label>
          <select
            value={doc.canvas.font_default.size}
            onChange={(e) => {
              updateDoc(prev => ({
                ...prev,
                canvas: {
                  ...prev.canvas,
                  font_default: { ...prev.canvas.font_default, size: parseInt(e.target.value) || 11 },
                },
              }));
            }}
            className="text-xs border rounded px-1 py-0.5"
          >
            {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Font family */}
          <select
            value={doc.canvas.font_default.family}
            onChange={(e) => {
              updateDoc(prev => ({
                ...prev,
                canvas: {
                  ...prev.canvas,
                  font_default: { ...prev.canvas.font_default, family: e.target.value },
                },
              }));
            }}
            className="text-xs border rounded px-1 py-0.5"
          >
            <option value="Calibri">Calibri</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Courier New">Courier New</option>
          </select>
        </div>
      )}

      {/* ── Media strip (images + shapes) ── */}
      <SheetMediaStrip
        nodes={doc.nodes}
        readOnly={readOnly}
        onAddImage={handleAddImageNode}
        onAddShape={handleAddShapeNode}
        onDelete={handleDeleteMediaNode}
      />

      {/* ── Grid ── (the provenance overlay borders this WRAPPER — outside the opaque cells —
          while the atoms overlay outlines the table itself). */}
      <div className="flex-1 overflow-auto cv-sheet-grid" data-node-source={currentSheet?.source}>
        <table
          className="border-collapse w-full"
          data-node-id={currentSheet?.nodeId}
        >
          <thead>
            {/* Column letter headers with delete buttons */}
            <tr className="bg-gray-100 sticky top-0 z-10">
              <th className="w-10 min-w-[40px] border border-gray-300 bg-gray-200 text-xs text-gray-500 py-1" />
              {Array.from({ length: colCount }, (_, ci) => (
                <th
                  key={ci}
                  className="border border-gray-300 bg-gray-200 text-xs text-gray-500 py-1 min-w-[100px]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>{colLetter(ci)}</span>
                    {!readOnly && colCount > 1 && (
                      <button
                        onClick={() => handleDeleteColumn(ci)}
                        className="text-[10px] text-gray-400 hover:text-red-500 leading-none"
                        title="Delete column"
                      >
                        x
                      </button>
                    )}
                  </div>
                </th>
              ))}
              {!readOnly && (
                <th className="w-8 border border-gray-300 bg-gray-100">
                  <button
                    onClick={handleAddColumn}
                    className="text-xs text-blue-500 hover:text-blue-700"
                    title="Add column"
                  >
                    +
                  </button>
                </th>
              )}
            </tr>

            {/* Header row from table */}
            <tr className="bg-gray-50 sticky top-[25px] z-10">
              <td className="border border-gray-300 bg-gray-200 text-xs text-center text-gray-500 py-1 font-medium">
                H
              </td>
              {Array.from({ length: colCount }, (_, ci) => {
                const h = headers[ci];
                const isActive =
                  activeCell?.row === -1 && activeCell?.col === ci;
                const isEditing =
                  editingCell?.row === -1 && editingCell?.col === ci;

                return (
                  <td
                    key={ci}
                    className={`border border-gray-300 px-2 py-1 text-sm font-semibold cursor-default ${
                      isActive
                        ? 'outline outline-2 outline-blue-500 bg-blue-50'
                        : ''
                    }`}
                    style={{
                      backgroundColor: !isActive && typeof h !== 'string' && h?.style?.bg ? h.style.bg : undefined,
                      color: typeof h !== 'string' && h?.style?.fg ? h.style.fg : undefined,
                      fontWeight: typeof h !== 'string' && h?.style?.bold ? 'bold' : undefined,
                      textAlign: typeof h !== 'string' ? h?.style?.alignment as React.CSSProperties['textAlign'] : undefined,
                      ...(typeof h !== 'string' ? borderCss(h?.style?.border) : {}),
                    }}
                    onClick={() => setActiveCell({ row: -1, col: ci })}
                    onKeyDown={(e) => handleCellKeyDown(e, -1, ci)}
                    tabIndex={isActive ? 0 : -1}
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitAndMove(1, 0);
                          }
                          if (e.key === 'Escape') cancelEdit();
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            commitAndMove(0, e.shiftKey ? -1 : 1);
                          }
                        }}
                        className="w-full bg-transparent outline-none text-sm font-semibold"
                        autoFocus
                      />
                    ) : (
                      <span
                        onDoubleClick={() =>
                          startEdit(-1, ci, h != null ? cellText(h) : '')
                        }
                      >
                        {h != null ? formatCellDisplay(h) : ''}
                      </span>
                    )}
                  </td>
                );
              })}
              {!readOnly && <td className="border border-gray-300 bg-gray-100" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="border border-gray-300 bg-gray-200 text-xs text-center text-gray-500 py-1">
                  {ri + 1}
                </td>
                {Array.from({ length: colCount }, (_, ci) => {
                  const c = row[ci];
                  const isActive =
                    activeCell?.row === ri && activeCell?.col === ci;
                  const isEditing =
                    editingCell?.row === ri && editingCell?.col === ci;

                  return (
                    <td
                      key={ci}
                      className={`border border-gray-300 px-2 py-1 text-sm cursor-default ${
                        isActive
                          ? 'outline outline-2 outline-blue-500 bg-blue-50'
                          : ''
                      }`}
                      style={{
                        backgroundColor: !isActive && typeof c !== 'string' && c?.style?.bg ? c.style.bg : undefined,
                        color: typeof c !== 'string' && c?.style?.fg ? c.style.fg : undefined,
                        fontWeight: typeof c !== 'string' && c?.style?.bold ? 'bold' : undefined,
                        textAlign: typeof c !== 'string' ? c?.style?.alignment as React.CSSProperties['textAlign'] : undefined,
                        ...(typeof c !== 'string' ? borderCss(c?.style?.border) : {}),
                      }}
                      onClick={() => setActiveCell({ row: ri, col: ci })}
                      onKeyDown={(e) => handleCellKeyDown(e, ri, ci)}
                      tabIndex={isActive ? 0 : -1}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitAndMove(1, 0);
                            }
                            if (e.key === 'Escape') cancelEdit();
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              commitAndMove(0, e.shiftKey ? -1 : 1);
                            }
                          }}
                          className="w-full bg-transparent outline-none text-sm"
                          autoFocus
                        />
                      ) : (
                        <span
                          onDoubleClick={() =>
                            startEdit(ri, ci, c != null ? cellText(c) : '')
                          }
                        >
                          {c != null ? formatCellDisplay(c) : ''}
                        </span>
                      )}
                    </td>
                  );
                })}
                {/* Delete row button */}
                {!readOnly && (
                  <td className="border border-gray-300 bg-gray-100 text-center">
                    {rows.length > 1 && (
                      <button
                        onClick={() => handleDeleteRow(ri)}
                        className="text-[10px] text-gray-400 hover:text-red-500 leading-none px-1"
                        title="Delete row"
                      >
                        x
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Add row button */}
        {!readOnly && (
          <button
            onClick={handleAddRow}
            className="w-full py-1 text-xs text-blue-600 hover:bg-blue-50 border-t"
          >
            + Add Row
          </button>
        )}
      </div>

      {/* ── Sheet tabs ── */}
      <div className="flex items-center gap-1 border-t bg-gray-50 px-2 py-1 flex-shrink-0">
        {sheets.map((sheet, i) => (
          <div
            key={sheet.nodeId}
            className={`flex items-center gap-0.5 px-3 py-1 text-xs rounded-t border ${
              clampedSheet === i
                ? 'bg-white border-b-white font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {renamingSheet === i ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => { commitSheetRename(i, renameValue); setRenamingSheet(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { commitSheetRename(i, renameValue); setRenamingSheet(null); }
                  if (e.key === 'Escape') setRenamingSheet(null);
                }}
                className="text-xs border rounded px-1 py-0.5 w-24"
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setActiveSheet(i);
                  setActiveCell(null);
                  setEditingCell(null);
                }}
                onDoubleClick={() => {
                  if (readOnly) return;
                  setRenamingSheet(i);
                  setRenameValue(sheet.name);
                }}
              >
                <span>{sheet.name}</span>
              </button>
            )}
            {!readOnly && sheets.length > 1 && (
              <button
                onClick={() => handleDeleteSheet(i)}
                className="text-[10px] text-gray-400 hover:text-red-500 leading-none ml-1"
                title="Delete sheet"
              >
                x
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            onClick={handleAddSheet}
            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
            title="Add sheet"
          >
            +
          </button>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-gray-400">
          {sheets.length} sheet{sheets.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
