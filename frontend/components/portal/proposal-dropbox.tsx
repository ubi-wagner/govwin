'use client';

import { useState, useCallback, useRef } from 'react';

interface DropboxFile {
  key: string;
  filename: string;
  size: number;
  lastModified: string | null;
}

interface ProposalDropboxProps {
  proposalId: string;
  tenantSlug: string;
  userId: string;
  userName?: string;
  files: DropboxFile[];
  canDelete: boolean;
  canUpload: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf': return 'PDF';
    case 'doc':
    case 'docx': return 'DOC';
    case 'xls':
    case 'xlsx': return 'XLS';
    case 'ppt':
    case 'pptx': return 'PPT';
    case 'png':
    case 'jpg':
    case 'jpeg': return 'IMG';
    default: return 'FILE';
  }
}

function getIconColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf': return 'bg-red-100 text-red-600';
    case 'doc':
    case 'docx': return 'bg-blue-100 text-blue-600';
    case 'xls':
    case 'xlsx': return 'bg-green-100 text-green-600';
    case 'ppt':
    case 'pptx': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function ProposalDropbox({
  proposalId,
  tenantSlug,
  userId,
  userName,
  files: initialFiles,
  canDelete,
  canUpload,
}: ProposalDropboxProps) {
  const [files, setFiles] = useState<DropboxFile[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/dropbox`,
          { method: 'POST', body: formData },
        );
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || 'Upload failed');
          return;
        }

        setFiles((prev) => [
          ...prev,
          {
            key: json.data.key,
            filename: json.data.filename,
            size: json.data.size,
            lastModified: new Date().toISOString(),
          },
        ]);
      } catch {
        setError('Network error during upload');
      } finally {
        setUploading(false);
      }
    },
    [tenantSlug, proposalId],
  );

  const handleDelete = useCallback(
    async (key: string) => {
      setError(null);

      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/dropbox`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
          },
        );
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || 'Delete failed');
          return;
        }

        setFiles((prev) => prev.filter((f) => f.key !== key));
      } catch {
        setError('Network error during delete');
      }
    },
    [tenantSlug, proposalId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (!canUpload) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        uploadFile(droppedFiles[0]);
      }
    },
    [canUpload, uploadFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) uploadFile(selected);
      if (inputRef.current) inputRef.current.value = '';
    },
    [uploadFile],
  );

  return (
    <div>
      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1 mb-3">
          {files.map((file) => (
            <div key={file.key} className="flex items-center gap-2 py-1.5 text-sm">
              <span
                className={`w-8 h-8 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${getIconColor(file.filename)}`}
              >
                {getFileIcon(file.filename)}
              </span>
              <span className="flex-1 min-w-0 truncate text-gray-700">
                {file.filename}
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {formatSize(file.size)}
              </span>
              {file.lastModified && (
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {new Date(file.lastModified).toLocaleDateString()}
                </span>
              )}
              {canDelete && (
                <button
                  onClick={() => handleDelete(file.key)}
                  className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
                  title="Delete file"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-5 text-center text-sm cursor-pointer transition-colors ${
            dragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-200 text-gray-400 hover:border-blue-300 hover:bg-blue-50/50'
          }`}
        >
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-1.5">
          {error}
        </div>
      )}
    </div>
  );
}
