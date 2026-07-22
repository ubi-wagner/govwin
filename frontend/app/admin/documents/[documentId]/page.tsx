'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { CanvasEditor } from '@/components/canvas/canvas-editor';
import type { CanvasDocument } from '@/lib/types/canvas-document';

interface HistoryEntry {
  key: string;
  timestamp: number;
  size: number;
}

export default function DocumentEditorPage() {
  const params = useParams();
  const documentId = params.documentId as string;

  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/documents/${documentId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? 'Failed to load document');
          return;
        }
        const json = await res.json();
        const doc = json.data.document as CanvasDocument;
        setDocument(doc);
        setTitle(doc.metadata.title || 'Untitled');
      } catch {
        setError('Network error loading document');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [documentId]);

  const handleSave = useCallback(async (doc: CanvasDocument) => {
    const res = await fetch(`/api/admin/documents/${documentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: doc }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Save failed');
    }
  }, [documentId]);

  const handleExport = useCallback(async (doc: CanvasDocument, format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => {
    const res = await fetch(`/api/admin/documents/${documentId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: doc, format }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${doc.metadata.title || 'document'}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [documentId]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/documents/${documentId}?history`);
      if (res.ok) {
        const json = await res.json();
        setHistory(json.data.history ?? []);
      }
    } catch {
      // silently fail
    }
  }, [documentId]);

  const handleRestoreVersion = useCallback(async (entry: HistoryEntry) => {
    if (!window.confirm('Restore this version? Current changes will be lost.')) return;
    try {
      const res = await fetch(`/api/admin/documents/${documentId}?version=${encodeURIComponent(entry.key)}`);
      if (res.ok) {
        const json = await res.json();
        setDocument(json.data.document);
        setEditorKey(k => k + 1);
        setShowHistory(false);
      }
    } catch {
      // silently fail
    }
  }, [documentId]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading document...</p>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600">{error ?? 'Document not found'}</p>
        <a href="/admin/documents" className="text-sm text-blue-600 hover:underline">
          &larr; Back to Documents
        </a>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-white relative">
        <a href="/admin/documents" className="text-sm text-blue-600 hover:underline">
          &larr; All Documents
        </a>
        <span className="text-sm text-gray-400">|</span>
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
            className="text-xs text-gray-600 hover:text-gray-900 border rounded px-2 py-1"
          >
            History ({history.length || '...'})
          </button>
          {showHistory && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-white border rounded-lg shadow-lg z-20 max-h-80 overflow-y-auto">
              <div className="p-3 border-b">
                <h3 className="text-xs font-semibold text-gray-500 uppercase">Save History</h3>
              </div>
              {history.length === 0 ? (
                <p className="p-3 text-xs text-gray-400">No previous saves</p>
              ) : (
                <div className="divide-y">
                  {history.map((h) => (
                    <button
                      key={h.key}
                      onClick={() => handleRestoreVersion(h)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs"
                    >
                      <div className="text-gray-700">
                        {new Date(h.timestamp).toLocaleString()}
                      </div>
                      <div className="text-gray-400">
                        {(h.size / 1024).toFixed(1)} KB
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <CanvasEditor
          key={editorKey}
          initialDocument={document}
          onSave={handleSave}
          onExport={handleExport}
          actorId="admin"
          actorName="Admin"
        />
      </div>
    </div>
  );
}
