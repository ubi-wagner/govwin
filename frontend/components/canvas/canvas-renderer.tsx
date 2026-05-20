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

import { useState, useCallback, useRef, useEffect } from 'react';
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
      {node.type === 'toc' && <div className="text-xs text-gray-400 italic py-2">[Table of Contents — auto-generated on export]</div>}
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
          onChange={(e) => onUpdate({ ...content, text: e.target.value })}
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
        {content.items.map((item, i) => (
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
      {content.items.map((item, i) => (
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

  // Load presigned URL when we have a storage_key
  useEffect(() => {
    if (content.storage_key) {
      fetch(`/api/admin/storage?download=${encodeURIComponent(content.storage_key)}`)
        .then(res => res.json())
        .then(json => {
          if (json.data?.url) setImageUrl(json.data.url);
        })
        .catch(() => {});
    }
  }, [content.storage_key]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/documents/upload-image', {
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
    fontWeight: merged.bold ? 'bold' : undefined,
    textAlign: merged.alignment ?? undefined,
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
    const rows = content.rows.map(r => [...r]);
    const cell = resolveTableCell(rows[ri][ci]);
    rows[ri][ci] = { ...cell, text };
    onUpdate({ ...content, rows });
  };

  const addRow = () => {
    const newRow = content.headers.map(() => '' as string | TableCellType);
    onUpdate({ ...content, rows: [...content.rows, newRow] });
  };

  const addCol = () => {
    const headers = [...content.headers, `Column ${content.headers.length + 1}`] as typeof content.headers;
    const rows = content.rows.map(row => [...row, '']);
    onUpdate({ ...content, headers, rows });
  };

  const deleteRow = (ri: number) => {
    const rows = content.rows.filter((_, i) => i !== ri);
    onUpdate({ ...content, rows });
  };

  if (isSelected && !readOnly) {
    return (
      <div className="my-2">
        <table className={`w-full border-collapse text-sm ${outerBorder || 'border border-gray-300'}`}>
          <thead>
            <tr className="bg-gray-50">
              {content.headers.map((h, i) => {
                const cell = resolveTableCell(h);
                return (
                  <th key={i} className={`text-left font-semibold ${cellBorder}`}>
                    <input type="text" value={cell.text} onChange={(e) => updateHeader(i, e.target.value)}
                      className="w-full bg-transparent border-0 outline-none font-semibold text-sm" />
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
                  return (
                    <td key={ci} className={cellBorder}>
                      <input type="text" value={cell.text} onChange={(e) => updateCell(ri, ci, e.target.value)}
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
          {content.headers.map((h, i) => {
            const cell = resolveTableCell(h);
            const styleProps = tableCellStyleProps(cell.style, content.header_style);
            return (<th key={i} className={`text-left font-semibold ${cellBorder}`} style={styleProps} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{cell.text}</th>);
          })}
        </tr>
      </thead>
      <tbody>
        {content.rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((c, ci) => {
              const cell = resolveTableCell(c);
              const styleProps = tableCellStyleProps(cell.style);
              return (<td key={ci} className={cellBorder} style={styleProps} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>{cell.text}</td>);
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
