'use client';

/**
 * Canvas Editor — the full section editing workspace.
 *
 * Combines the CanvasRenderer (WYSIWYG page view) + CanvasSidebar
 * (compliance, node info, add content) into a single component.
 * Manages the document state, node CRUD, and save/export actions.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CanvasDocument, CanvasNode, NodeType, NodeStyle, CanvasRules } from '@/lib/types/canvas-document';
import type { LibraryAtomCandidate } from './library-picker';
import { createNode } from '@/lib/types/canvas-document';
import { CanvasRenderer } from './canvas-renderer';
import { SlideEditor } from './slide-editor';
import { SheetEditor } from './sheet-editor';
import { CanvasSidebar } from './canvas-sidebar';

/** Metadata about the last AI revision, used to tag the save with the correct source */
interface RevisionMeta {
  source: 'ai_revision' | 'ai_draft' | 'library_import';
  aiInstruction: string;
}

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
  const [undoStack, setUndoStack] = useState<CanvasDocument[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasDocument[]>([]);
  const lastRevisionMetaRef = useRef<RevisionMeta | null>(null);

  const selectedNode = doc.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const isSlideFormat = doc.canvas.format === 'slide_16_9' || doc.canvas.format === 'slide_4_3';

  const updateDoc = useCallback((updater: (prev: CanvasDocument) => CanvasDocument) => {
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
  }, [actorId]);

  const handleUpdateNode = useCallback((nodeId: string, content: CanvasNode['content']) => {
    // Human edit — clear AI revision metadata so the save isn't tagged as AI
    lastRevisionMetaRef.current = null;
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
    // Human edit — clear AI revision metadata
    lastRevisionMetaRef.current = null;
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [updateDoc, selectedNodeId]);

  const handleMoveNodeToIndex = useCallback((nodeId: string, targetIndex: number) => {
    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      const currentIndex = nodes.findIndex(n => n.id === nodeId);
      if (currentIndex === -1 || currentIndex === targetIndex) return prev;

      // Remove from current position
      const [removed] = nodes.splice(currentIndex, 1);

      // Insert at target position (adjust if removing shifted the index)
      const insertAt = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
      nodes.splice(insertAt, 0, removed);

      return { ...prev, nodes };
    });
  }, [updateDoc]);

  const handleMoveNode = useCallback((nodeId: string, direction: 'up' | 'down') => {
    // Human edit — clear AI revision metadata
    lastRevisionMetaRef.current = null;
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

  const handleReviseNode = useCallback((nodeId: string, newContent: CanvasNode['content'], meta?: { source: string; aiInstruction: string }) => {
    // Store revision metadata so the save route can tag the version correctly
    if (meta) {
      lastRevisionMetaRef.current = {
        source: meta.source as RevisionMeta['source'],
        aiInstruction: meta.aiInstruction,
      };
    }
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

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Pass revision metadata alongside the doc so the save route can tag the version
      const meta = lastRevisionMetaRef.current;
      const docWithMeta = meta
        ? Object.assign({}, doc, { __revisionMeta: meta })
        : doc;
      await onSave(docWithMeta);
      setDirty(false);
      // Clear revision meta after successful save
      lastRevisionMetaRef.current = null;
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
                  disabled
                  title="Coming soon"
                  className="px-3 py-1.5 text-xs border rounded bg-gray-100 text-gray-400 cursor-not-allowed"
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
            onMoveNodeToIndex={handleMoveNodeToIndex}
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
