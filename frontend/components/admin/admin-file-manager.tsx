'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';

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

const TOP_LEVEL_PREFIXES = [
  { prefix: 'rfp-admin/', label: 'Curation Files', writable: true },
  { prefix: 'rfp-pipeline/', label: 'Pipeline Artifacts', writable: false },
  { prefix: 'customers/', label: 'Customer Storage', writable: false },
  { prefix: 'reference/', label: 'Reference Library', writable: true },
] as const;

/** Determine the root prefix for the current path. */
function getRootPrefix(path: string): string {
  const entry = TOP_LEVEL_PREFIXES.find(p => path.startsWith(p.prefix));
  return entry?.prefix ?? TOP_LEVEL_PREFIXES[0].prefix;
}

/** Determine whether the current path is writable. */
function isWritablePrefix(path: string): boolean {
  const entry = TOP_LEVEL_PREFIXES.find(p => path.startsWith(p.prefix));
  return entry?.writable ?? false;
}

// ── Component ────────────────────────────────────────────────────────

export default function AdminFileManager() {
  const [currentPrefix, setCurrentPrefix] = useState<string>(TOP_LEVEL_PREFIXES[0].prefix);
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
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

  // ── Upload handler — presigned URL flow (supports 500MB+ files) ────
  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        // Step 1: Get a presigned PUT URL from our API
        const presignRes = await fetch('/api/admin/storage', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            prefix: currentPrefix,
            contentType: file.type || 'application/octet-stream',
          }),
        });
        if (!presignRes.ok) {
          const body = await presignRes.json().catch(() => ({}));
          throw new Error(body.error ?? 'Failed to get upload URL');
        }
        const { data: presign } = await presignRes.json();

        // Step 2: Upload directly to S3 via XMLHttpRequest (supports progress)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', presign.url);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setError(`Uploading ${file.name}: ${pct}% (${(e.loaded / 1024 / 1024).toFixed(1)}MB / ${(e.total / 1024 / 1024).toFixed(1)}MB)`);
            }
          };
          xhr.onload = () => {
            setError(null);
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Direct upload failed: HTTP ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error('Upload failed — network error'));
          xhr.ontimeout = () => reject(new Error('Upload timed out'));
          xhr.timeout = 3600000; // 1 hour for very large files
          xhr.send(file);
        });

        // Step 3: Confirm upload + trigger auto-ingest
        const confirmRes = await fetch('/api/admin/storage', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: presign.key }),
        });
        if (!confirmRes.ok) {
          const body = await confirmRes.json().catch(() => ({}));
          throw new Error(body.error ?? 'Upload confirmation failed');
        }

        const { data: confirm } = await confirmRes.json();
        if (confirm.sbirIngest && !confirm.sbirIngest.isDuplicate) {
          setError(null);
          toast.success(`SBIR data ingested: ${confirm.sbirIngest.rowCount} ${confirm.sbirIngest.fileType} records loaded`);
        } else if (confirm.sbirIngest?.isDuplicate) {
          toast.info('This SBIR data file was already ingested (duplicate detected by file hash)');
        } else if (confirm.notice) {
          toast.info(confirm.notice);
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

  // ── Rename handler ─────────────────────────────────────────────────
  const handleRename = async (oldKey: string, newName: string) => {
    const isFolder = oldKey.endsWith('/');
    const parts = oldKey.replace(/\/$/, '').split('/');
    parts[parts.length - 1] = newName;
    const newKey = parts.join('/') + (isFolder ? '/' : '');
    if (oldKey === newKey) return;
    try {
      const res = await fetch('/api/admin/storage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', oldKey, newKey }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Rename failed');
      }
      await loadListing(currentPrefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  // ── Bulk download handler ─────────────────────────────────────────
  const handleBulkDownload = async () => {
    for (const key of selectedKeys) {
      if (key.endsWith('/')) continue;
      await handleDownload(key);
    }
  };

  // ── Create folder ──────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    const name = newFolderName.trim().replace(/\/+$/, '').replace(/^\/+/, '');
    if (!name) return;
    const segments = name.split('/').filter(Boolean);
    if (segments.some(s => s === '.' || s === '..' || /[\\]/.test(s))) {
      setError('Invalid folder path');
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
    setSelectedKeys(new Set());
    setRenamingKey(null);
  };

  const rootPrefix = getRootPrefix(currentPrefix);
  const writable = isWritablePrefix(currentPrefix);

  const goUp = () => {
    if (currentPrefix === rootPrefix) return;
    // Remove trailing slash, then strip last segment
    const trimmed = currentPrefix.slice(0, -1);
    const parentEnd = trimmed.lastIndexOf('/');
    const parent = parentEnd >= 0 ? trimmed.slice(0, parentEnd + 1) : rootPrefix;
    // Ensure we never go above root
    if (!parent.startsWith(rootPrefix)) {
      setCurrentPrefix(rootPrefix);
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
      {/* Prefix tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TOP_LEVEL_PREFIXES.map((p) => (
          <button
            key={p.prefix}
            type="button"
            onClick={() => setCurrentPrefix(p.prefix)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              rootPrefix === p.prefix
                ? 'bg-white border border-b-white border-gray-200 -mb-px text-blue-700'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.label}
            {!p.writable && (
              <span className="ml-1.5 text-xs text-gray-400">(read-only)</span>
            )}
          </button>
        ))}
      </div>

      {/* Upload zone — only shown for writable prefixes */}
      {writable && <div
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
      </div>}

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
          {currentPrefix !== rootPrefix && (
            <button
              type="button"
              onClick={goUp}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Back
            </button>
          )}
          {writable && (
            <button
              type="button"
              onClick={() => setShowNewFolder(!showNewFolder)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              New Folder
            </button>
          )}
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
      {writable && showNewFolder && (
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
            placeholder="Folder name or path (e.g. sttr-phase1/dod/afwerx)"
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

      {/* Bulk actions bar */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <span className="text-blue-800 font-medium">{selectedKeys.size} selected</span>
          <button
            type="button"
            onClick={handleBulkDownload}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            Download Selected
          </button>
          {writable && (
            <button
              type="button"
              onClick={async () => {
                const fileKeys = Array.from(selectedKeys).filter(k => !k.endsWith('/'));
                if (fileKeys.length === 0) return;
                if (!window.confirm(`Delete ${fileKeys.length} file(s)? This cannot be undone.`)) return;
                for (const key of fileKeys) {
                  try {
                    await fetch('/api/admin/storage', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key }),
                    });
                  } catch { /* continue */ }
                }
                setSelectedKeys(new Set());
                await loadListing(currentPrefix);
              }}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
            >
              Delete Selected
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            className="px-3 py-1 border border-gray-300 rounded text-xs hover:bg-white"
          >
            Clear
          </button>
        </div>
      )}

      {/* Listing table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-2 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={
                      (prefixes.length + objects.length) > 0 &&
                      selectedKeys.size === prefixes.length + objects.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        const all = new Set([...prefixes, ...objects.map(o => o.key)]);
                        setSelectedKeys(all);
                      } else {
                        setSelectedKeys(new Set());
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 w-28">
                  Size
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 w-44">
                  Last Modified
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-700 w-48">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Folders */}
              {prefixes.map((pfx) => (
                <tr key={pfx} className={`hover:bg-gray-50 ${selectedKeys.has(pfx) ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-3">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(pfx)}
                      onChange={(e) => {
                        const next = new Set(selectedKeys);
                        if (e.target.checked) next.add(pfx);
                        else next.delete(pfx);
                        setSelectedKeys(next);
                      }}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {renamingKey === pfx ? (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && renameValue.trim()) {
                              handleRename(pfx, renameValue.trim());
                              setRenamingKey(null);
                            }
                            if (e.key === 'Escape') setRenamingKey(null);
                          }}
                          className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                        <button type="button" onClick={() => { if (renameValue.trim()) { handleRename(pfx, renameValue.trim()); setRenamingKey(null); } }} className="text-xs text-blue-600 hover:underline">Save</button>
                        <button type="button" onClick={() => setRenamingKey(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigateTo(pfx)}
                        className="flex items-center gap-2 text-blue-600 hover:underline font-medium"
                      >
                        <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        {displayName(pfx)}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">-</td>
                  <td className="px-4 py-3 text-gray-400">-</td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {writable && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setRenamingKey(pfx); setRenameValue(displayName(pfx)); }}
                          className="text-gray-600 hover:underline text-xs"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(pfx)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}

              {/* Files */}
              {objects.map((obj) => (
                <tr key={obj.key} className={`hover:bg-gray-50 ${selectedKeys.has(obj.key) ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-3">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(obj.key)}
                      onChange={(e) => {
                        const next = new Set(selectedKeys);
                        if (e.target.checked) next.add(obj.key);
                        else next.delete(obj.key);
                        setSelectedKeys(next);
                      }}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {renamingKey === obj.key ? (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && renameValue.trim()) {
                              handleRename(obj.key, renameValue.trim());
                              setRenamingKey(null);
                            }
                            if (e.key === 'Escape') setRenamingKey(null);
                          }}
                          className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                        <button type="button" onClick={() => { if (renameValue.trim()) { handleRename(obj.key, renameValue.trim()); setRenamingKey(null); } }} className="text-xs text-blue-600 hover:underline">Save</button>
                        <button type="button" onClick={() => setRenamingKey(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <span className="text-gray-900">{displayName(obj.key)}</span>
                      </div>
                    )}
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
                    {writable && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setRenamingKey(obj.key); setRenameValue(displayName(obj.key)); }}
                          className="text-gray-600 hover:underline text-xs"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(obj.key)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}

              {/* Empty state */}
              {prefixes.length === 0 && objects.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
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
