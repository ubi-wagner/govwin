'use client';

import { useCallback, useRef, useState } from 'react';

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'txt', 'md'];
const ACCEPT_STRING = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');

const FILE_ICONS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
  pptx: 'PPTX',
  ppt: 'PPT',
  xlsx: 'XLSX',
  txt: 'TXT',
  md: 'MD',
};

interface UploadFile {
  file: File;
  id?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'atomizing' | 'done' | 'error';
  progress: number;
  errorMessage?: string;
}

interface BulkUploadProps {
  tenantSlug: string;
  onComplete?: () => void;
}

export default function BulkUpload({ tenantSlug, onComplete }: BulkUploadProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAtomizing, setIsAtomizing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: UploadFile[] = [];
    for (const file of Array.from(fileList)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.includes(ext)) continue;
      newFiles.push({ file, status: 'pending', progress: 0 });
    }
    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = '';
      }
    },
    [addFiles],
  );

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const uploadAll = useCallback(async () => {
    const pendingIndices = files
      .map((f, i) => (f.status === 'pending' ? i : -1))
      .filter((i) => i >= 0);

    for (const idx of pendingIndices) {
      const item = files[idx];
      if (!item) continue;

      setFiles((prev) =>
        prev.map((f, i) =>
          i === idx ? { ...f, status: 'uploading', progress: 20 } : f,
        ),
      );

      try {
        const formData = new FormData();
        formData.append('files', item.file);

        const res = await fetch(
          `/api/portal/${tenantSlug}/library/upload`,
          { method: 'POST', body: formData },
        );

        setFiles((prev) =>
          prev.map((f, i) => (i === idx ? { ...f, progress: 80 } : f)),
        );

        if (!res.ok) {
          let errMsg = 'Upload failed';
          try {
            const body = await res.json();
            if (body && typeof body.error === 'string') errMsg = body.error;
          } catch { /* ignore */ }
          setFiles((prev) =>
            prev.map((f, i) =>
              i === idx ? { ...f, status: 'error', progress: 0, errorMessage: errMsg } : f,
            ),
          );
          continue;
        }

        const body = await res.json();
        const uploaded = body?.data?.uploaded;
        const uploadedId =
          Array.isArray(uploaded) && uploaded.length > 0
            ? (uploaded[0].id as string)
            : undefined;

        setFiles((prev) =>
          prev.map((f, i) =>
            i === idx ? { ...f, status: 'uploaded', progress: 100, id: uploadedId } : f,
          ),
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Upload failed';
        setFiles((prev) =>
          prev.map((f, i) =>
            i === idx ? { ...f, status: 'error', progress: 0, errorMessage: errMsg } : f,
          ),
        );
      }
    }
  }, [files, tenantSlug]);

  const atomizeAll = useCallback(async () => {
    setIsAtomizing(true);
    // Collect file IDs from successfully uploaded files
    const uploadedFileIds = files
      .filter((f) => f.status === 'uploaded' && f.id)
      .map((f) => f.id as string);

    // Mark uploaded files as atomizing
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'uploaded' ? { ...f, status: 'atomizing' } : f,
      ),
    );

    try {
      await fetch(`/api/portal/${tenantSlug}/library/atomize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: uploadedFileIds }),
      });

      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'atomizing' ? { ...f, status: 'done' } : f,
        ),
      );
      onComplete?.();
    } catch {
      // Non-fatal; files are uploaded, atoms come later
      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'atomizing' ? { ...f, status: 'uploaded' } : f,
        ),
      );
    } finally {
      setIsAtomizing(false);
    }
  }, [tenantSlug, onComplete]);

  const hasPending = files.some((f) => f.status === 'pending');
  const isUploading = files.some((f) => f.status === 'uploading');
  const hasUploaded = files.some((f) => f.status === 'uploaded');
  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');

  function getExtension(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? '';
  }

  function getExtBadgeColor(ext: string): string {
    switch (ext) {
      case 'pdf': return 'bg-red-100 text-red-700';
      case 'docx': case 'doc': return 'bg-blue-100 text-blue-700';
      case 'pptx': case 'ppt': return 'bg-orange-100 text-orange-700';
      case 'xlsx': return 'bg-green-100 text-green-700';
      case 'txt': case 'md': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          isDragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-blue-300 bg-gray-50 hover:bg-blue-50/30'
        }`}
      >
        <div className="flex flex-col items-center gap-2">
          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-gray-600 font-medium">
            Drag and drop files here, or click to browse
          </p>
          <p className="text-gray-400 text-sm">
            Accepted: {ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(', ')}
          </p>
          <p className="text-gray-400 text-xs mt-1">
            Upload multiple files at once — up to 50MB total
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((item, idx) => {
            const ext = getExtension(item.file.name);
            return (
              <div
                key={`${item.file.name}-${idx}`}
                className="flex items-center gap-3 border border-gray-200 rounded-lg px-4 py-3 bg-white"
              >
                <span className={`text-xs font-bold px-2 py-1 rounded ${getExtBadgeColor(ext)}`}>
                  {FILE_ICONS[ext] ?? ext.toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.file.name}</p>
                  <p className="text-xs text-gray-400">
                    {(item.file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <div className="w-40 flex items-center gap-2">
                  {item.status === 'pending' && (
                    <span className="text-xs text-gray-400">Ready</span>
                  )}
                  {item.status === 'uploading' && (
                    <>
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-blue-600">Uploading</span>
                    </>
                  )}
                  {item.status === 'uploaded' && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Uploaded
                    </span>
                  )}
                  {item.status === 'atomizing' && (
                    <span className="text-xs text-amber-600 animate-pulse">
                      Atomizing...
                    </span>
                  )}
                  {item.status === 'done' && (
                    <span className="text-xs text-green-600 font-medium">Done</span>
                  )}
                  {item.status === 'error' && (
                    <span className="text-xs text-red-600 truncate" title={item.errorMessage}>
                      {item.errorMessage ?? 'Error'}
                    </span>
                  )}
                </div>
                {item.status === 'pending' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                    className="text-gray-400 hover:text-red-500 text-sm"
                    aria-label="Remove file"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            {hasPending && (
              <button
                onClick={uploadAll}
                disabled={isUploading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? 'Uploading...' : `Upload All (${files.filter((f) => f.status === 'pending').length})`}
              </button>
            )}
            {hasUploaded && !isAtomizing && (
              <button
                onClick={atomizeAll}
                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
              >
                Atomize All
              </button>
            )}
            {allDone && (
              <p className="text-sm text-green-600 font-medium">
                All files processed successfully.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
