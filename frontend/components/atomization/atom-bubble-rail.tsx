'use client';

import { useState, type ReactNode } from 'react';

/**
 * One atom-candidate / annotation shown as a click-open "bubble" in the rail.
 * Sourced from the shared atom model (library_units.canvas_nodes + SourceAnchor),
 * so the SAME rail serves admin RFP curation, the portal library, the canvas, and
 * (soon) agents that populate/accept bubbles programmatically.
 */
export interface AtomBubble {
  id: string;
  heading: string;
  snippet?: string | null;
  /** 1-based page, for anchored (rendered-doc) contexts — click scrolls the viewer. */
  page?: number | null;
  /** Canvas node kind, drives the little glyph: heading / text_block / table / image / list. */
  nodeType?: string | null;
  /** Pre-filled suggestion (from the heading) so the human just confirms — not blank entry. */
  suggestedType?: string | null;
  /** Currently assigned section_standards key (if already classified). */
  sectionType?: string | null;
  /** Multiple side tags that accumulate as the atom moves upload → library → proposal. */
  tags?: string[] | null;
  status?: 'draft' | 'approved' | 'archived' | string | null;
}

export interface AtomBubbleRailProps {
  title?: string;
  items: AtomBubble[];
  /** section_standards taxonomy for the type dropdown (canonical, shared with matching). */
  standards: Array<{ key: string; label: string }>;
  onClassify: (id: string, sectionTypeKey: string) => void | Promise<void>;
  onAccept: (id: string) => void | Promise<void>;
  onAcceptAll?: () => void | Promise<void>;
  /** Multi-tag: add/remove side tags that carry through the lifecycle (tags[]). */
  onAddTag?: (id: string, tag: string) => void | Promise<void>;
  onRemoveTag?: (id: string, tag: string) => void | Promise<void>;
  /** Click the bubble body → highlight/scroll to it in the document view. */
  onBubbleClick?: (id: string) => void;
  busyId?: string | null;
  emptyText?: string;
  className?: string;
}

const NODE_GLYPH: Record<string, string> = {
  heading: '⌗',
  text_block: '¶',
  bulleted_list: '•',
  numbered_list: '#',
  table: '▦',
  image: '🖼',
};

function statusChip(status?: string | null): ReactNode {
  const s = status ?? 'draft';
  const cls =
    s === 'approved' ? 'bg-green-100 text-green-700'
    : s === 'archived' ? 'bg-gray-100 text-gray-500'
    : 'bg-amber-100 text-amber-700';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{s}</span>;
}

/**
 * The reusable right-rail. Frictionless by design: each bubble pre-selects its
 * suggested type, Accept is one click, and "Accept all" bulk-approves. It is pure
 * UI — the parent supplies the data + wires onClassify/onAccept to real APIs, so it
 * drops onto any upload surface unchanged.
 */
export function AtomBubbleRail({
  title = 'Atoms',
  items,
  standards,
  onClassify,
  onAccept,
  onAcceptAll,
  onAddTag,
  onRemoveTag,
  onBubbleClick,
  busyId,
  emptyText = 'No atoms yet — upload a document to atomize.',
  className = '',
}: AtomBubbleRailProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const pending = items.filter((i) => (i.status ?? 'draft') === 'draft').length;

  return (
    <aside className={`w-80 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col ${className}`}>
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-white">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          <p className="text-[11px] text-gray-500">{items.length} atoms · {pending} to review</p>
        </div>
        {onAcceptAll && pending > 0 && (
          <button
            onClick={() => onAcceptAll()}
            className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-2.5 py-1"
          >
            Accept all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-4">{emptyText}</p>
        ) : (
          items.map((it) => {
            const open = openId === it.id;
            const effectiveType = it.sectionType ?? it.suggestedType ?? '';
            const typeLabel = standards.find((s) => s.key === effectiveType)?.label;
            const busy = busyId === it.id;
            return (
              <div key={it.id} className={`rounded-lg border bg-white ${open ? 'border-blue-300 shadow-sm' : 'border-gray-200'}`}>
                {/* Bubble head — click to expand; the ↳page/highlight is a separate click */}
                <button
                  onClick={() => setOpenId(open ? null : it.id)}
                  className="w-full text-left px-3 py-2 flex items-start gap-2"
                >
                  <span className="text-gray-400 text-sm leading-5 w-4 text-center flex-shrink-0" aria-hidden>
                    {NODE_GLYPH[it.nodeType ?? ''] ?? '▸'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-gray-800 truncate">{it.heading || 'Untitled'}</span>
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      {typeLabel ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600">{typeLabel}</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] text-gray-400 border border-dashed border-gray-300">untyped</span>
                      )}
                      {statusChip(it.status)}
                      {it.page != null && <span className="text-[10px] text-gray-400">p.{it.page}</span>}
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-2">
                    {it.snippet && <p className="text-[11px] text-gray-500 line-clamp-3">{it.snippet}</p>}
                    {onBubbleClick && it.page != null && (
                      <button onClick={() => onBubbleClick(it.id)} className="text-[11px] text-blue-600 hover:underline">
                        ↳ Show on page {it.page}
                      </button>
                    )}
                    <label className="block text-[11px] font-medium text-gray-500">Type</label>
                    <select
                      value={effectiveType}
                      onChange={(e) => onClassify(it.id, e.target.value)}
                      disabled={busy}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="">— choose type —</option>
                      {standards.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>

                    {(onAddTag || (it.tags && it.tags.length > 0)) && (
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Tags</label>
                        <div className="flex flex-wrap gap-1 mb-1">
                          {(it.tags ?? []).map((t) => (
                            <span key={t} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600">
                              {t}
                              {onRemoveTag && (
                                <button onClick={() => onRemoveTag(it.id, t)} className="text-blue-400 hover:text-blue-700 leading-none" aria-label={`Remove ${t}`}>×</button>
                              )}
                            </span>
                          ))}
                          {(it.tags ?? []).length === 0 && <span className="text-[10px] text-gray-400">no tags</span>}
                        </div>
                        {onAddTag && (
                          <input
                            value={openId === it.id ? tagInput : ''}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && tagInput.trim()) {
                                onAddTag(it.id, tagInput.trim());
                                setTagInput('');
                              }
                            }}
                            placeholder="add a tag, Enter"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                          />
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        onClick={() => onAccept(it.id)}
                        disabled={busy || (it.status ?? 'draft') === 'approved'}
                        className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded px-2.5 py-1 disabled:opacity-40"
                      >
                        {busy ? '…' : (it.status ?? 'draft') === 'approved' ? 'Accepted' : 'Accept as atom'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
