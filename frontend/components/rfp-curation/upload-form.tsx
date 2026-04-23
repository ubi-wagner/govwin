'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseFilenameMetadata } from '@/lib/rfp-filename-parser';

type Status = 'idle' | 'uploading' | 'success' | 'error';

const PROGRAM_TYPES = [
  { value: 'sbir_phase_1', label: 'SBIR Phase I' },
  { value: 'sbir_phase_2', label: 'SBIR Phase II' },
  { value: 'sttr_phase_1', label: 'STTR Phase I' },
  { value: 'sttr_phase_2', label: 'STTR Phase II' },
  { value: 'baa', label: 'BAA' },
  { value: 'ota', label: 'OTA' },
  { value: 'cso', label: 'CSO' },
  { value: 'rif', label: 'RIF' },
  { value: 'nofo', label: 'Grants.gov NOFO' },
  { value: 'other', label: 'Other' },
];

const MAX_TOTAL_MB = 30;

export function UploadForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const totalMb = totalBytes / 1024 / 1024;
  const formRef = useRef<HTMLFormElement>(null);

  // Best-effort auto-fill of metadata from the first file's filename.
  // Only fills fields that are currently empty so we don't overwrite
  // whatever the admin has already typed.
  const autofillFromFilename = useCallback((firstFile: File) => {
    const form = formRef.current;
    if (!form) return;
    const parsed = parseFilenameMetadata(firstFile.name);
    const setIfEmpty = (fieldName: string, value: string | undefined) => {
      if (!value) return;
      const el = form.elements.namedItem(fieldName) as HTMLInputElement | HTMLSelectElement | null;
      if (el && !el.value.trim()) {
        el.value = value;
      }
    };
    setIfEmpty('title', parsed.title);
    setIfEmpty('agency', parsed.agency);
    setIfEmpty('programType', parsed.programType);
    setIfEmpty('solicitationNumber', parsed.solicitationNumber);
  }, []);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    // Allow replacing the entire set (not appending) — clearer UX
    setFiles(arr);
    setError(null);
    if (arr.length > 0) {
      autofillFromFilename(arr[0]);
    }
  }, [autofillFromFilename]);

  const removeFile = useCallback(
    (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx)),
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('uploading');
    setError(null);

    if (files.length === 0) {
      setError('Please add at least one file.');
      setStatus('error');
      return;
    }
    if (totalMb > MAX_TOTAL_MB) {
      setError(`Total upload size ${totalMb.toFixed(1)} MB exceeds ${MAX_TOTAL_MB} MB.`);
      setStatus('error');
      return;
    }

    const form = event.currentTarget;
    const data = new FormData();
    data.set('title', String(new FormData(form).get('title') ?? ''));
    data.set('agency', String(new FormData(form).get('agency') ?? ''));
    data.set('office', String(new FormData(form).get('office') ?? ''));
    data.set('programType', String(new FormData(form).get('programType') ?? ''));
    data.set('solicitationNumber', String(new FormData(form).get('solicitationNumber') ?? ''));
    data.set('closeDate', String(new FormData(form).get('closeDate') ?? ''));
    data.set('postedDate', String(new FormData(form).get('postedDate') ?? ''));
    data.set('description', String(new FormData(form).get('description') ?? ''));
    for (const f of files) data.append('files', f);

    try {
      const resp = await fetch('/api/admin/rfp-upload', {
        method: 'POST',
        body: data,
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error ?? `Upload failed (HTTP ${resp.status})`);
      }
      setStatus('success');
      // Navigate to the new workspace
      router.push(`/admin/rfp-curation/${json.data.solicitation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-8">
      <fieldset className="space-y-4">
        <legend className="font-semibold text-lg text-gray-800">Solicitation Metadata</legend>

        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </span>
            <input
              name="title"
              required
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="DoD SBIR 26.1 Annual Program BAA"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Agency <span className="text-red-500">*</span>
            </span>
            <input
              name="agency"
              required
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Department of Defense"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Program Office</span>
            <input
              name="office"
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="AFWERX, DEVCOM, ONR..."
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Program Type <span className="text-red-500">*</span>
            </span>
            <select
              name="programType"
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">Select...</option>
              {PROGRAM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Solicitation Number</span>
            <input
              name="solicitationNumber"
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="e.g. DoD-SBIR-26.1"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Posted Date</span>
              <input
                name="postedDate"
                type="date"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Close Date</span>
              <input
                name="closeDate"
                type="date"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </label>
          </div>
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">Description / Notes</span>
          <textarea
            name="description"
            rows={3}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="Optional — additional context about this solicitation."
          />
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-semibold text-lg text-gray-800">Documents</legend>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'
          }`}
        >
          <p className="text-sm text-gray-600">
            Drag &amp; drop files here, or{' '}
            <label className="text-blue-600 hover:text-blue-800 cursor-pointer underline">
              browse
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md"
                className="sr-only"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </label>
          </p>
          <p className="mt-2 text-xs text-gray-500">
            First PDF becomes the source document. Additional files stored as attachments.
            <br />
            PDF, Word, Excel, PowerPoint, plain text. Max {MAX_TOTAL_MB} MB total.
          </p>
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              {files.length} file{files.length > 1 ? 's' : ''} selected — {totalMb.toFixed(1)} MB total
            </p>
            <ul className="space-y-1">
              {files.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded px-3 py-2"
                >
                  <span className="text-sm text-gray-700 truncate">
                    <span className="inline-block w-12 text-xs text-gray-400">
                      {idx === 0 ? 'source' : `att ${idx}`}
                    </span>
                    {f.name}
                    <span className="ml-2 text-xs text-gray-400">
                      ({(f.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === 'uploading' || files.length === 0}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
        >
          {status === 'uploading' ? 'Uploading…' : 'Upload & Create Solicitation'}
        </button>
        <a
          href="/admin/rfp-curation"
          className="text-sm text-gray-600 hover:text-gray-800"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
