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

import { useState, useCallback } from 'react';
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
} from '@/lib/types/canvas-document';

interface Props {
  document: CanvasDocument;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onUpdateNode: (nodeId: string, content: CanvasNode['content']) => void;
  variables?: Record<string, string>;
  readOnly?: boolean;
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
}: Props) {
  const { canvas, nodes, metadata } = doc;

  const contentWidth = canvas.width - canvas.margins.left - canvas.margins.right;
  const scale = Math.min(1, 750 / canvas.width);

  const fontStyle = {
    fontFamily: canvas.font_default.family,
    fontSize: `${canvas.font_default.size}pt`,
    lineHeight: canvas.line_spacing,
  };

  return (
    <div className="flex flex-col items-center gap-4 py-4 bg-gray-200 min-h-[600px]">
      {/* Page */}
      <div
        className="bg-white shadow-lg relative"
        style={{
          width: canvas.width * scale,
          minHeight: canvas.height * scale,
          padding: `${canvas.margins.top * scale}px ${canvas.margins.right * scale}px ${canvas.margins.bottom * scale}px ${canvas.margins.left * scale}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
        }}
      >
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

          {nodes.map((node) => (
            <NodeRenderer
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              onSelect={() => onSelectNode(node.id)}
              onUpdate={(content) => onUpdateNode(node.id, content)}
              scale={scale}
              fontDefault={canvas.font_default}
              readOnly={readOnly}
            />
          ))}
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
        {canvas.max_pages && (
          <>
            <span>&middot;</span>
            <span>
              ~{Math.min(canvas.max_pages, Math.ceil(nodes.length / 8))} of {canvas.max_pages} pages
            </span>
          </>
        )}
        <span>&middot;</span>
        <span>v{metadata.version_number}</span>
      </div>
    </div>
  );
}

// ─── Per-node renderer ──────────────────────────────────────────────

function NodeRenderer({
  node,
  isSelected,
  onSelect,
  onUpdate,
  scale,
  fontDefault,
  readOnly,
}: {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (content: CanvasNode['content']) => void;
  scale: number;
  fontDefault: { family: string; size: number };
  readOnly: boolean;
}) {
  const borderClass = isSelected
    ? 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50/30'
    : 'hover:ring-1 hover:ring-gray-200';

  const provenanceBadge = node.provenance.source === 'ai_draft'
    ? 'bg-yellow-100 text-yellow-700'
    : node.provenance.source === 'library'
    ? 'bg-indigo-100 text-indigo-700'
    : node.provenance.source === 'template'
    ? 'bg-gray-100 text-gray-500'
    : null;

  const nodeStyle: React.CSSProperties = {
    fontFamily: node.style.family ?? fontDefault.family,
    fontSize: node.style.size ? `${node.style.size * scale}pt` : undefined,
    fontWeight: node.style.weight,
    fontStyle: node.style.style,
    textAlign: node.style.alignment,
    marginLeft: node.style.indent ? node.style.indent * scale : undefined,
    paddingTop: (node.style.space_before ?? 4) * scale,
    paddingBottom: (node.style.space_after ?? 4) * scale,
  };

  return (
    <div
      className={`relative rounded px-1 cursor-pointer transition-all ${borderClass}`}
      style={nodeStyle}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {/* Provenance badge */}
      {provenanceBadge && isSelected && (
        <span className={`absolute -top-2 -right-1 text-[9px] px-1 py-0.5 rounded ${provenanceBadge}`}>
          {node.provenance.source.replace('_', ' ')}
        </span>
      )}

      {/* Type-specific rendering */}
      {node.type === 'heading' && <HeadingNode content={node.content as HeadingContent} scale={scale} />}
      {node.type === 'text_block' && <TextBlockNode content={node.content as TextBlockContent} readOnly={readOnly} onUpdate={onUpdate} isSelected={isSelected} />}
      {node.type === 'bulleted_list' && <ListNode content={node.content as ListContent} ordered={false} />}
      {node.type === 'numbered_list' && <ListNode content={node.content as ListContent} ordered={true} />}
      {node.type === 'image' && <ImageNode content={node.content as ImageContent} />}
      {node.type === 'table' && <TableNode content={node.content as TableContent} />}
      {node.type === 'caption' && <CaptionNode content={node.content as CaptionContent} />}
      {node.type === 'footnote' && <FootnoteNode content={node.content as FootnoteContent} />}
      {node.type === 'url' && <UrlNode content={node.content as UrlContent} />}
      {node.type === 'page_break' && <div className="border-t-2 border-dashed border-gray-300 my-4" />}
      {node.type === 'spacer' && <div className="h-8" />}
      {node.type === 'toc' && <div className="text-xs text-gray-400 italic py-2">[Table of Contents — auto-generated on export]</div>}
    </div>
  );
}

// ─── Node-type components ───────────────────────────────────────────

function HeadingNode({ content, scale }: { content: HeadingContent; scale: number }) {
  const sizes = { 1: 18, 2: 14, 3: 12 };
  return (
    <div
      className="font-bold"
      style={{ fontSize: `${(sizes[content.level] ?? 14) * scale}pt` }}
    >
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
  if (isSelected && !readOnly) {
    return (
      <textarea
        value={content.text}
        onChange={(e) => onUpdate({ ...content, text: e.target.value })}
        className="w-full resize-none border-0 bg-transparent outline-none"
        style={{ minHeight: '3em', fontFamily: 'inherit', fontSize: 'inherit' }}
        autoFocus
      />
    );
  }
  return <p className="whitespace-pre-wrap">{renderFormattedText(content)}</p>;
}

function ListNode({ content, ordered }: { content: ListContent; ordered: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1`}>
      {content.items.map((item, i) => (
        <li key={i} style={{ marginLeft: (item.indent_level ?? 0) * 20 }}>
          {item.text}
        </li>
      ))}
    </Tag>
  );
}

function ImageNode({ content }: { content: ImageContent }) {
  return (
    <div className="text-center py-2">
      <div
        className="inline-block bg-gray-100 border border-gray-200 rounded flex items-center justify-center text-gray-400 text-sm"
        style={{ width: Math.min(content.width, 400), height: Math.min(content.height, 300) }}
      >
        {content.alt_text || 'Image placeholder'}
      </div>
      {content.caption && (
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
    fontWeight: merged.bold ? 'bold' : undefined,
    textAlign: merged.alignment ?? undefined,
  };
}

function tableBorderClass(borderStyle?: 'none' | 'single' | 'double'): string {
  if (borderStyle === 'none') return '';
  if (borderStyle === 'double') return 'border-2 border-double border-gray-400';
  return 'border border-gray-300';
}

function TableNode({ content }: { content: TableContent }) {
  const outerBorder = tableBorderClass(content.border_style);
  const cellBorder = content.border_style === 'none'
    ? 'px-2 py-1'
    : content.border_style === 'double'
    ? 'border-2 border-double border-gray-400 px-2 py-1'
    : 'border border-gray-300 px-2 py-1';

  return (
    <table className={`w-full border-collapse text-sm my-2 ${outerBorder || 'border border-gray-300'}`}>
      <thead>
        <tr className="bg-gray-50">
          {content.headers.map((h, i) => {
            const cell = resolveTableCell(h);
            const styleProps = tableCellStyleProps(cell.style, content.header_style);
            return (
              <th
                key={i}
                className={`text-left font-semibold ${cellBorder}`}
                style={styleProps}
                rowSpan={cell.rowSpan}
                colSpan={cell.colSpan}
              >
                {cell.text}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {content.rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((c, ci) => {
              const cell = resolveTableCell(c);
              const styleProps = tableCellStyleProps(cell.style);
              return (
                <td
                  key={ci}
                  className={cellBorder}
                  style={styleProps}
                  rowSpan={cell.rowSpan}
                  colSpan={cell.colSpan}
                >
                  {cell.text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CaptionNode({ content }: { content: CaptionContent }) {
  return (
    <p className="text-sm italic text-center">
      <span className="font-semibold">{content.prefix} {content.number}:</span> {content.text}
    </p>
  );
}

function FootnoteNode({ content }: { content: FootnoteContent }) {
  return (
    <p className="text-xs text-gray-500 border-t border-gray-200 pt-1 mt-2">
      <sup className="font-semibold">{content.marker}</sup> {content.text}
    </p>
  );
}

function UrlNode({ content }: { content: UrlContent }) {
  return (
    <a href={content.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
      {content.display_text}
    </a>
  );
}
