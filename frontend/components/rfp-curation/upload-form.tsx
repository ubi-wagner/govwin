'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseFilenameMetadata } from '@/lib/rfp-filename-parser';
import { Autocomplete } from '@/components/ui/autocomplete';

const AGENCIES = [
  'Department of Defense',
  'Department of War',
  'Department of the Air Force',
  'Department of the Army',
  'Department of the Navy',
  'Defense Advanced Research Projects Agency',
  'National Science Foundation',
  'National Institutes of Health',
  'Department of Energy',
  'Department of Transportation',
  'Department of Homeland Security',
  'National Aeronautics and Space Administration',
  'United States Department of Agriculture',
  'United States Special Operations Command',
];

const OFFICES = [
  'AFWERX', 'AFRL', 'DEVCOM', 'ONR', 'NSWC', 'NAWCAD', 'SOCOM',
  'DTRA', 'MDA', 'PEO Soldier', 'PEO STRI', 'PEO Aviation',
  'DARPA/I2O', 'DARPA/DSO', 'DARPA/MTO', 'DARPA/STO',
];

type Status = 'idle' | 'uploading' | 'shredding' | 'assisting' | 'topics' | 'success' | 'error';

/** How long to wait for the async shred before handing off to the workspace button. */
const SHRED_POLL_MS = 2_000;
const SHRED_POLL_TRIES = 20; // ~40s — a 50-page PDF shreds well inside this

/**
 * Poll until the solicitation has usable source text. Returns false on timeout or on a
 * terminal state (no document / shredder_failed) — the caller then SKIPS Assist rather than
 * running it against nothing.
 */
async function waitForShred(solId: string): Promise<boolean> {
  for (let i = 0; i < SHRED_POLL_TRIES; i++) {
    try {
      const r = await fetch(`/api/admin/rfp-curation/${solId}/ingest-assist`, { cache: 'no-store' });
      if (r.ok) {
        const d = (await r.json())?.data as { ready?: boolean; state?: string } | undefined;
        if (d?.ready) return true;
        if (d?.state === 'shred_failed' || d?.state === 'no_document') return false;
      }
    } catch { /* transient — keep polling */ }
    await new Promise((res) => setTimeout(res, SHRED_POLL_MS));
  }
  return false;
}

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
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [agency, setAgency] = useState('');
  const [office, setOffice] = useState('');
  const [dupeLink, setDupeLink] = useState<string | null>(null);
  const [runAssist, setRunAssist] = useState(true);
  // Optional topic files uploaded alongside the umbrella (multi-topic BAAs) —
  // each becomes a topic opportunity in one flow after the umbrella is created.
  const [topicFiles, setTopicFiles] = useState<File[]>([]);
  const [topicDragOver, setTopicDragOver] = useState(false);

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
    setIfEmpty('programType', parsed.programType);
    setIfEmpty('solicitationNumber', parsed.solicitationNumber);
    // Agency + office are controlled — set via state
    if (parsed.agency && !agency) setAgency(parsed.agency);
  }, [agency]);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    // Append new files to the existing set so users can add in batches
    setFiles(prev => [...prev, ...arr]);
    setError(null);
    if (arr.length > 0) {
      autofillFromFilename(arr[0]);
    }
  }, [autofillFromFilename]);

  const removeFile = useCallback(
    (idx: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== idx));
      setPrimaryIndex((prev) => {
        if (idx === prev) return 0;
        if (idx < prev) return prev - 1;
        return prev;
      });
    },
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
    data.set('agency', agency);
    data.set('office', office);
    data.set('programType', String(new FormData(form).get('programType') ?? ''));
    data.set('solicitationNumber', String(new FormData(form).get('solicitationNumber') ?? ''));
    data.set('closeDate', String(new FormData(form).get('closeDate') ?? ''));
    data.set('postedDate', String(new FormData(form).get('postedDate') ?? ''));
    data.set('description', String(new FormData(form).get('description') ?? ''));
    data.set('primaryIndex', String(primaryIndex));
    for (const f of files) data.append('files', f);

    try {
      const resp = await fetch('/api/admin/rfp-upload', {
        method: 'POST',
        body: data,
      });
      const json = await resp.json();
      if (!resp.ok) {
        // If it's a duplicate file, show a link to the existing solicitation
        if (json.code === 'DUPLICATE_FILE' && json.details?.existingSolicitationId) {
          setError(json.error);
          setDupeLink(`/admin/rfp-curation/${json.details.existingSolicitationId}`);
          setStatus('error');
          return;
        }
        throw new Error(json.error ?? `Upload failed (HTTP ${resp.status})`);
      }
      // Ingest Assist — auto-build the matrix, volumes & section molds FOR REVIEW right
      // after upload. Review-gated: it does NOT publish to customers — the upload lands in
      // your curation queue, and you release it with Push after review. Same materializer the
      // Scouts feed. Best-effort: on failure, the workspace still has the manual button.
      //
      // WAIT FOR THE SHRED FIRST. The upload only EMITS `finder:rfp.uploaded`; OnRfpUploaded
      // extracts the text asynchronously, so at this instant `full_text` is almost always still
      // empty. Firing Assist here used to build the whole matrix off the default skeleton and
      // present it as if the document had been read. Poll the readiness endpoint, then run.
      // If the shred is still going when we give up, we simply skip — the workspace button
      // stays, and it now reports the real state instead of fabricating one.
      const solId = json.data.solicitation_id as string;
      if (runAssist && solId) {
        setStatus('shredding');
        const ready = await waitForShred(solId);
        if (ready) {
          setStatus('assisting');
          try {
            await fetch(`/api/admin/rfp-curation/${solId}/ingest-assist`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publish: false }),
            });
          } catch { /* non-fatal */ }
        }
      }
      // Topic files → topic opportunities (single-flow: 1 umbrella + N topic
      // files → N topic OPPs). Best-effort: on failure the workspace drop-zone
      // still creates them. Dedup by (solicitation_id, topic_number) protects
      // against overlap with any topics ingest-assist derived from the umbrella.
      if (topicFiles.length > 0 && solId) {
        setStatus('topics');
        try {
          const td = new FormData();
          td.set('solicitationId', solId);
          for (const tf of topicFiles) td.append('files', tf);
          await fetch('/api/admin/upload-topic-files', { method: 'POST', body: td });
        } catch { /* non-fatal — the workspace drop-zone still works */ }
      }
      setStatus('success');
      router.push(`/admin/rfp-curation/${solId}`);
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
          <div className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Agency <span className="text-red-500">*</span>
            </span>
            <Autocomplete
              name="agency"
              required
              value={agency}
              onChange={setAgency}
              suggestions={AGENCIES}
              placeholder="Department of Defense"
            />
          </div>
          <div className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Program Office</span>
            <Autocomplete
              name="office"
              value={office}
              onChange={setOffice}
              suggestions={OFFICES}
              placeholder="AFWERX, DEVCOM, ONR..."
            />
          </div>
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
                  <span className="text-sm text-gray-700 truncate flex items-center gap-2">
                    <label
                      className="flex items-center gap-1 cursor-pointer shrink-0"
                      title={idx === primaryIndex ? 'Primary document' : 'Set as primary'}
                    >
                      <input
                        type="radio"
                        name="primaryFile"
                        checked={idx === primaryIndex}
                        onChange={() => setPrimaryIndex(idx)}
                        className="accent-yellow-500"
                      />
                      <span className={`text-xs ${idx === primaryIndex ? 'text-yellow-600 font-medium' : 'text-gray-400'}`}>
                        {idx === primaryIndex ? 'primary' : `att ${idx}`}
                      </span>
                    </label>
                    {f.name}
                    <span className="ml-2 text-xs text-gray-400">
                      ({(f.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="text-xs text-red-600 hover:text-red-800 shrink-0 ml-2"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold text-lg text-gray-800">
          Topic files <span className="text-sm font-normal text-gray-500">(optional — multi-topic BAAs)</span>
        </legend>
        <div
          onDragOver={(e) => { e.preventDefault(); setTopicDragOver(true); }}
          onDragLeave={() => setTopicDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setTopicDragOver(false);
            if (e.dataTransfer.files.length) setTopicFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
          }}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            topicDragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'
          }`}
        >
          <p className="text-sm text-gray-600">
            Drop the individual topic files here, or{' '}
            <label className="text-blue-600 hover:text-blue-800 cursor-pointer underline">
              browse
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.txt,.md"
                className="sr-only"
                onChange={(e) => e.target.files && setTopicFiles((prev) => [...prev, ...Array.from(e.target.files!)])}
              />
            </label>
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Each file becomes a <b>topic opportunity</b> under this solicitation. Leave empty for a single-topic solicitation.
          </p>
        </div>
        {topicFiles.length > 0 && (
          <div className="flex items-center justify-between text-xs text-gray-600 bg-indigo-50/60 border border-indigo-100 rounded px-3 py-2">
            <span>{topicFiles.length} topic file{topicFiles.length > 1 ? 's' : ''} → {topicFiles.length} opportunit{topicFiles.length > 1 ? 'ies' : 'y'} on upload</span>
            <button type="button" onClick={() => setTopicFiles([])} className="text-red-600 hover:text-red-800">Clear</button>
          </div>
        )}
      </fieldset>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
          {dupeLink && (
            <a
              href={dupeLink}
              className="block mt-2 text-blue-600 hover:text-blue-800 underline font-medium"
            >
              Go to the existing solicitation &rarr;
            </a>
          )}
        </div>
      )}

      {/* Ingest Assist opt-in — run the ingest SOP right after upload. */}
      <label className="flex items-start gap-2 p-3 rounded-lg border border-indigo-200 bg-indigo-50/60 cursor-pointer">
        <input
          type="checkbox"
          checked={runAssist}
          onChange={(e) => setRunAssist(e.target.checked)}
          className="mt-0.5 accent-indigo-600"
        />
        <span className="text-sm">
          <span className="font-medium text-indigo-800">✨ Run Ingest Assist after upload</span>
          <span className="block text-xs text-indigo-700/80">
            Parse the solicitation and auto-build the compliance matrix, volumes &amp; section molds for
            review. Nothing is published to customers — you&apos;ll land in the curation workspace with it
            ready to review, and release it with Push.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === 'uploading' || status === 'shredding' || status === 'assisting' || status === 'topics' || files.length === 0}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded"
        >
          {status === 'uploading' ? 'Uploading…'
            : status === 'shredding' ? 'Extracting document text…'
            : status === 'assisting' ? 'Building matrix & skeleton…'
            : status === 'topics' ? 'Creating topic opportunities…'
            : topicFiles.length > 0 ? `Upload + ${topicFiles.length} topic${topicFiles.length > 1 ? 's' : ''}`
            : runAssist ? 'Upload & Ingest Assist' : 'Upload & Create Solicitation'}
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
