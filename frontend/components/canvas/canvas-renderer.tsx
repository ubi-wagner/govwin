'use client';

/**
 * Canvas Renderer — WYSIWYG page view that renders CanvasNodes at
 * the correct dimensions, margins, and font sizes. What you see here
 * IS what exports to Word/PDF/PPTX.
 *
 * The canvas shows:
 *   - Page dimensions matching the compliance requirement
 *   - Header/footer templates with variable substitution
 *   - Each node rendered inline with its type-specific component
 *   - Page break indicators + estimated page count
 *   - Click-to-select for node editing
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type {
  CanvasDocument,
  CanvasNode,
  HeadingContent,
  TextBlockContent,
  ListContent,
  ImageContent,
  TableContent,
  TableCell as TableCellType,
  TableCellStyle,
  CaptionContent,
  FootnoteContent,
  UrlContent,
  TextBoxContent,
  CalloutContent,
  CodeBlockContent,
  BlockquoteContent,
  EquationContent,
  DividerContent,
  VideoContent,
  SignatureContent,
} from '@/lib/types/canvas-document';
import { estimatePageCount, estimateSlideCount } from '@/lib/types/canvas-document';
import { renderShapeSvg, renderChartSvg } from '@/lib/export/canvas-html';
import { parseNumericText, isNumericCell, formatCellDisplay } from '@/lib/numeric-cell';
import type { ChartContent } from '@/lib/types/canvas-document';
import { WatermarkOverlay, statusToWatermark, ChangeIndicator } from './collaboration';

interface Props {
  document: CanvasDocument;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateNode: (nodeId: string, content: CanvasNode['content']) => void;
  variables?: Record<string, string>;
  readOnly?: boolean;
  onMoveNodeToIndex?: (nodeId: string, targetIndex: number) => void;
}

/**
 * NodeErrorBoundary — isolates a single canvas node's render. If ANY node throws (a
 * malformed table/list from an agent, import, or paste), it degrades to a small inline
 * notice instead of white-screening the entire proposal editor. Rock-solid by design:
 * the document keeps rendering; the bad block is saved and can be reloaded or edited.
 */
class NodeErrorBoundary extends React.Component<
  { nodeType: string; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { nodeType: string; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) {
    console.error('[canvas] node render failed (isolated):', this.props.nodeType, err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="my-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          This {this.props.nodeType.replace(/_/g, ' ')} block couldn’t be displayed — its content is still saved. Reload or edit it.
        </div>
      );
    }
    return this.props.children;
  }
}

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export function CanvasRenderer({
  document: doc,
  selectedNodeId,
  onSelectNode,
  onUpdateNode,
  variables = {},
  readOnly = false,
  onMoveNodeToIndex,
}: Props) {
  const { canvas, nodes, metadata } = doc;
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // Scale the page to the ACTUAL available column width (measured), so it fits
  // any viewport — including a Chrome split-screen half — instead of overflowing
  // a hardcoded 750px reference. Never upscale past 1; floor so it stays legible.
  const containerRef = useRef<HTMLDivElement>(null);
  const [availWidth, setAvailWidth] = useState(750);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setAvailWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const contentWidth = canvas.width - canvas.margins.left - canvas.margins.right;
  const scale = Math.min(1, Math.max(0.25, (availWidth - 32) / canvas.width));

  const fontStyle = {
    fontFamily: canvas.font_default.family,
    fontSize: `${canvas.font_default.size}pt`,
    lineHeight: canvas.line_spacing,
  };

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-4 py-4 bg-gray-200 min-h-[600px] overflow-x-hidden">
      {/* Page — honors canvas.background (deck/page fill) so what you see == what exports
          (pptx slide.background + the html/pdf page); falls back to the bg-white class. */}
      <div
        className="bg-white shadow-lg relative"
        style={{
          width: canvas.width * scale,
          minHeight: canvas.height * scale,
          padding: `${canvas.margins.top * scale}px ${canvas.margins.right * scale}px ${canvas.margins.bottom * scale}px ${canvas.margins.left * scale}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          background: canvas.background || undefined,
        }}
      >
        {/* Watermark overlay — behind content */}
        {statusToWatermark(metadata.status) && (
          <WatermarkOverlay text={statusToWatermark(metadata.status)!} />
        )}

        {/* Header */}
        {canvas.header && (
          <div
            className="absolute top-0 left-0 right-0 flex items-center border-b border-gray-200"
            style={{
              height: canvas.header.height * scale,
              paddingLeft: canvas.margins.left * scale,
              paddingRight: canvas.margins.right * scale,
              fontFamily: canvas.header.font.family,
              fontSize: `${canvas.header.font.size * scale}pt`,
              color: '#666',
            }}
          >
            {substituteVars(canvas.header.template, { ...variables, n: '1', N: '?' })}
          </div>
        )}

        {/* Content area */}
        <div
          className="relative"
          style={{
            ...fontStyle,
            fontSize: `${canvas.font_default.size * scale}pt`,
            maxWidth: contentWidth * scale,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onSelectNode(null);
          }}
        >
          {nodes.length === 0 && (
            <div className="text-center py-20 text-gray-300">
              <p className="text-lg">Empty document</p>
              <p className="text-sm mt-2">AI will draft content here, or start typing</p>
            </div>
          )}

          {nodes.map((node, i) => (
            <React.Fragment key={node.id}>
              {!readOnly && onMoveNodeToIndex && (
                <DropZone
                  onDrop={() => {
                    if (draggingNodeId) {
                      onMoveNodeToIndex(draggingNodeId, i);
                      setDraggingNodeId(null);
                    }
                  }}
                />
              )}
              <NodeErrorBoundary nodeType={node.type}>
              {node.type === 'toc' ? (
                <TocRenderer
                  nodes={nodes}
                  isSelected={selectedNodeId === node.id}
                  onSelect={() => onSelectNode(node.id)}
                  readOnly={readOnly}
                  nodeId={node.id}
                  isDragging={draggingNodeId === node.id}
                  onDragStart={() => setDraggingNodeId(node.id)}
                  onDragEnd={() => setDraggingNodeId(null)}
                />
              ) : (
                <NodeRenderer
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  onSelect={() => onSelectNode(node.id)}
                  onUpdate={(content) => onUpdateNode(node.id, content)}
                  scale={scale}
                  fontDefault={canvas.font_default}
                  readOnly={readOnly}
                  isDragging={draggingNodeId === node.id}
                  onDragStart={() => setDraggingNodeId(node.id)}
                  onDragEnd={() => setDraggingNodeId(null)}
                />
              )}
              </NodeErrorBoundary>
            </React.Fragment>
          ))}
          {/* Final drop zone at the end */}
          {!readOnly && onMoveNodeToIndex && (
            <DropZone
              onDrop={() => {
                if (draggingNodeId) {
                  onMoveNodeToIndex(draggingNodeId, nodes.length);
                  setDraggingNodeId(null);
                }
              }}
            />
          )}
        </div>

        {/* Footer */}
        {canvas.footer && (
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center border-t border-gray-200"
            style={{
              height: canvas.footer.height * scale,
              paddingLeft: canvas.margins.left * scale,
              paddingRight: canvas.margins.right * scale,
              fontFamily: canvas.footer.font.family,
              fontSize: `${canvas.footer.font.size * scale}pt`,
              color: '#666',
            }}
          >
            {substituteVars(canvas.footer.template, { ...variables, n: '1', N: '?' })}
          </div>
        )}
      </div>

      {/* Page info bar */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>{metadata.status.replace('_', ' ')}</span>
        <span>&middot;</span>
        <span>{nodes.length} atom{nodes.length !== 1 ? 's' : ''}</span>
        {/* Size gauge — show the REAL estimate (unclamped, so an over-limit doc reads
            red at its true count), in the unit that matches the format: slides for a
            deck, pages for a document. Uses the unified ruler the export gate enforces. */}
        {canvas.max_slides != null ? (
          (() => {
            const slides = estimateSlideCount(doc);
            const over = slides > canvas.max_slides;
            return (
              <>
                <span>&middot;</span>
                <span className={over ? 'text-rose-600 font-semibold' : undefined}>
                  ~{slides} of {canvas.max_slides} slides{over ? ' — over' : ''}
                </span>
              </>
            );
          })()
        ) : canvas.max_pages != null ? (
          (() => {
            const pages = estimatePageCount(doc);
            const over = pages > canvas.max_pages;
            return (
              <>
                <span>&middot;</span>
                <span className={over ? 'text-rose-600 font-semibold' : undefined}>
                  ~{pages} of {canvas.max_pages} pages{over ? ' — over' : ''}
                </span>
              </>
            );
          })()
        ) : null}
        <span>&middot;</span>
        <span>v{metadata.version_number}</span>
      </div>
    </div>
  );
}

// ─── Drop zone between nodes ────────────────────────────────────────

function DropZone({ onDrop }: { onDrop: () => void }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(); }}
      className={`h-1 -my-0.5 rounded transition-all ${
        dragOver ? 'h-3 bg-blue-200 border-2 border-dashed border-blue-400' : ''
      }`}
    />
  );
}

// ─── Drag handle icon ───────────────────────────────────────────────

function DragHandle({ nodeId, onDragStart, onDragEnd }: { nodeId: string; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <div
      // The grip is the ONLY drag initiator now — so dragging across the node's TEXT
      // makes a text selection (which pops the selection toolbar) instead of a reorder.
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', nodeId); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      title="Drag to reorder"
      className="absolute -left-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-opacity"
    >
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
        <circle cx="3" cy="2" r="1.5" />
        <circle cx="9" cy="2" r="1.5" />
        <circle cx="3" cy="8" r="1.5" />
        <circle cx="9" cy="8" r="1.5" />
        <circle cx="3" cy="14" r="1.5" />
        <circle cx="9" cy="14" r="1.5" />
      </svg>
    </div>
  );
}

// ─── TOC renderer — scans document headings ────────────────────────

function TocRenderer({ nodes, isSelected, onSelect, readOnly, nodeId, isDragging, onDragStart, onDragEnd }: {
  nodes: CanvasNode[];
  isSelected: boolean;
  onSelect: () => void;
  readOnly?: boolean;
  nodeId: string;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const headings = nodes
    .filter((n) => n.type === 'heading')
    .map((n) => {
      const content = n.content as HeadingContent;
      return { level: content.level, text: content.text, numbering: content.numbering };
    });

  const borderClass = isSelected
    ? 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50/30'
    : 'hover:ring-1 hover:ring-gray-200';

  return (
    <div
      className={`relative rounded px-1 cursor-pointer transition-all py-2 group ${borderClass} ${isDragging ? 'opacity-50' : ''}`}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {!readOnly && <DragHandle nodeId={nodeId} onDragStart={onDragStart} onDragEnd={onDragEnd} />}
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Table of Contents</div>
      {headings.length === 0 ? (
        <div className="text-xs text-gray-400 italic">No headings in document. Add Heading nodes to populate the TOC.</div>
      ) : (
        <div className="space-y-1">
          {headings.map((h, i) => (
            <div key={i} className="text-sm" style={{ paddingLeft: (h.level - 1) * 20 }}>
              <span className="text-gray-500">{h.numbering ? `${h.numbering} ` : ''}</span>
              <span className={h.level === 1 ? 'font-semibold text-gray-800' : h.level === 2 ? 'font-medium text-gray-700' : 'text-gray-600'}>
                {h.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Per-node renderer ──────────────────────────────────────────────

// The extended element types get a compact WYSIWYG preview in the editor (the
// full fidelity is in the exporters). shape/chart reuse the exact SVG the
// exporters rasterize, so what you see is what you get.
const EXTENDED_TYPES = new Set<CanvasNode['type']>([
  'shape', 'text_box', 'callout', 'code_block', 'blockquote', 'chart', 'equation', 'divider', 'video', 'signature',
]);

const CALLOUT_UI: Record<string, { bg: string; fg: string; border: string }> = {
  info: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#1D4ED8' },
  warning: { bg: '#FEF3C7', fg: '#B45309', border: '#B45309' },
  tip: { bg: '#ECFDF5', fg: '#047857', border: '#047857' },
  success: { bg: '#ECFDF5', fg: '#047857', border: '#047857' },
  note: { bg: '#F1F5F9', fg: '#475569', border: '#475569' },
};

function cssColorOf(hex?: string, opacity?: number): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace('#', '');
  if (opacity === undefined || opacity >= 1 || h.length < 6) return `#${h}`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/** A compact in-editor preview for the extended element types. */
function ExtendedNodePreview({ node }: { node: CanvasNode }) {
  const s = node.style ?? {};
  const c = (node.content ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case 'shape':
      return <div className="max-w-[340px] my-1" dangerouslySetInnerHTML={{ __html: renderShapeSvg(node) }} />;
    case 'chart':
      return <div className="max-w-[460px] my-1" dangerouslySetInnerHTML={{ __html: renderChartSvg(node.content as ChartContent) }} />;
    case 'text_box': {
      const box = c as unknown as TextBoxContent;
      return (
        <div style={{
          border: s.border ? `${s.border.width ?? 1}px ${s.border.style ?? 'solid'} ${s.border.color ?? '#CBD5E1'}` : '1px dashed #CBD5E1',
          background: cssColorOf(s.fill?.color, s.fill?.opacity), borderRadius: s.border?.radius, opacity: s.opacity,
          padding: '6px 8px',
        }} className="text-sm my-1">{box.text || 'Text box'}</div>
      );
    }
    case 'callout': {
      const cc = c as unknown as CalloutContent;
      const ui = CALLOUT_UI[cc.variant] ?? CALLOUT_UI.note;
      return (
        <div style={{ background: ui.bg, borderLeft: `4px solid ${ui.border}` }} className="rounded px-3 py-2 my-1 text-sm">
          {cc.title && <div style={{ color: ui.fg }} className="font-semibold">{cc.title}</div>}
          <div className="text-gray-700">{cc.text}</div>
        </div>
      );
    }
    case 'code_block':
      return <pre className="bg-slate-800 text-slate-100 rounded px-3 py-2 my-1 text-xs overflow-x-auto"><code>{(c as unknown as CodeBlockContent).code || '// code'}</code></pre>;
    case 'blockquote': {
      const bq = c as unknown as BlockquoteContent;
      return (
        <blockquote className="border-l-4 border-slate-400 pl-3 my-1 italic text-gray-600 text-sm">
          {bq.text}{bq.cite && <footer className="text-xs text-gray-400 not-italic mt-0.5">— {bq.cite}</footer>}
        </blockquote>
      );
    }
    case 'equation':
      return <div className="text-center my-1 font-serif italic text-gray-800">{(c as unknown as EquationContent).latex ?? (c as unknown as EquationContent).mathml ?? '(equation)'}</div>;
    case 'divider': {
      const d = c as unknown as DividerContent;
      return <hr style={{ borderTopWidth: d.thickness ?? 1, borderTopStyle: d.line_style ?? 'solid', borderColor: d.color ?? '#CBD5E1' }} className="my-2" />;
    }
    case 'video': {
      const v = c as unknown as VideoContent;
      return <div className="bg-slate-900 text-white rounded my-1 py-6 text-center text-sm"><span className="text-2xl">▶</span><div className="text-xs mt-1 text-slate-300">{v.caption ?? v.url ?? 'Video'}</div></div>;
    }
    case 'signature': {
      const sig = c as unknown as SignatureContent;
      return (
        <div className="my-2">
          {sig.signed && sig.signer_name && <div className="italic text-blue-900" style={{ fontFamily: 'cursive' }}>{sig.signer_name}</div>}
          <div className="border-b border-slate-700 w-56 h-4" />
          <div className="text-xs text-gray-500 mt-0.5">{sig.label ?? 'Signature'}{sig.signed_at ? `   ·   ${sig.signed_at}` : ''}</div>
        </div>
      );
    }
    default:
      return null;
  }
}

function NodeRenderer({
  node,
  isSelected,
  onSelect,
  onUpdate,
  scale,
  fontDefault,
  readOnly,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (content: CanvasNode['content']) => void;
  scale: number;
  fontDefault: { family: string; size: number };
  readOnly: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const borderClass = isSelected
    ? 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50/30'
    : 'hover:ring-1 hover:ring-gray-200';

  const provenanceBadge = node.provenance?.source === 'ai_draft'
    ? 'bg-yellow-100 text-yellow-700'
    : node.provenance?.source === 'library'
    ? 'bg-indigo-100 text-indigo-700'
    : node.provenance?.source === 'template'
    ? 'bg-gray-100 text-gray-500'
    : null;

  const isReuse = node.style.reuse_marker === true;
  const nodeStyle: React.CSSProperties = {
    fontFamily: node.style.family ?? fontDefault.family,
    fontSize: node.style.size ? `${node.style.size * scale}pt` : undefined,
    fontWeight: node.style.weight,
    fontStyle: isReuse ? 'italic' : node.style.style,
    textAlign: node.style.alignment,
    marginLeft: node.style.indent ? node.style.indent * scale : undefined,
    paddingTop: (node.style.space_before ?? 4) * scale,
    paddingBottom: (node.style.space_after ?? 4) * scale,
    color: isReuse ? '#dc2626' : (node.style.color ?? undefined),
    textDecoration: [
      node.style.underline ? 'underline' : null,
      node.style.strikethrough ? 'line-through' : null,
    ].filter(Boolean).join(' ') || undefined,
    backgroundColor: node.style.background ?? undefined,
  };

  // Free placement (Arrange): a node with an explicit position + a non-inline wrap is
  // absolutely placed — matching EXACTLY what the exporters do (lib/export/canvas-html.ts
  // + pptx-exporter). Rendering it here restores WYSIWYG: previously the editor ignored
  // node.position, so a positioned node looked in-flow yet exported free-placed. Units are
  // inches (as the export uses); the page's transform:scale scales them with everything else.
  const pos = node.position;
  const freePlaced = !!pos && (pos.wrap === 'float' || pos.wrap === 'behind' || pos.wrap === 'front');
  const posStyle: React.CSSProperties = freePlaced ? {
    position: 'absolute',
    left: typeof pos!.x === 'number' ? `${pos!.x}in` : undefined,
    top: typeof pos!.y === 'number' ? `${pos!.y}in` : undefined,
    width: typeof pos!.w === 'number' ? `${pos!.w}in` : undefined,
    height: typeof pos!.h === 'number' ? `${pos!.h}in` : undefined,
    zIndex: pos!.wrap === 'behind' ? 0 : (pos!.z ?? 5),
  } : {};

  return (
    <div
      data-node-id={node.id}
      data-node-source={node.provenance?.source}
      className={`relative rounded px-1 cursor-text transition-all group ${borderClass} ${isDragging ? 'opacity-50' : ''} ${freePlaced ? 'ring-1 ring-dashed ring-indigo-300' : ''}`}
      // The node body is NOT draggable (only the grip is) and the text is selectable, so a
      // mouse-drag across the text makes a real selection → pops the fluid selection toolbar,
      // instead of a drag-reorder. Reorder still works from the ⠿ grip.
      style={{ ...nodeStyle, ...posStyle, userSelect: readOnly ? undefined : 'text' }}
      onClick={(e) => {
        e.stopPropagation();
        // A click that ends a text drag-select must NOT swap the node into edit mode — that
        // would drop the selection and hide the fluid toolbar before you can act on it. Keep
        // the selection alive when one exists; a plain click (no selection) selects/edits.
        const s = window.getSelection();
        if (s && !s.isCollapsed && s.toString().trim()) return;
        onSelect();
      }}
    >
      {/* Drag handle — the sole drag initiator */}
      {!readOnly && <DragHandle nodeId={node.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />}

      {/* Provenance badge */}
      {provenanceBadge && isSelected && (
        <span className={`absolute -top-2 -right-1 text-[9px] px-1 py-0.5 rounded ${provenanceBadge}`}>
          {(node.provenance?.source ?? 'manual').replace('_', ' ')}
        </span>
      )}

      {/* Change indicator — show who last edited */}
      {node.history.length > 0 && (
        <div className="absolute -bottom-2 right-0">
          <ChangeIndicator
            history={node.history}
            compact={!isSelected}
          />
        </div>
      )}

      {/* Type-specific rendering */}
      {node.type === 'heading' && <HeadingNode content={node.content as HeadingContent} scale={scale} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'text_block' && <TextBlockNode content={node.content as TextBlockContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'bulleted_list' && <ListNode content={node.content as ListContent} ordered={false} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'numbered_list' && <ListNode content={node.content as ListContent} ordered={true} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'image' && <ImageNode content={node.content as ImageContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'table' && <TableNode content={node.content as TableContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'caption' && <CaptionNode content={node.content as CaptionContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'footnote' && <FootnoteNode content={node.content as FootnoteContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'url' && <UrlNode content={node.content as UrlContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'page_break' && <div className="border-t-2 border-dashed border-gray-300 my-4" />}
      {node.type === 'spacer' && <div className="h-8" />}
      {EXTENDED_TYPES.has(node.type) && <ExtendedNodePreview node={node} />}
      {/* toc nodes are rendered by TocRenderer at the parent level */}
    </div>
  );
}

// ─── Node-type components ───────────────────────────────────────────

function HeadingNode({ content, scale, readOnly, onUpdate, isSelected }: {
  content: HeadingContent; scale: number; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  const sizes = { 1: 18, 2: 14, 3: 12 };
  const fontSize = `${(sizes[content.level] ?? 14) * scale}pt`;

  if (isSelected && !readOnly) {
    return (
      <div className="flex items-center gap-2" style={{ fontSize }}>
        <select
          value={content.level}
          onChange={(e) => onUpdate({ ...content, level: Number(e.target.value) as 1 | 2 | 3 })}
          className="text-xs border rounded px-1 py-0.5 bg-white"
        >
          <option value={1}>H1</option>
          <option value={2}>H2</option>
          <option value={3}>H3</option>
        </select>
        <input
          type="text"
          value={content.numbering ?? ''}
          onChange={(e) => onUpdate({ ...content, numbering: e.target.value || undefined })}
          placeholder="#"
          className="w-10 text-xs border rounded px-1 py-0.5 text-center text-gray-500"
          title="Section numbering (e.g., 1.1)"
        />
        <input
          type="text"
          value={content.text}
          onChange={(e) => onUpdate({ ...content, text: e.target.value })}
          className="flex-1 font-bold border-0 bg-transparent outline-none"
          style={{ fontFamily: 'inherit', fontSize: 'inherit' }}
          autoFocus
        />
      </div>
    );
  }
  return (
    <div className="font-bold" style={{ fontSize }}>
      {content.numbering && <span className="mr-2">{content.numbering}</span>}
      {content.text}
    </div>
  );
}

function renderFormattedText(content: TextBlockContent): React.ReactNode {
  if (!content.inline_formats || content.inline_formats.length === 0) {
    return content.text;
  }

  const text = content.text;
  // Sort formats by start position for deterministic rendering
  const formats = [...content.inline_formats].sort((a, b) => a.start - b.start);

  // Build segments: collect all boundary points
  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(text.length);
  for (const f of formats) {
    boundaries.add(f.start);
    boundaries.add(f.start + f.length);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: React.ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segStart >= segEnd) continue;
    const segText = text.slice(segStart, segEnd);

    // Determine which formats apply to this segment
    const activeFormats = formats.filter(
      (f) => f.start <= segStart && f.start + f.length >= segEnd,
    );

    if (activeFormats.length === 0) {
      segments.push(<span key={i}>{segText}</span>);
    } else {
      let node: React.ReactNode = segText;
      for (const f of activeFormats) {
        switch (f.format) {
          case 'bold':
            node = <strong key={`${i}-b`}>{node}</strong>;
            break;
          case 'italic':
            node = <em key={`${i}-i`}>{node}</em>;
            break;
          case 'underline':
            node = <u key={`${i}-u`}>{node}</u>;
            break;
          case 'superscript':
            node = <sup key={`${i}-sup`}>{node}</sup>;
            break;
          case 'subscript':
            node = <sub key={`${i}-sub`}>{node}</sub>;
            break;
        }
      }
      segments.push(<span key={i}>{node}</span>);
    }
  }

  return <>{segments}</>;
}

function TextBlockNode({
  content, readOnly, onUpdate, isSelected,
}: {
  content: TextBlockContent;
  readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void;
  isSelected: boolean;
}) {
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyFormat = (format: 'bold' | 'italic' | 'underline' | 'superscript' | 'subscript') => {
    if (selStart === selEnd) return;
    const existing = content.inline_formats ?? [];
    const existingIdx = existing.findIndex(
      f => f.format === format && f.start === selStart && f.length === (selEnd - selStart)
    );
    if (existingIdx >= 0) {
      const updated = existing.filter((_, i) => i !== existingIdx);
      onUpdate({ ...content, inline_formats: updated });
    } else {
      const updated = [...existing, { format, start: selStart, length: selEnd - selStart }];
      onUpdate({ ...content, inline_formats: updated });
    }
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(selStart, selEnd);
      }
    }, 0);
  };

  const handleSelect = () => {
    if (textareaRef.current) {
      setSelStart(textareaRef.current.selectionStart);
      setSelEnd(textareaRef.current.selectionEnd);
    }
  };

  if (isSelected && !readOnly) {
    return (
      <div>
        <div className="flex items-center gap-0.5 mb-1 p-1 bg-gray-50 rounded border border-gray-200">
          <button type="button" onClick={() => applyFormat('bold')} className="px-2 py-0.5 text-xs font-bold hover:bg-gray-200 rounded" title="Bold">B</button>
          <button type="button" onClick={() => applyFormat('italic')} className="px-2 py-0.5 text-xs italic hover:bg-gray-200 rounded" title="Italic">I</button>
          <button type="button" onClick={() => applyFormat('underline')} className="px-2 py-0.5 text-xs underline hover:bg-gray-200 rounded" title="Underline">U</button>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <button type="button" onClick={() => applyFormat('superscript')} className="px-2 py-0.5 text-xs hover:bg-gray-200 rounded" title="Superscript">x<sup>2</sup></button>
          <button type="button" onClick={() => applyFormat('subscript')} className="px-2 py-0.5 text-xs hover:bg-gray-200 rounded" title="Subscript">x<sub>2</sub></button>
          {selStart !== selEnd && (
            <span className="ml-2 text-[10px] text-gray-400">chars {selStart}-{selEnd}</span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={content.text}
          onChange={(e) => {
            const newText = e.target.value;
            const oldText = content.text;
            const formats = content.inline_formats;

            if (!formats || formats.length === 0) {
              onUpdate({ ...content, text: newText });
              return;
            }

            // Detect the edit position and length change
            const textarea = e.target;
            const cursorPos = textarea.selectionStart;
            const lengthDiff = newText.length - oldText.length;

            // The edit happened at position (cursorPos - lengthDiff) in the old text
            // if lengthDiff > 0 (insertion), shift formats after the insertion point right
            // if lengthDiff < 0 (deletion), shift formats after the deletion point left
            const editStart = cursorPos - Math.max(0, lengthDiff);

            const adjustedFormats = formats
              .map(f => {
                const fEnd = f.start + f.length;

                if (lengthDiff > 0) {
                  // Insertion
                  if (f.start >= editStart) {
                    // Format is entirely after insertion — shift right
                    return { ...f, start: f.start + lengthDiff };
                  } else if (fEnd > editStart) {
                    // Insertion is inside the format — expand it
                    return { ...f, length: f.length + lengthDiff };
                  }
                  return f;
                } else if (lengthDiff < 0) {
                  // Deletion
                  const delLength = -lengthDiff;
                  const delEnd = editStart + delLength;

                  if (f.start >= delEnd) {
                    // Format is entirely after deletion — shift left
                    return { ...f, start: f.start + lengthDiff };
                  } else if (fEnd <= editStart) {
                    // Format is entirely before deletion — no change
                    return f;
                  } else if (f.start >= editStart && fEnd <= delEnd) {
                    // Format is entirely within deletion — remove it
                    return null;
                  } else if (f.start < editStart && fEnd > delEnd) {
                    // Deletion is inside format — shrink it
                    return { ...f, length: f.length + lengthDiff };
                  } else if (f.start < editStart) {
                    // Overlap at end of format
                    return { ...f, length: editStart - f.start };
                  } else {
                    // Overlap at start of format
                    const overlapEnd = delEnd - f.start;
                    return { ...f, start: editStart, length: f.length - overlapEnd };
                  }
                }
                return f;
              })
              .filter((f): f is NonNullable<typeof f> => f !== null && f.length > 0);

            onUpdate({ ...content, text: newText, inline_formats: adjustedFormats });
          }}
          onSelect={handleSelect}
          onMouseUp={handleSelect}
          onKeyUp={handleSelect}
          className="w-full resize-none border-0 bg-transparent outline-none"
          style={{ minHeight: '3em', fontFamily: 'inherit', fontSize: 'inherit' }}
          autoFocus
        />
      </div>
    );
  }
  return <p className="whitespace-pre-wrap">{renderFormattedText(content)}</p>;
}

function ListNode({ content, ordered, readOnly, onUpdate, isSelected }: {
  content: ListContent; ordered: boolean; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  if (isSelected && !readOnly) {
    return (
      <div className="space-y-1 pl-4">
        {(content.items ?? []).map((item, i) => (
          <div key={i} className="flex items-center gap-1" style={{ marginLeft: (item.indent_level ?? 0) * 20 }}>
            <span className="text-gray-400 text-xs w-4">{ordered ? `${i + 1}.` : '•'}</span>
            <input
              type="text"
              value={item.text}
              onChange={(e) => {
                const items = [...content.items];
                items[i] = { ...items[i], text: e.target.value };
                onUpdate({ ...content, items });
              }}
              className="flex-1 text-sm border-0 border-b border-gray-200 bg-transparent outline-none focus:border-blue-400 py-0.5"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const items = [...content.items];
                items[i] = { ...items[i], indent_level: Math.max(0, (items[i].indent_level ?? 0) - 1) };
                onUpdate({ ...content, items });
              }}
              className="text-gray-400 hover:text-gray-600 text-xs px-0.5"
              title="Outdent"
              disabled={(content.items[i].indent_level ?? 0) === 0}
            >{'<'}</button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const items = [...content.items];
                items[i] = { ...items[i], indent_level: (items[i].indent_level ?? 0) + 1 };
                onUpdate({ ...content, items });
              }}
              className="text-gray-400 hover:text-gray-600 text-xs px-0.5"
              title="Indent"
            >{'>'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); const items = content.items.filter((_, j) => j !== i); onUpdate({ ...content, items: items.length > 0 ? items : [{ text: '' }] }); }}
              className="text-red-400 hover:text-red-600 text-xs px-1"
              title="Remove item"
            >x</button>
          </div>
        ))}
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate({ ...content, items: [...content.items, { text: '' }] }); }}
          className="text-xs text-blue-600 hover:underline ml-4"
        >+ Add item</button>
      </div>
    );
  }
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1`}>
      {(content.items ?? []).map((item, i) => (
        <li key={i} style={{ marginLeft: (item.indent_level ?? 0) * 20 }}>
          {item.text}
        </li>
      ))}
    </Tag>
  );
}

function ImageNode({ content, readOnly, onUpdate, isSelected }: {
  content: ImageContent; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect portal vs admin context for storage endpoint
  const storageEndpoint = (() => {
    if (typeof window === 'undefined') return '/api/admin/storage';
    const path = window.location.pathname;
    if (path.includes('/portal/')) {
      const slug = path.split('/portal/')[1]?.split('/')[0];
      if (slug) return `/api/portal/${slug}/storage`;
    }
    return '/api/admin/storage';
  })();

  const uploadEndpoint = (() => {
    if (typeof window === 'undefined') return '/api/admin/documents/upload-image';
    const path = window.location.pathname;
    if (path.includes('/portal/')) {
      const slug = path.split('/portal/')[1]?.split('/')[0];
      if (slug) return `/api/portal/${slug}/uploads/image`;
    }
    return '/api/admin/documents/upload-image';
  })();

  // Load presigned URL when we have a storage_key
  useEffect(() => {
    if (content.storage_key) {
      fetch(`${storageEndpoint}?download=${encodeURIComponent(content.storage_key)}`)
        .then(res => res.json())
        .then(json => {
          if (json.data?.url) setImageUrl(json.data.url);
        })
        .catch(() => {});
    }
  }, [content.storage_key, storageEndpoint]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(uploadEndpoint, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      const json = await res.json();
      const { storageKey, url } = json.data;
      setImageUrl(url);

      // Get image dimensions
      const img = new window.Image();
      img.onload = () => {
        onUpdate({
          ...content,
          storage_key: storageKey,
          width: img.naturalWidth,
          height: img.naturalHeight,
          alt_text: content.alt_text || file.name,
        });
      };
      img.onerror = () => {
        onUpdate({
          ...content,
          storage_key: storageKey,
          alt_text: content.alt_text || file.name,
        });
      };
      img.src = url;
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  // Has image -- show it
  if (content.storage_key && imageUrl) {
    return (
      <div className="text-center py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={content.alt_text || 'Image'}
          style={{
            maxWidth: Math.min(content.width || 400, 500),
            maxHeight: Math.min(content.height || 300, 400),
            objectFit: 'contain',
          }}
          className="inline-block rounded"
        />
        {content.caption && (
          <p className="text-xs text-gray-500 mt-1 italic">{content.caption}</p>
        )}
        {isSelected && !readOnly && (
          <div className="mt-2 space-y-1">
            <input
              type="text"
              value={content.alt_text || ''}
              onChange={(e) => onUpdate({ ...content, alt_text: e.target.value })}
              placeholder="Alt text"
              className="text-xs border rounded px-2 py-1 w-full max-w-xs"
            />
            <input
              type="text"
              value={content.caption || ''}
              onChange={(e) => onUpdate({ ...content, caption: e.target.value })}
              placeholder="Caption"
              className="text-xs border rounded px-2 py-1 w-full max-w-xs"
            />
            <div className="flex items-center gap-2 mt-1">
              <label className="text-[10px] text-gray-400">W:</label>
              <input
                type="number"
                value={content.width || ''}
                onChange={(e) => onUpdate({ ...content, width: parseInt(e.target.value) || 400 })}
                className="w-16 text-xs border rounded px-1 py-0.5"
                min="50"
                max="2000"
              />
              <label className="text-[10px] text-gray-400">H:</label>
              <input
                type="number"
                value={content.height || ''}
                onChange={(e) => onUpdate({ ...content, height: parseInt(e.target.value) || 300 })}
                className="w-16 text-xs border rounded px-1 py-0.5"
                min="50"
                max="2000"
              />
              <span className="text-[10px] text-gray-400">px</span>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-blue-600 hover:underline"
            >
              Replace image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
            />
          </div>
        )}
      </div>
    );
  }

  // No image -- show upload zone or placeholder
  return (
    <div className="text-center py-2">
      {isSelected && !readOnly ? (
        <div className="inline-block">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="border-2 border-dashed border-gray-300 rounded-lg px-8 py-6 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
            style={{ width: Math.min(content.width || 400, 400), minHeight: 120 }}
          >
            {uploading ? 'Uploading...' : 'Click to upload image'}
          </button>
          <div className="mt-2 space-y-1">
            <input
              type="text"
              value={content.alt_text || ''}
              onChange={(e) => onUpdate({ ...content, alt_text: e.target.value })}
              placeholder="Alt text"
              className="text-xs border rounded px-2 py-1 w-full max-w-xs"
            />
            <input
              type="text"
              value={content.caption || ''}
              onChange={(e) => onUpdate({ ...content, caption: e.target.value })}
              placeholder="Caption"
              className="text-xs border rounded px-2 py-1 w-full max-w-xs"
            />
          </div>
        </div>
      ) : (
        <div
          className="inline-block bg-gray-100 border border-gray-200 rounded flex items-center justify-center text-gray-400 text-sm"
          style={{ width: Math.min(content.width || 400, 400), height: Math.min(content.height || 300, 200) }}
        >
          {content.alt_text || 'Image placeholder'}
        </div>
      )}
      {content.caption && !isSelected && (
        <p className="text-xs text-gray-500 mt-1 italic">{content.caption}</p>
      )}
    </div>
  );
}

function resolveTableCell(cell: string | TableCellType): TableCellType {
  return typeof cell === 'string' ? { text: cell } : cell;
}

function tableCellStyleProps(style?: TableCellStyle, fallback?: TableCellStyle): React.CSSProperties {
  const merged = { ...fallback, ...style };
  return {
    backgroundColor: merged.bg ?? undefined,
    color: merged.fg ?? undefined,
    fontWeight: merged.bold ? 'bold' : undefined,
    textAlign: merged.alignment ?? undefined,
    ...(merged.border === 'none' ? { borderColor: 'transparent' }
      : merged.border === 'thick' ? { borderWidth: 2, borderColor: '#334155' } : {}),
  };
}

function tableBorderClass(borderStyle?: 'none' | 'single' | 'double'): string {
  if (borderStyle === 'none') return '';
  if (borderStyle === 'double') return 'border-2 border-double border-gray-400';
  return 'border border-gray-300';
}

function TableNode({ content, readOnly, onUpdate, isSelected }: {
  content: TableContent; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  const [focusedCell, setFocusedCell] = useState<{ kind: 'h' | 'b'; ri: number; ci: number } | null>(null);
  const outerBorder = tableBorderClass(content.border_style);
  const cellBorder = content.border_style === 'none'
    ? 'px-2 py-1'
    : content.border_style === 'double'
    ? 'border-2 border-double border-gray-400 px-2 py-1'
    : 'border border-gray-300 px-2 py-1';

  const updateHeader = (i: number, text: string) => {
    const headers = [...content.headers];
    const cell = resolveTableCell(headers[i]);
    headers[i] = { ...cell, text };
    onUpdate({ ...content, headers });
  };

  const updateCell = (ri: number, ci: number, text: string) => {
    const rows = (content.rows ?? []).map(r => [...r]);
    const cell = resolveTableCell(rows[ri][ci]);
    const next: TableCellType = { ...cell, text };
    // Keep a numeric cell's machine `value` in sync with the edited text — exports (docx/xlsx/pdf)
    // and the cost readiness roll-up read `value`, so a stale value silently ignores the edit.
    if (isNumericCell(cell)) { const v = parseNumericText(text); next.value = v == null ? undefined : v; }
    rows[ri][ci] = next;
    onUpdate({ ...content, rows });
  };

  const addRow = () => {
    const newRow = (content.headers ?? []).map(() => '' as string | TableCellType);
    onUpdate({ ...content, rows: [...content.rows, newRow] });
  };

  const addCol = () => {
    const headers = [...content.headers, `Column ${content.headers.length + 1}`] as typeof content.headers;
    const rows = (content.rows ?? []).map(row => [...row, '']);
    onUpdate({ ...content, headers, rows });
  };

  const deleteRow = (ri: number) => {
    const rows = content.rows.filter((_, i) => i !== ri);
    onUpdate({ ...content, rows });
  };

  const deleteCol = (colIndex: number) => {
    if (content.headers.length <= 1) return;
    const headers = content.headers.filter((_, i) => i !== colIndex);
    const rows = (content.rows ?? []).map(row => row.filter((_, i) => i !== colIndex));
    onUpdate({ ...content, headers, rows });
  };

  // ── Per-cell styling (doc mode) — bold / align / background on the focused cell.
  // The renderer + all exporters already honor TableCellStyle; this adds the editing
  // affordance that doc mode lacked (previously only spreadsheet mode could style cells).
  const focusedStyle: TableCellStyle | undefined = focusedCell
    ? resolveTableCell(focusedCell.kind === 'h' ? content.headers[focusedCell.ci] : content.rows[focusedCell.ri]?.[focusedCell.ci]).style
    : undefined;
  const styleFocusedCell = (patch: Partial<TableCellStyle>) => {
    if (!focusedCell) return;
    if (focusedCell.kind === 'h') {
      const headers = [...content.headers];
      const cell = resolveTableCell(headers[focusedCell.ci]);
      headers[focusedCell.ci] = { ...cell, style: { ...cell.style, ...patch } };
      onUpdate({ ...content, headers });
    } else {
      const rows = (content.rows ?? []).map(r => [...r]);
      const cell = resolveTableCell(rows[focusedCell.ri][focusedCell.ci]);
      rows[focusedCell.ri][focusedCell.ci] = { ...cell, style: { ...cell.style, ...patch } };
      onUpdate({ ...content, rows });
    }
  };

  if (isSelected && !readOnly) {
    const cellToolbar = (
      <div className={`flex items-center gap-1 mb-1 text-xs ${focusedCell ? '' : 'opacity-40 pointer-events-none'}`}>
        <span className="text-[10px] text-gray-400 mr-1">{focusedCell ? 'Cell:' : 'Select a cell'}</span>
        <button onMouseDown={(e) => { e.preventDefault(); styleFocusedCell({ bold: !focusedStyle?.bold }); }}
          className={`px-2 py-0.5 font-bold border rounded ${focusedStyle?.bold ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-gray-200'}`} title="Bold">B</button>
        {(['left', 'center', 'right'] as const).map(a => (
          <button key={a} onMouseDown={(e) => { e.preventDefault(); styleFocusedCell({ alignment: a }); }}
            className={`px-2 py-0.5 border rounded ${focusedStyle?.alignment === a ? 'bg-blue-100 border-blue-300' : 'border-gray-200'}`} title={`Align ${a}`}>
            {a === 'left' ? '⇤' : a === 'right' ? '⇥' : '⇔'}</button>
        ))}
        <label className="ml-1 text-[10px] text-gray-500 flex items-center gap-1">Fill
          <input type="color" value={focusedStyle?.bg || '#ffffff'} onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => styleFocusedCell({ bg: e.target.value === '#ffffff' ? undefined : e.target.value })}
            className="h-5 w-5 border rounded cursor-pointer p-0" title="Cell background" /></label>
        {focusedStyle?.bg && <button onMouseDown={(e) => { e.preventDefault(); styleFocusedCell({ bg: undefined }); }} className="text-[10px] text-rose-500 hover:underline">clear</button>}
      </div>
    );
    return (
      <div className="my-2">
        {cellToolbar}
        <table className={`w-full border-collapse text-sm ${outerBorder || 'border border-gray-300'}`}>
          <thead>
            <tr className="bg-gray-50">
              {(content.headers ?? []).map((h, i) => {
                const cell = resolveTableCell(h);
                return (
                  <th key={i} className={`text-left font-semibold ${cellBorder}`}>
                    <div className="flex flex-col">
                      <input type="text" value={cell.text} onChange={(e) => updateHeader(i, e.target.value)}
                        onFocus={() => setFocusedCell({ kind: 'h', ri: -1, ci: i })}
                        className="w-full bg-transparent border-0 outline-none font-semibold text-sm" />
                      {content.headers.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCol(i); }}
                          className="text-[9px] text-red-400 hover:text-red-600 leading-none self-center mt-0.5"
                          title="Delete column"
                        >x</button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(content.rows ?? []).map((row, ri) => (
              <tr key={ri}>
                {row.map((c, ci) => {
                  const cell = resolveTableCell(c);
                  return (
                    <td key={ci} className={cellBorder}>
                      <input type="text" value={cell.text} onChange={(e) => updateCell(ri, ci, e.target.value)}
                        onFocus={() => setFocusedCell({ kind: 'b', ri, ci })}
                        className="w-full bg-transparent border-0 outline-none text-sm" />
                    </td>
                  );
                })}
                <td className="px-1">
                  <button onClick={(e) => { e.stopPropagation(); deleteRow(ri); }} className="text-red-400 hover:text-red-600 text-xs">x</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2 mt-1">
          <button onClick={(e) => { e.stopPropagation(); addRow(); }} className="text-xs text-blue-600 hover:underline">+ Row</button>
          <button onClick={(e) => { e.stopPropagation(); addCol(); }} className="text-xs text-blue-600 hover:underline">+ Column</button>
        </div>
      </div>
    );
  }

  return (
    <table className={`w-full border-collapse text-sm my-2 ${outerBorder || 'border border-gray-300'}`}>
      <thead>
        <tr className="bg-gray-50">
          {(content.headers ?? []).map((h, i) => {
            const cell = resolveTableCell(h);
            const styleProps = tableCellStyleProps(cell.style, content.header_style);
            return (<th key={i} className={`text-left font-semibold ${cellBorder}`} style={styleProps} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{cell.text}</th>);
          })}
        </tr>
      </thead>
      <tbody>
        {(content.rows ?? []).map((row, ri) => (
          <tr key={ri}>
            {row.map((c, ci) => {
              const cell = resolveTableCell(c);
              const styleProps = tableCellStyleProps(cell.style);
              return (<td key={ci} className={cellBorder} style={styleProps} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{formatCellDisplay(cell)}</td>);
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CaptionNode({ content, readOnly, onUpdate, isSelected }: {
  content: CaptionContent; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  if (isSelected && !readOnly) {
    return (
      <div className="flex items-center gap-2 text-sm italic text-center">
        <select value={content.prefix} onChange={(e) => onUpdate({ ...content, prefix: e.target.value as CaptionContent['prefix'] })}
          className="text-xs border rounded px-1 py-0.5 bg-white">
          <option value="Figure">Figure</option>
          <option value="Table">Table</option>
          <option value="Chart">Chart</option>
        </select>
        <input type="number" value={content.number} onChange={(e) => onUpdate({ ...content, number: parseInt(e.target.value) || 1 })}
          className="w-12 text-xs border rounded px-1 py-0.5" />
        <input type="text" value={content.text} onChange={(e) => onUpdate({ ...content, text: e.target.value })}
          className="flex-1 border-0 bg-transparent outline-none italic" autoFocus />
      </div>
    );
  }
  return (
    <p className="text-sm italic text-center">
      <span className="font-semibold">{content.prefix} {content.number}:</span> {content.text}
    </p>
  );
}

function FootnoteNode({ content, readOnly, onUpdate, isSelected }: {
  content: FootnoteContent; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  if (isSelected && !readOnly) {
    return (
      <div className="text-xs text-gray-500 border-t border-gray-200 pt-1 mt-2 flex items-start gap-1">
        <input type="text" value={content.marker} onChange={(e) => onUpdate({ ...content, marker: e.target.value })}
          className="w-8 border rounded px-1 py-0.5 text-xs font-semibold" />
        <input type="text" value={content.text} onChange={(e) => onUpdate({ ...content, text: e.target.value })}
          className="flex-1 border-0 bg-transparent outline-none text-xs" autoFocus />
      </div>
    );
  }
  return (
    <p className="text-xs text-gray-500 border-t border-gray-200 pt-1 mt-2">
      <sup className="font-semibold">{content.marker}</sup> {content.text}
    </p>
  );
}

function UrlNode({ content, readOnly, onUpdate, isSelected }: {
  content: UrlContent; readOnly: boolean;
  onUpdate: (c: CanvasNode['content']) => void; isSelected: boolean;
}) {
  if (isSelected && !readOnly) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">URL:</label>
          <input type="url" value={content.href} onChange={(e) => onUpdate({ ...content, href: e.target.value })}
            className="flex-1 text-xs border rounded px-2 py-1" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-12">Text:</label>
          <input type="text" value={content.display_text} onChange={(e) => onUpdate({ ...content, display_text: e.target.value })}
            className="flex-1 text-xs border rounded px-2 py-1" />
        </div>
      </div>
    );
  }
  return (
    <a href={content.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
      {content.display_text}
    </a>
  );
}
