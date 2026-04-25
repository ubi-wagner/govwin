'use client';

/**
 * Canvas Editor Sidebar — compliance status, selected node info,
 * history, and library match suggestions.
 */

import { useState } from 'react';
import type { CanvasDocument, CanvasNode, NodeEdit, estimatePageCount } from '@/lib/types/canvas-document';
import { getNodeText } from '@/lib/types/canvas-document';

interface Props {
  document: CanvasDocument;
  selectedNode: CanvasNode | null;
  onAddNode: (type: CanvasNode['type'], after?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, direction: 'up' | 'down') => void;
  onAcceptNode: (nodeId: string) => void;
  onRevertNode: (nodeId: string) => void;
}

export function CanvasSidebar({
  document: doc,
  selectedNode,
  onAddNode,
  onDeleteNode,
  onMoveNode,
  onAcceptNode,
  onRevertNode,
}: Props) {
  const [activeTab, setActiveTab] = useState<'compliance' | 'node' | 'add'>('compliance');

  const pageEstimate = Math.max(1, Math.ceil(doc.nodes.length / 8));
  const maxPages = doc.canvas.max_pages;
  const pageOk = !maxPages || pageEstimate <= maxPages;

  const aiNodes = doc.nodes.filter((n) => n.provenance.source === 'ai_draft').length;
  const libraryNodes = doc.nodes.filter((n) => n.provenance.source === 'library').length;
  const manualNodes = doc.nodes.filter((n) => n.provenance.source === 'manual').length;

  return (
    <div className="w-72 shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 text-xs">
        {(['compliance', 'node', 'add'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 font-medium capitalize ${
              activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'node' ? (selectedNode ? 'Node' : 'Select') : tab}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">
        {/* ── Compliance tab ──────────────────────────────────── */}
        {activeTab === 'compliance' && (
          <>
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Document Status</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  <span className="font-medium">{doc.metadata.status.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Atoms</span>
                  <span className="font-medium">{doc.nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Version</span>
                  <span className="font-medium">v{doc.metadata.version_number}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Compliance</h3>
              <div className="space-y-2 text-sm">
                {maxPages && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Page limit</span>
                    <span className={`font-medium ${pageOk ? 'text-green-600' : 'text-red-600'}`}>
                      ~{pageEstimate} / {maxPages}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Font</span>
                  <span className="font-medium text-xs">{doc.canvas.font_default.family} {doc.canvas.font_default.size}pt</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Margins</span>
                  <span className="font-medium text-xs">{doc.canvas.margins.left / 72}&quot; all</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Content Sources</h3>
              <div className="space-y-1 text-sm">
                {aiNodes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                    <span className="text-gray-600">{aiNodes} AI drafted</span>
                  </div>
                )}
                {libraryNodes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full" />
                    <span className="text-gray-600">{libraryNodes} from library</span>
                  </div>
                )}
                {manualNodes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full" />
                    <span className="text-gray-600">{manualNodes} manual</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Node detail tab ─────────────────────────────────── */}
        {activeTab === 'node' && selectedNode && (
          <>
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Selected: {selectedNode.type.replace('_', ' ')}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Source</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedNode.provenance.source === 'ai_draft' ? 'bg-yellow-100 text-yellow-700' :
                    selectedNode.provenance.source === 'library' ? 'bg-indigo-100 text-indigo-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {selectedNode.provenance.source.replace('_', ' ')}
                  </span>
                </div>
                {selectedNode.provenance.library_unit_id && (
                  <div className="text-xs text-gray-500">
                    From library: {selectedNode.provenance.library_unit_id.slice(0, 8)}...
                  </div>
                )}
                {selectedNode.provenance.source_anchor?.excerpt && (
                  <div className="text-xs text-gray-400 italic mt-1">
                    Source: &ldquo;{selectedNode.provenance.source_anchor.excerpt.slice(0, 80)}...&rdquo;
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              <button onClick={() => onMoveNode(selectedNode.id, 'up')} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Move Up</button>
              <button onClick={() => onMoveNode(selectedNode.id, 'down')} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Move Down</button>
              <button onClick={() => onAcceptNode(selectedNode.id)} className="px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100">Accept</button>
              <button onClick={() => onRevertNode(selectedNode.id)} className="px-2 py-1 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded hover:bg-yellow-100">Revert</button>
              <button onClick={() => onDeleteNode(selectedNode.id)} className="px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100">Delete</button>
            </div>

            {selectedNode.library_tags && selectedNode.library_tags.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Library Tags</h3>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.library_tags.map((tag) => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">History</h3>
              <div className="space-y-2">
                {selectedNode.history.map((edit, i) => (
                  <div key={i} className="text-xs border-l-2 border-blue-200 pl-2 py-0.5">
                    <div className="text-gray-700">
                      <span className="font-medium">{edit.actor_name}</span> {edit.action}
                    </div>
                    {edit.comment && <div className="text-gray-400 italic">{edit.comment}</div>}
                    <div className="text-gray-400">{new Date(edit.timestamp).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'node' && !selectedNode && (
          <p className="text-sm text-gray-400 text-center py-8">Click a node on the canvas to see its details</p>
        )}

        {/* ── Add node tab ────────────────────────────────────── */}
        {activeTab === 'add' && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Insert Content</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { type: 'heading' as const, label: 'Heading', icon: 'H' },
                { type: 'text_block' as const, label: 'Paragraph', icon: 'T' },
                { type: 'bulleted_list' as const, label: 'Bullet List', icon: '•' },
                { type: 'numbered_list' as const, label: 'Numbered List', icon: '#' },
                { type: 'image' as const, label: 'Image', icon: '🖼' },
                { type: 'table' as const, label: 'Table', icon: '⊞' },
                { type: 'caption' as const, label: 'Caption', icon: 'C' },
                { type: 'footnote' as const, label: 'Footnote', icon: '†' },
                { type: 'page_break' as const, label: 'Page Break', icon: '—' },
                { type: 'toc' as const, label: 'TOC', icon: '☰' },
              ].map((item) => (
                <button
                  key={item.type}
                  onClick={() => onAddNode(item.type, selectedNode?.id)}
                  className="flex items-center gap-2 px-3 py-2 text-xs border rounded hover:bg-blue-50 hover:border-blue-200 text-left"
                >
                  <span className="w-5 text-center font-bold text-gray-400">{item.icon}</span>
                  <span className="text-gray-700">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
