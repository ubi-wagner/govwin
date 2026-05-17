'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { CanvasEditor } from '@/components/canvas/canvas-editor';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export default function DocumentEditorPage() {
  const params = useParams();
  const documentId = params.documentId as string;

  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (format === 'pdf') {
      alert('PDF export is not yet implemented');
      return;
    }
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
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-white">
        <a href="/admin/documents" className="text-sm text-blue-600 hover:underline">
          &larr; All Documents
        </a>
        <span className="text-sm text-gray-400">|</span>
        <span className="text-sm font-medium text-gray-700 truncate">{title}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <CanvasEditor
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
