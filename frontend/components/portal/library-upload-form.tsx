'use client';

import { useCallback, useRef, useState } from 'react';

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md'];
const ACCEPT_STRING = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');

interface UploadItem {
  file: File;
  status: 'pending' | 'uploading' | 'atomizing' | 'done' | 'error';
  progress: number;
  id?: string;
  errorMessage?: string;
}

export default function LibraryUploadForm({
  tenantSlug,
}: {
  tenantSlug: string;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: UploadItem[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        continue;
      }
      newItems.push({ file, status: 'pending', progress: 0 });
    }
    if (newItems.length > 0) {
      setItems((prev) => [...prev, ...newItems]);
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

  const uploadAll = useCallback(async () => {
    const pendingIndices = items
      .map((item, i) => (item.status === 'pending' ? i : -1))
      .filter((i) => i >= 0);

    for (const idx of pendingIndices) {
      const item = items[idx];
      if (!item) continue;

      setItems((prev) =>
        prev.map((it, i) =>
          i === idx ? { ...it, status: 'uploading', progress: 10 } : it,
        ),
      );

      try {
        const formData = new FormData();
        formData.append('files', item.file);

        const res = await fetch(
          `/api/portal/${tenantSlug}/library/upload`,
          { method: 'POST', body: formData },
        );

        setItems((prev) =>
          prev.map((it, i) =>
            i === idx ? { ...it, progress: 80 } : it,
          ),
        );

        if (!res.ok) {
          let errMsg = 'Upload failed';
          try {
            const body = await res.json();
            if (body && typeof body.error === 'string') {
              errMsg = body.error;
            }
          } catch {
            // ignore parse error
          }
          setItems((prev) =>
            prev.map((it, i) =>
              i === idx
                ? { ...it, status: 'error', progress: 0, errorMessage: errMsg }
                : it,
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

        setItems((prev) =>
          prev.map((it, i) =>
            i === idx
              ? { ...it, status: 'atomizing', progress: 90, id: uploadedId }
              : it,
          ),
        );

        // Simulate a brief pause to show the "atomizing" state
        // Then trigger actual atomization
        await new Promise((resolve) => setTimeout(resolve, 500));

        try {
          await fetch(`/api/portal/${tenantSlug}/library/atomize`, { method: 'POST' });
        } catch {
          // atomization failure is non-fatal — docs are uploaded, atoms come later
        }

        setItems((prev) =>
          prev.map((it, i) =>
            i === idx ? { ...it, status: 'done', progress: 100 } : it,
          ),
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Upload failed';
        setItems((prev) =>
          prev.map((it, i) =>
            i === idx
              ? { ...it, status: 'error', progress: 0, errorMessage: errMsg }
              : it,
          ),
        );
      }
    }
  }, [items, tenantSlug]);

  const hasPending = items.some((it) => it.status === 'pending');
  const isUploading = items.some(
    (it) => it.status === 'uploading' || it.status === 'atomizing',
  );

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
        }`}
      >
        <p className="text-gray-600 font-medium">
          Drag and drop files here, or click to browse
        </p>
        <p className="text-gray-400 text-sm mt-1">
          {ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(', ')}
        </p>
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
      {items.length > 0 && (
        <div className="mt-6 space-y-3">
          {items.map((item, idx) => (
            <div
              key={`${item.file.name}-${idx}`}
              className="flex items-center gap-4 border border-gray-200 rounded-lg px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.file.name}</p>
                <p className="text-xs text-gray-400">
                  {(item.file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="w-36 flex items-center gap-2">
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
                {item.status === 'atomizing' && (
                  <span className="text-xs text-amber-600 animate-pulse">
                    Atomizing...
                  </span>
                )}
                {item.status === 'done' && (
                  <span className="text-xs text-green-600">Done</span>
                )}
                {item.status === 'error' && (
                  <span
                    className="text-xs text-red-600 truncate"
                    title={item.errorMessage}
                  >
                    {item.errorMessage ?? 'Error'}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Upload button */}
          <div className="mt-4">
            <button
              onClick={uploadAll}
              disabled={!hasPending || isUploading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? 'Uploading...' : 'Upload All'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
