'use client';

/**
 * Canvas Editor — the full section editing workspace.
 *
 * Combines the CanvasRenderer (WYSIWYG page view) + CanvasSidebar
 * (compliance, node info, add content) into a single component.
 * Manages the document state, node CRUD, and save/export actions.
 */

import { useState, useCallback } from 'react';
import type { CanvasDocument, CanvasNode, NodeType, NodeStyle, CanvasRules } from '@/lib/types/canvas-document';
import type { LibraryAtomCandidate } from './library-picker';
import { createNode } from '@/lib/types/canvas-document';
import { CanvasRenderer } from './canvas-renderer';
import { SlideEditor } from './slide-editor';
import { SheetEditor } from './sheet-editor';
import { CanvasSidebar } from './canvas-sidebar';

interface Props {
  initialDocument: CanvasDocument;
  onSave: (doc: CanvasDocument) => Promise<void>;
  onExport?: (doc: CanvasDocument, format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => Promise<void>;
  variables?: Record<string, string>;
  readOnly?: boolean;
  actorId: string;
  actorName: string;
  /** Proposal ID — enables AI revision and comments when present */
  proposalId?: string;
  /** Section ID — included for context */
  sectionId?: string;
  /** Tenant slug — enables comments API when present */
  tenantSlug?: string;
}

function defaultContent(type: NodeType): CanvasNode['content'] {
  switch (type) {
    case 'heading': return { level: 2, text: 'New Section' };
    case 'text_block': return { text: '' };
    case 'bulleted_list': return { items: [{ text: 'Item 1' }] };
    case 'numbered_list': return { items: [{ text: 'Step 1' }] };
    case 'image': return { storage_key: '', alt_text: 'Image', width: 400, height: 300 };
    case 'table': return { headers: ['Column 1', 'Column 2'], rows: [['', '']] };
    case 'caption': return { prefix: 'Figure', number: 1, text: 'Caption text' };
    case 'footnote': return { marker: '1', text: 'Footnote text' };
    case 'toc': return { max_depth: 3 };
    case 'url': return { href: 'https://', display_text: 'Link text' };
    default: return null;
  }
}

export function CanvasEditor(props: Props) {
  // Delegate to SheetEditor for spreadsheet format
  if (props.initialDocument.canvas.format === 'spreadsheet') {
    return (
      <SheetEditor
        initialDocument={props.initialDocument}
        onSave={props.onSave}
        onExport={props.onExport}
        actorId={props.actorId}
        actorName={props.actorName}
        readOnly={props.readOnly}
      />
    );
  }

  return <CanvasEditorInner {...props} />;
}

function CanvasEditorInner({
  initialDocument,
  onSave,
  onExport,
  variables,
  readOnly = false,
  actorId,
  actorName,
  proposalId,
  sectionId,
  tenantSlug,
}: Props) {
  const [doc, setDoc] = useState<CanvasDocument>(initialDocument);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedNode = doc.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const isSlideFormat = doc.canvas.format === 'slide_16_9' || doc.canvas.format === 'slide_4_3';

  const updateDoc = useCallback((updater: (prev: CanvasDocument) => CanvasDocument) => {
    setDoc((prev) => {
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
  }, [actorId]);

  const handleUpdateNode = useCallback((nodeId: string, content: CanvasNode['content']) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          content,
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'edited' as const, timestamp: new Date().toISOString() },
          ],
        };
      }),
    }));
  }, [updateDoc, actorId, actorName]);

  const handleAddNode = useCallback((type: NodeType, afterId?: string) => {
    const newNode = createNode({
      type,
      content: defaultContent(type),
      source: 'manual',
      actorId,
      actorName,
    });

    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      if (afterId) {
        const idx = nodes.findIndex((n) => n.id === afterId);
        nodes.splice(idx + 1, 0, newNode);
      } else {
        nodes.push(newNode);
      }
      return { ...prev, nodes };
    });

    setSelectedNodeId(newNode.id);
  }, [updateDoc, actorId, actorName]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [updateDoc, selectedNodeId]);

  const handleMoveNode = useCallback((nodeId: string, direction: 'up' | 'down') => {
    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      const idx = nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= nodes.length) return prev;
      [nodes[idx], nodes[newIdx]] = [nodes[newIdx], nodes[idx]];
      return { ...prev, nodes };
    });
  }, [updateDoc]);

  const handleAcceptNode = useCallback((nodeId: string) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'accepted' as const, timestamp: new Date().toISOString() },
          ],
        };
      }),
    }));
  }, [updateDoc, actorId, actorName]);

  const handleRevertNode = useCallback((nodeId: string) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || n.history.length < 2) return n;
        return {
          ...n,
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'reverted' as const, timestamp: new Date().toISOString() },
          ],
        };
      }),
    }));
  }, [updateDoc, actorId, actorName]);

  const handleUpdateNodeStyle = useCallback((nodeId: string, style: Partial<NodeStyle>) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          style: { ...n.style, ...style },
        };
      }),
    }));
  }, [updateDoc]);

  const handleUpdateCanvas = useCallback((canvas: CanvasRules) => {
    updateDoc((prev) => ({ ...prev, canvas }));
  }, [updateDoc]);

  const handleReviseNode = useCallback((nodeId: string, newContent: CanvasNode['content']) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          content: newContent,
          provenance: { ...n.provenance, source: 'ai_draft' as const, drafted_at: new Date().toISOString() },
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'edited' as const, timestamp: new Date().toISOString(), comment: 'AI revision' },
          ],
        };
      }),
    }));
  }, [updateDoc, actorId, actorName]);

  const handleReplaceFromLibrary = useCallback((nodeId: string, atom: LibraryAtomCandidate) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          content: { text: atom.content } as any,
          provenance: {
            ...n.provenance,
            source: 'library' as const,
            library_unit_id: atom.id,
          },
          history: [
            ...n.history,
            {
              actor_id: actorId,
              actor_name: actorName,
              action: 'replaced' as const,
              timestamp: new Date().toISOString(),
              comment: `Replaced with library atom: ${atom.category}`,
            },
          ],
        };
      }),
    }));
  }, [updateDoc, actorId, actorName]);

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

  return (
    <div className="flex h-full">
      {/* Canvas area */}
      <div className="flex-1 overflow-y-auto">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm text-gray-800 truncate max-w-xs">
              {doc.metadata.title}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded ${
              doc.metadata.status === 'accepted' ? 'bg-green-100 text-green-700' :
              doc.metadata.status === 'review' ? 'bg-yellow-100 text-yellow-700' :
              doc.metadata.status === 'ai_drafted' ? 'bg-indigo-100 text-indigo-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {doc.metadata.status.replace('_', ' ')}
            </span>
            {dirty && <span className="text-xs text-orange-500">unsaved</span>}
          </div>
          <div className="flex items-center gap-2">
            {saveError && (
              <span className="text-xs text-red-600 mr-2">{saveError}</span>
            )}
            {onExport && (doc.canvas.format === 'letter' || doc.canvas.format === 'custom') && (
              <>
                <button
                  onClick={async () => {
                    try {
                      await onExport(doc, 'docx');
                    } catch (err) {
                      setSaveError(err instanceof Error ? err.message : 'Export failed');
                    }
                  }}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                >
                  Export .docx
                </button>
                <button
                  onClick={async () => {
                    try {
                      await onExport(doc, 'pdf');
                    } catch (err) {
                      setSaveError(err instanceof Error ? err.message : 'Export failed');
                    }
                  }}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                >
                  Export .pdf
                </button>
              </>
            )}
            {onExport && (doc.canvas.format === 'slide_16_9' || doc.canvas.format === 'slide_4_3') && (
              <button
                onClick={async () => {
                  try {
                    await onExport(doc, 'pptx');
                  } catch (err) {
                    setSaveError(err instanceof Error ? err.message : 'Export failed');
                  }
                }}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
              >
                Export .pptx
              </button>
            )}
            {onExport && doc.nodes.some((n) => n.type === 'table') && (
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
              onClick={handleSave}
              disabled={saving || !dirty}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {isSlideFormat ? (
          <SlideEditor
            document={doc}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onUpdateNode={handleUpdateNode}
            onAddNode={handleAddNode}
            onDeleteNode={handleDeleteNode}
            variables={variables}
            readOnly={readOnly}
          />
        ) : (
          <CanvasRenderer
            document={doc}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onUpdateNode={handleUpdateNode}
            variables={variables}
            readOnly={readOnly}
          />
        )}
      </div>

      {/* Sidebar */}
      <CanvasSidebar
        document={doc}
        selectedNode={selectedNode}
        onAddNode={handleAddNode}
        onDeleteNode={handleDeleteNode}
        onMoveNode={handleMoveNode}
        onAcceptNode={handleAcceptNode}
        onRevertNode={handleRevertNode}
        onReplaceFromLibrary={handleReplaceFromLibrary}
        onUpdateNodeStyle={handleUpdateNodeStyle}
        onUpdateCanvas={handleUpdateCanvas}
        onReviseNode={handleReviseNode}
        proposalId={proposalId}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
