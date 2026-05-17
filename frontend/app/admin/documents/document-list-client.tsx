'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface DocumentMeta {
  id: string;
  title: string;
  description: string;
  formatPreset: string;
  format: string;
  nodeCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const PRESETS = [
  {
    key: 'letter_standard',
    label: 'Standard Letter',
    description: '8.5x11, Times New Roman 12pt, 1" margins',
  },
  {
    key: 'letter_sbir_phase1',
    label: 'SBIR Phase I',
    description: '8.5x11, TNR 10pt, 15 page limit, header/footer',
  },
  {
    key: 'letter_sbir_phase2',
    label: 'SBIR Phase II',
    description: '8.5x11, TNR 12pt, 30 page limit, header/footer',
  },
  {
    key: 'slide_cso',
    label: 'CSO Slide Deck',
    description: '16:9, Arial 18pt, 25 slide limit',
  },
] as const;

function formatPresetLabel(preset: string): string {
  const found = PRESETS.find((p) => p.key === preset);
  return found ? found.label : preset;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function DocumentListClient() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState<string>('letter_standard');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/documents');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to load documents');
        return;
      }
      const json = await res.json();
      setDocuments(json.data ?? []);
    } catch {
      setError('Network error loading documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleCreate = async () => {
    if (!title.trim()) {
      setCreateError('Title is required');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/admin/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), preset }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCreateError(body.error ?? 'Failed to create document');
        return;
      }
      const json = await res.json();
      router.push(`/admin/documents/${json.data.id}`);
    } catch {
      setCreateError('Network error creating document');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, docTitle: string) => {
    if (!confirm(`Delete "${docTitle}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? 'Failed to delete document');
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch {
      alert('Network error deleting document');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Builder</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and edit standalone documents — templates, examples, reference materials
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          New Document
        </button>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Document</h2>

            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. SBIR Phase I Technical Volume Template"
              autoFocus
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Optional description of this document"
            />

            <label className="block text-sm font-medium text-gray-700 mb-2">Format Preset</label>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {PRESETS.map((p) => (
                <label
                  key={p.key}
                  className={`cursor-pointer border rounded-lg p-3 transition-colors ${
                    preset === p.key
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="preset"
                    value={p.key}
                    checked={preset === p.key}
                    onChange={() => setPreset(p.key)}
                    className="sr-only"
                  />
                  <div className="text-sm font-medium text-gray-900">{p.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
                </label>
              ))}
            </div>

            {createError && (
              <p className="text-sm text-red-600 mb-3">{createError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setTitle('');
                  setDescription('');
                  setPreset('letter_standard');
                  setCreateError(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading / Error */}
      {loading && <p className="text-sm text-gray-500">Loading documents...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Document table */}
      {!loading && !error && (
        <>
          {documents.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No documents yet</p>
              <p className="text-sm mt-1">Click &ldquo;New Document&rdquo; to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-700">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-700">Format</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-700">Nodes</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-700">Created</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-700">Last Modified</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <a
                          href={`/admin/documents/${doc.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {doc.title}
                        </a>
                        {doc.description && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{doc.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatPresetLabel(doc.formatPreset)}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{doc.nodeCount}</td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(doc.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(doc.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/admin/documents/${doc.id}`}
                          className="text-blue-600 hover:underline text-xs mr-3"
                        >
                          Edit
                        </a>
                        <button
                          onClick={() => handleDelete(doc.id, doc.title)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
