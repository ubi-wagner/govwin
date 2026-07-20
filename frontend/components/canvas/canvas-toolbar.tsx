'use client';

/**
 * CanvasToolbar — the always-visible formatting bar for the canvas editor.
 *
 * Puts the common authoring actions where a user expects them (a Google-Docs /
 * Word style toolbar) instead of buried in side-rail tabs: an INSERT group
 * (add the right block for this document type) and a FORMAT group (bold, italic,
 * alignment, size, color) that acts on the selected block. Purely presentational
 * — it drives the editor's existing handlers, so undo/redo/save all still apply.
 */
import type { CanvasNode, NodeType, NodeStyle } from '@/lib/types/canvas-document';

interface Props {
  format: string;
  selectedNode: CanvasNode | null;
  onAddNode: (type: NodeType, afterId?: string) => void;
  onUpdateNodeStyle: (nodeId: string, style: Partial<NodeStyle>) => void;
  readOnly?: boolean;
}

const INSERT: Array<{ type: NodeType; label: string; icon: string; hideFor?: string[] }> = [
  { type: 'heading', label: 'Heading', icon: 'H' },
  { type: 'text_block', label: 'Text', icon: '¶' },
  { type: 'bulleted_list', label: 'Bullets', icon: '•' },
  { type: 'numbered_list', label: 'Numbered', icon: '1.' },
  { type: 'table', label: 'Table', icon: '⊞' },
  { type: 'image', label: 'Image', icon: '▨' },
  { type: 'caption', label: 'Caption', icon: '“”' },
];

const TEXT_NODES = new Set(['heading', 'text_block', 'bulleted_list', 'numbered_list', 'caption', 'footnote', 'url']);
const ALIGNS: Array<{ value: NonNullable<NodeStyle['alignment']>; glyph: string; label: string }> = [
  { value: 'left', glyph: '⇤', label: 'Align left' },
  { value: 'center', glyph: '↔', label: 'Center' },
  { value: 'right', glyph: '⇥', label: 'Align right' },
  { value: 'justify', glyph: '☰', label: 'Justify' },
];

export function CanvasToolbar({ format, selectedNode, onAddNode, onUpdateNodeStyle, readOnly }: Props) {
  const isSlide = format.startsWith('slide');
  const inserts = INSERT.filter((i) => !(isSlide && i.type === 'caption'));
  const sel = selectedNode;
  const canFormat = !!sel && TEXT_NODES.has(sel.type) && !readOnly;
  const size = sel?.style.size;

  const btn = 'inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const idle = 'border-gray-200 text-gray-600 hover:bg-gray-100';
  const active = 'border-blue-300 bg-blue-100 text-blue-700';

  const setSize = (next: number) => sel && onUpdateNodeStyle(sel.id, { size: Math.max(6, Math.min(72, next)) });

  return (
    <div className="sticky top-[41px] z-10 flex items-center gap-1 overflow-x-auto bg-white/95 backdrop-blur border-b px-3 py-1.5">
      {/* Insert group */}
      <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1 shrink-0">Insert</span>
      {inserts.map((i) => (
        <button
          key={i.type}
          type="button"
          disabled={readOnly}
          onClick={() => onAddNode(i.type, sel?.id)}
          className={`${btn} ${idle} shrink-0`}
          title={`Insert ${i.label.toLowerCase()}${sel ? ' after the selected block' : ''}`}
        >
          <span className="mr-1 text-gray-400" aria-hidden>{i.icon}</span>{i.label}
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-gray-200 shrink-0" aria-hidden />

      {/* Format group — acts on the selected text block */}
      <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1 shrink-0">Format</span>
      <button
        type="button" disabled={!canFormat}
        onClick={() => sel && onUpdateNodeStyle(sel.id, { weight: sel.style.weight === 'bold' ? 'normal' : 'bold' })}
        className={`${btn} font-bold shrink-0 ${canFormat && sel?.style.weight === 'bold' ? active : idle}`}
        title="Bold"
      >B</button>
      <button
        type="button" disabled={!canFormat}
        onClick={() => sel && onUpdateNodeStyle(sel.id, { style: sel.style.style === 'italic' ? 'normal' : 'italic' })}
        className={`${btn} italic shrink-0 ${canFormat && sel?.style.style === 'italic' ? active : idle}`}
        title="Italic"
      >I</button>

      {ALIGNS.map((a) => (
        <button
          key={a.value}
          type="button" disabled={!canFormat}
          onClick={() => sel && onUpdateNodeStyle(sel.id, { alignment: a.value })}
          className={`${btn} shrink-0 ${canFormat && sel?.style.alignment === a.value ? active : idle}`}
          title={a.label}
        >{a.glyph}</button>
      ))}

      {/* Size stepper */}
      <span className="ml-1 flex items-center gap-0.5 shrink-0">
        <button type="button" disabled={!canFormat} onClick={() => setSize((size ?? 12) - 1)} className={`${btn} ${idle}`} title="Smaller">A−</button>
        <span className="text-[11px] text-gray-500 w-8 text-center tabular-nums">{size ? `${size}pt` : '—'}</span>
        <button type="button" disabled={!canFormat} onClick={() => setSize((size ?? 12) + 1)} className={`${btn} ${idle}`} title="Larger">A+</button>
      </span>

      {/* Color */}
      <label className={`ml-1 flex items-center gap-1 shrink-0 ${canFormat ? '' : 'opacity-40 pointer-events-none'}`} title="Text color">
        <span className="text-[11px] text-gray-500" aria-hidden>A</span>
        <input
          type="color"
          value={sel?.style.color || '#111827'}
          onChange={(e) => sel && onUpdateNodeStyle(sel.id, { color: e.target.value })}
          className="h-6 w-6 rounded border border-gray-200 cursor-pointer p-0"
        />
        {sel?.style.color && (
          <button type="button" onClick={() => sel && onUpdateNodeStyle(sel.id, { color: undefined })} className="text-[10px] text-gray-400 hover:text-rose-600" title="Reset color">✕</button>
        )}
      </label>

      {!sel && <span className="ml-2 text-[11px] text-gray-400 shrink-0">select a block to format</span>}
    </div>
  );
}
