'use client';

/**
 * CanvasToolbar — persistent formatting bar, always visible above the canvas.
 *
 * Groups:
 *   INSERT  — add a new block of the right type for this document format
 *   FORMAT  — act on the selected block: bold/italic/underline/strikethrough,
 *              alignment, size stepper, text color, background highlight
 *   MARK    — "Mark as Reuse" stamps the block red-italic (prior-proposal
 *              comparable content indicator, cleared by clicking again)
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
  { type: 'heading',       label: 'Heading',  icon: 'H'   },
  { type: 'text_block',   label: 'Text',     icon: '¶'   },
  { type: 'bulleted_list', label: 'Bullets',  icon: '•'   },
  { type: 'numbered_list', label: 'Numbered', icon: '1.'  },
  { type: 'table',         label: 'Table',    icon: '⊞'   },
  { type: 'image',         label: 'Image',    icon: '▨'   },
  { type: 'caption',       label: 'Caption',  icon: '""'  },
];

const TEXT_NODES = new Set([
  'heading', 'text_block', 'bulleted_list', 'numbered_list', 'caption', 'footnote', 'url',
]);

const ALIGNS: Array<{ value: NonNullable<NodeStyle['alignment']>; glyph: string; label: string }> = [
  { value: 'left',    glyph: '⇤', label: 'Align left'  },
  { value: 'center',  glyph: '↔', label: 'Center'       },
  { value: 'right',   glyph: '⇥', label: 'Align right' },
  { value: 'justify', glyph: '☰', label: 'Justify'      },
];

// ─── Highlight presets (plus full picker) ─────────────────────────────
const HIGHLIGHTS = [
  { color: '#fef08a', label: 'Yellow'  },
  { color: '#bbf7d0', label: 'Green'   },
  { color: '#bfdbfe', label: 'Blue'    },
  { color: '#fecaca', label: 'Red'     },
  { color: '#e9d5ff', label: 'Purple'  },
];

export function CanvasToolbar({ format, selectedNode, onAddNode, onUpdateNodeStyle, readOnly }: Props) {
  const isSlide   = format.startsWith('slide');
  const inserts   = INSERT.filter((i) => !(isSlide && i.type === 'caption'));
  const sel       = selectedNode;
  const canFormat = !!sel && TEXT_NODES.has(sel.type) && !readOnly;
  const size      = sel?.style.size;

  // ── Style helpers ─────────────────────────────────────────────────────
  const toggle = (field: keyof NodeStyle, value: unknown, offValue: unknown) => {
    if (!sel) return;
    const current = (sel.style as Record<string, unknown>)[field as string];
    onUpdateNodeStyle(sel.id, { [field]: current === value ? offValue : value } as Partial<NodeStyle>);
  };

  const setSize = (next: number) =>
    sel && onUpdateNodeStyle(sel.id, { size: Math.max(6, Math.min(72, next)) });

  // ── CSS class helpers ─────────────────────────────────────────────────
  const base   = 'inline-flex items-center justify-center h-7 min-w-[28px] px-1.5 rounded text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const idle   = 'border-gray-200 text-gray-600 hover:bg-gray-100';
  const on     = 'border-blue-300 bg-blue-100 text-blue-700';
  const sep    = <span className="mx-1 h-5 w-px bg-gray-200 shrink-0" aria-hidden />;

  // ── Active-state checks ──────────────────────────────────────────────
  const isBold   = canFormat && sel?.style.weight === 'bold';
  const isItalic = canFormat && sel?.style.style === 'italic';
  const isUnder  = canFormat && sel?.style.underline === true;
  const isStrike = canFormat && sel?.style.strikethrough === true;
  const isReuse  = canFormat && sel?.style.reuse_marker === true;

  return (
    <div className="sticky top-[41px] z-10 flex items-center gap-1 overflow-x-auto bg-white/97 backdrop-blur border-b px-3 py-1.5 shadow-sm">

      {/* ── INSERT ──────────────────────────────────────────────────── */}
      <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5 shrink-0">Insert</span>
      {inserts.map((i) => (
        <button
          key={i.type}
          type="button"
          disabled={readOnly}
          onClick={() => onAddNode(i.type, sel?.id)}
          className={`${base} ${idle} shrink-0`}
          title={`Insert ${i.label.toLowerCase()}${sel ? ' after selected block' : ''}`}
        >
          <span className="mr-0.5 text-gray-400 text-[10px]" aria-hidden>{i.icon}</span>
          {i.label}
        </button>
      ))}

      {sep}

      {/* ── FORMAT: weight / style / decoration ─────────────────────── */}
      <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5 shrink-0">Format</span>

      <button
        type="button" disabled={!canFormat}
        onClick={() => toggle('weight', 'bold', 'normal')}
        className={`${base} font-bold shrink-0 ${isBold ? on : idle}`}
        title="Bold (block-level)"
      >B</button>

      <button
        type="button" disabled={!canFormat}
        onClick={() => toggle('style', 'italic', 'normal')}
        className={`${base} italic shrink-0 ${isItalic ? on : idle}`}
        title="Italic (block-level)"
      >I</button>

      <button
        type="button" disabled={!canFormat}
        onClick={() => sel && onUpdateNodeStyle(sel.id, { underline: !sel.style.underline })}
        className={`${base} shrink-0 underline ${isUnder ? on : idle}`}
        title="Underline"
      >U</button>

      <button
        type="button" disabled={!canFormat}
        onClick={() => sel && onUpdateNodeStyle(sel.id, { strikethrough: !sel.style.strikethrough })}
        className={`${base} shrink-0 line-through ${isStrike ? on : idle}`}
        title="Strikethrough"
      >S</button>

      {sep}

      {/* ── ALIGNMENT ────────────────────────────────────────────────── */}
      {ALIGNS.map((a) => (
        <button
          key={a.value}
          type="button" disabled={!canFormat}
          onClick={() => sel && onUpdateNodeStyle(sel.id, { alignment: a.value })}
          className={`${base} shrink-0 ${canFormat && sel?.style.alignment === a.value ? on : idle}`}
          title={a.label}
        >{a.glyph}</button>
      ))}

      {sep}

      {/* ── SIZE ─────────────────────────────────────────────────────── */}
      <span className="flex items-center gap-0.5 shrink-0">
        <button type="button" disabled={!canFormat} onClick={() => setSize((size ?? 12) - 1)} className={`${base} ${idle}`} title="Smaller">A−</button>
        <span className="text-[11px] text-gray-500 w-8 text-center tabular-nums">{size ? `${size}pt` : '—'}</span>
        <button type="button" disabled={!canFormat} onClick={() => setSize((size ?? 12) + 1)} className={`${base} ${idle}`} title="Larger">A+</button>
      </span>

      {sep}

      {/* ── TEXT COLOR ───────────────────────────────────────────────── */}
      <label
        className={`flex items-center gap-1 shrink-0 cursor-pointer ${canFormat ? '' : 'opacity-40 pointer-events-none'}`}
        title="Text color"
      >
        <span className="text-[11px] text-gray-500 font-bold" aria-hidden>A</span>
        <input
          type="color"
          value={sel?.style.color || '#111827'}
          onChange={(e) => sel && onUpdateNodeStyle(sel.id, { color: e.target.value })}
          className="h-6 w-6 rounded border border-gray-200 cursor-pointer p-0"
        />
        {sel?.style.color && (
          <button
            type="button"
            onClick={() => sel && onUpdateNodeStyle(sel.id, { color: undefined })}
            className="text-[10px] text-gray-400 hover:text-rose-600 leading-none"
            title="Reset color"
          >✕</button>
        )}
      </label>

      {sep}

      {/* ── HIGHLIGHT ────────────────────────────────────────────────── */}
      <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5 shrink-0">Highlight</span>
      {HIGHLIGHTS.map((h) => (
        <button
          key={h.color}
          type="button"
          disabled={!canFormat}
          onClick={() => sel && onUpdateNodeStyle(sel.id, {
            background: sel.style.background === h.color ? undefined : h.color,
          })}
          className={`h-5 w-5 rounded border-2 shrink-0 transition-all ${
            canFormat && sel?.style.background === h.color
              ? 'border-gray-700 scale-110'
              : 'border-transparent hover:border-gray-400'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
          style={{ backgroundColor: h.color }}
          title={`Highlight ${h.label}`}
        />
      ))}
      {/* Full highlight color picker */}
      <label
        className={`flex items-center gap-1 shrink-0 cursor-pointer ${canFormat ? '' : 'opacity-40 pointer-events-none'}`}
        title="Custom highlight color"
      >
        <input
          type="color"
          value={sel?.style.background || '#ffffff'}
          onChange={(e) => sel && onUpdateNodeStyle(sel.id, { background: e.target.value })}
          className="h-5 w-5 rounded border border-gray-200 cursor-pointer p-0"
        />
      </label>
      {sel?.style.background && (
        <button
          type="button"
          disabled={!canFormat}
          onClick={() => sel && onUpdateNodeStyle(sel.id, { background: undefined })}
          className="text-[10px] text-gray-400 hover:text-rose-600 shrink-0"
          title="Clear highlight"
        >✕</button>
      )}

      {sep}

      {/* ── REUSE MARKER ─────────────────────────────────────────────── */}
      <button
        type="button"
        disabled={!canFormat}
        onClick={() => sel && onUpdateNodeStyle(sel.id, {
          reuse_marker: !sel.style.reuse_marker,
          // Clear any conflicting explicit color so reuse red takes precedence
          ...(sel.style.reuse_marker ? {} : { color: undefined }),
        })}
        className={`${base} shrink-0 font-medium ${isReuse ? 'border-red-300 bg-red-50 text-red-700' : idle}`}
        title={isReuse
          ? 'Remove reuse marker — clears the red-italic "from prior proposal" indicator'
          : 'Mark as Reuse — flags this block as carried from a prior proposal (red italic)'}
      >
        <span className={`mr-0.5 ${isReuse ? 'text-red-500' : 'text-gray-400'}`} aria-hidden>↩</span>
        {isReuse ? 'Reuse ✓' : 'Mark Reuse'}
      </button>

      {!sel && (
        <span className="ml-2 text-[11px] text-gray-400 shrink-0 italic">
          select a block to format
        </span>
      )}
    </div>
  );
}
