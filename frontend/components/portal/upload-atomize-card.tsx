'use client';

/**
 * UploadAtomizeCard — the "add content" surface that lives on every landing.
 *
 * Anyone (customer, team member, collaborator, or one of us acting in a company)
 * can drop a document here; it is uploaded and AUTO-atomized into THIS company's
 * library (`atoms/atomize-package`), immediately reusable and context-ranked. For a
 * collaborator this is how they OFFER content up — the atoms land in the company's
 * library for the company to use. Tenant-scoped by the route + RLS.
 */
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';

const ALLOWED = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md', 'xlsx'];
const ACCEPT = ALLOWED.map((e) => `.${e}`).join(',');

type Result = { filesProcessed?: number; totalAtoms?: number } | null;

export function UploadAtomizeCard({ tenantSlug }: { tenantSlug: string }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => ALLOWED.includes(f.name.split('.').pop()?.toLowerCase() ?? ''));
    if (list.length === 0) { setError('Supported: PDF, Word, PowerPoint, Excel, text.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      fd.append('packageName', list.length === 1 ? list[0].name : `${list.length} files`);
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/atomize-package`, { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error ?? 'Upload failed.'); return; }
      setResult((json.data ?? {}) as Result);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [tenantSlug]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Add content</h2>
        <Link href={`/portal/${tenantSlug}/atoms`} className="text-xs text-blue-600 hover:underline">Open Library →</Link>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) submit(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
          drag ? 'border-blue-400 bg-blue-50/50' : 'border-gray-300 hover:border-blue-300'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) submit(e.target.files); }}
        />
        {busy ? (
          <p className="text-sm text-gray-500">Uploading &amp; atomizing…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">Drop a document to upload &amp; atomize</p>
            <p className="mt-1 text-xs text-gray-400">PDF · Word · PowerPoint · Excel · text — becomes reusable library atoms</p>
          </>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-green-700">
          Atomized{typeof result.filesProcessed === 'number' ? ` ${result.filesProcessed} file${result.filesProcessed === 1 ? '' : 's'}` : ''}
          {typeof result.totalAtoms === 'number' ? ` into ${result.totalAtoms} atom${result.totalAtoms === 1 ? '' : 's'}` : ''}
          . <Link href={`/portal/${tenantSlug}/atoms`} className="underline">Review in Library</Link>.
        </p>
      )}
    </div>
  );
}
