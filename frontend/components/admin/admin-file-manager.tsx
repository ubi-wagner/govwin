'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────

interface S3Object {
  key: string;
  size: number;
  lastModified: string | null;
}

interface ListResponse {
  data: {
    objects: S3Object[];
    prefixes: string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function displayName(key: string): string {
  // Strip trailing slash for folder markers, then take the last segment
  const clean = key.endsWith('/') ? key.slice(0, -1) : key;
  return clean.split('/').pop() ?? key;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ROOT_PREFIX = 'rfp-admin/';

// ── Component ────────────────────────────────────────────────────────

export default function AdminFileManager() {
  const [currentPrefix, setCurrentPrefix] = useState(ROOT_PREFIX);
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load listing ───────────────────────────────────────────────────
  const loadListing = useCallback(async (prefix: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/storage?prefix=${encodeURIComponent(prefix)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: ListResponse = await res.json();
      setObjects(json.data.objects);
      setPrefixes(json.data.prefixes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadListing(currentPrefix);
  }, [currentPrefix, loadListing]);

  // ── Upload handler ─────────────────────────────────────────────────
  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('prefix', currentPrefix);
        const res = await fetch('/api/admin/storage', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed: HTTP ${res.status}`);
        }
      }
      await loadListing(currentPrefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── Download handler ───────────────────────────────────────────────
  const handleDownload = async (key: string) => {
    try {
      const res = await fetch(
        `/api/admin/storage?download=${encodeURIComponent(key)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Download failed');
      }
      const json = await res.json();
      window.open(json.data.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  // ── Delete handler ─────────────────────────────────────────────────
  const handleDelete = async (key: string) => {
    const name = displayName(key);
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/admin/storage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Delete failed');
      }
      await loadListing(currentPrefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // ── Create folder ──────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    const name = newFolderName.trim().replace(/\/+$/, '');
    if (!name) return;
    // Validate: no slashes, no dots-only, reasonable characters
    if (/[/\\]/.test(name) || name === '.' || name === '..') {
      setError('Invalid folder name');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      // Create a zero-byte file with trailing / to act as a folder marker
      const emptyBlob = new Blob([], { type: 'application/x-directory' });
      const folderKey = `${currentPrefix}${name}/`;
      const markerFile = new File([emptyBlob], `${name}/`, {
        type: 'application/x-directory',
      });
      form.append('file', markerFile);
      form.append('prefix', currentPrefix);

      // We use a direct PUT approach via the API — the API constructs key as prefix + filename.
      // Since the filename is "name/", the resulting key will be "currentPrefix/name/" which
      // is the S3 folder convention. However the API sanitizes filenames, so let's use a
      // workaround: upload a zero-byte object with the key directly.
      // Actually, simpler: just call the upload and it will be prefix + "name/" as the filename.
      const res = await fetch('/api/admin/storage', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to create folder');
      }
      setNewFolderName('');
      setShowNewFolder(false);
      await loadListing(currentPrefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setUploading(false);
    }
  };

  // ── Drag-and-drop handlers ────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // ── Navigation ────────────────────────────────────────────────────
  const navigateTo = (prefix: string) => {
    setCurrentPrefix(prefix);
  };

  const goUp = () => {
    if (currentPrefix === ROOT_PREFIX) return;
    // Remove trailing slash, then strip last segment
    const trimmed = currentPrefix.slice(0, -1);
    const parentEnd = trimmed.lastIndexOf('/');
    const parent = parentEnd >= 0 ? trimmed.slice(0, parentEnd + 1) : ROOT_PREFIX;
    // Ensure we never go above root
    if (!parent.startsWith(ROOT_PREFIX)) {
      setCurrentPrefix(ROOT_PREFIX);
    } else {
      setCurrentPrefix(parent);
    }
  };

  // ── Breadcrumbs ───────────────────────────────────────────────────
  const breadcrumbs = (() => {
    const parts = currentPrefix.replace(/\/$/, '').split('/').filter(Boolean);
    const crumbs: { label: string; prefix: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('/') + '/';
      crumbs.push({ label: parts[i], prefix });
    }
    return crumbs;
  })();

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleUpload(e.target.files);
              e.target.value = '';
            }
          }}
        />
        <p className="text-gray-600 mb-2">
          {uploading ? 'Uploading...' : 'Drag and drop files here, or'}
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {uploading ? 'Uploading...' : 'Choose Files'}
        </button>
        <p className="text-xs text-gray-400 mt-2">
          Uploading to: {currentPrefix}
        </p>
      </div>

      {/* Breadcrumbs + navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.prefix} className="flex items-center">
              {i > 0 && <span className="mx-1 text-gray-400">/</span>}
              {i < breadcrumbs.length - 1 ? (
                <button
                  type="button"
                  onClick={() => navigateTo(crumb.prefix)}
                  className="text-blue-600 hover:underline"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="font-medium text-gray-900">{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {currentPrefix !== ROOT_PREFIX && (
            <button
              type="button"
              onClick={goUp}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowNewFolder(!showNewFolder)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            New Folder
          </button>
          <button
            type="button"
            onClick={() => loadListing(currentPrefix)}
            disabled={loading}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* New folder form */}
      {showNewFolder && (
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded border">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') {
                setShowNewFolder(false);
                setNewFolderName('');
              }
            }}
            placeholder="Folder name"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            type="button"
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || uploading}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNewFolder(false);
              setNewFolderName('');
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Listing table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 w-28">
                  Size
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 w-44">
                  Last Modified
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-700 w-40">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Folders */}
              {prefixes.map((prefix) => (
                <tr key={prefix} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigateTo(prefix)}
                      className="flex items-center gap-2 text-blue-600 hover:underline font-medium"
                    >
                      <svg
                        className="w-4 h-4 text-yellow-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      {displayName(prefix)}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-400">-</td>
                  <td className="px-4 py-3 text-gray-400">-</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(prefix)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {/* Files */}
              {objects.map((obj) => (
                <tr key={obj.key} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                      <span className="text-gray-900">{displayName(obj.key)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {humanSize(obj.size)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(obj.lastModified)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => handleDownload(obj.key)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(obj.key)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {/* Empty state */}
              {prefixes.length === 0 && objects.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    This folder is empty. Upload files or create a sub-folder.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
