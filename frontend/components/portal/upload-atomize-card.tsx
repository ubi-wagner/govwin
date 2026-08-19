'use client';

/**
 * UploadAtomizeCard — the "add content" surface that lives on every landing.
 *
 * Anyone (customer, team member, collaborator, or one of us acting in a company)
 * can drop a document here; it is atomized into THIS company's library
 * (`atoms/atomize-package`), immediately reusable and context-ranked. For a
 * collaborator this is how they OFFER content up — the atoms land in the company's
 * library for the company to use. Tenant-scoped by the route + RLS.
 *
 * A drop no longer writes instantly: it first asks the route for a DRY-RUN preview of
 * exactly what would be created (title + word count per atom, + short blocks skipped),
 * and the user confirms before anything lands. The same segmentation drives preview +
 * write, so the preview can't lie about what you'll get.
 */
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';

// Only the modern OOXML formats parse cleanly; legacy .doc/.ppt/.xls are dropped rather than
// advertised-then-silently-emptied (the parser reads OOXML only).
const ALLOWED = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md'];
const ACCEPT = ALLOWED.map((e) => `.${e}`).join(',');

type PlanItem = { title: string; wordCount: number };
type Unextractable = { count: number; kind: string; hint: string };
type PreviewDoc = { file: string; planned: PlanItem[]; skipped: number; error?: string; unextractable?: Unextractable;
  /** Running header/footer removed from every page before atomizing (see lib/library/page-furniture). */
  strippedFurniture?: string[] };
type Preview = { totalPlanned: number; docs: PreviewDoc[] } | null;
type Result = { filesProcessed?: number; totalAtoms?: number } | null;

export function UploadAtomizeCard({ tenantSlug, canBrowseLibrary = true }: { tenantSlug: string; canBrowseLibrary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [result, setResult] = useState<Result>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<File[]>([]); // files held between preview and confirm

  const filterAllowed = (files: FileList | File[]) =>
    Array.from(files).filter((f) => ALLOWED.includes(f.name.split('.').pop()?.toLowerCase() ?? ''));
  const packageNameOf = (list: File[]) => (list.length === 1 ? list[0].name : `${list.length} files`);

  // Step 1 — dry-run: ask the route what WOULD be created; write nothing yet.
  const runPreview = useCallback(async (files: FileList | File[]) => {
    const list = filterAllowed(files);
    if (list.length === 0) { setError('Supported: PDF, Word, PowerPoint, Excel, text.'); return; }
    setBusy(true); setError(null); setResult(null); setPreview(null);
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      fd.append('packageName', packageNameOf(list));
      fd.append('preview', '1');
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/atomize-package`, { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error ?? 'Could not read the document.'); return; }
      pendingRef.current = list;
      setPreview((json.data ?? { totalPlanned: 0, docs: [] }) as Preview);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [tenantSlug]);

  // Step 2 — commit: atomize the previewed files for real.
  const confirmCreate = useCallback(async () => {
    const list = pendingRef.current;
    if (!list.length) { setPreview(null); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      fd.append('packageName', packageNameOf(list));
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/atomize-package`, { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error ?? 'Atomize failed.'); return; }
      setResult((json.data ?? {}) as Result);
      setPreview(null);
      pendingRef.current = [];
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }, [tenantSlug]);

  const cancel = useCallback(() => { setPreview(null); pendingRef.current = []; setError(null); }, []);

  const totalSkipped = preview ? preview.docs.reduce((n, d) => n + (d.skipped || 0), 0) : 0;
  const totalUnextractable = preview ? preview.docs.reduce((n, d) => n + (d.unextractable?.count || 0), 0) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Add content</h2>
        {/* External collaborators can atomize INTO the company library (offer content
            up) but can't browse it — /atoms is tenant-staff only and redirects them. */}
        {canBrowseLibrary && (
          <Link href={`/portal/${tenantSlug}/atoms`} className="text-xs text-blue-600 hover:underline">Open Library →</Link>
        )}
      </div>

      {/* Preview (dry-run) — confirm before anything is written. */}
      {preview ? (
        <div className="rounded-md border border-gray-200">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50 rounded-t-md">
            <span className="text-sm font-medium text-gray-800">
              {preview.totalPlanned > 0
                ? <>Ready to atomize — <b>{preview.totalPlanned}</b> atom{preview.totalPlanned === 1 ? '' : 's'}{preview.docs.length > 1 ? ` from ${preview.docs.length} files` : ''}</>
                : 'Nothing to atomize from that file'}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {totalUnextractable > 0 && <span className="text-[11px] font-medium text-amber-700">⚠ {totalUnextractable} not text-readable</span>}
              {totalSkipped > 0 && <span className="text-[11px] text-amber-600">skipped {totalSkipped} short block{totalSkipped === 1 ? '' : 's'}</span>}
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
            {preview.docs.map((d) => (
              <div key={d.file} className="px-4 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-700 truncate">{d.file}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {d.error ? <span className="text-rose-600">{d.error}</span> : `${d.planned.length} atom${d.planned.length === 1 ? '' : 's'}${d.skipped ? ` · skipped ${d.skipped}` : ''}`}
                  </span>
                </div>
                {d.planned.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {d.planned.slice(0, 6).map((p, i) => (
                      <li key={i} className="text-[11px] text-gray-500 flex items-center gap-2">
                        <span className="truncate">{p.title || '(untitled)'}</span>
                        <span className="text-gray-300 tabular-nums shrink-0">{p.wordCount}w</span>
                      </li>
                    ))}
                    {d.planned.length > 6 && <li className="text-[11px] text-gray-400">+ {d.planned.length - 6} more</li>}
                  </ul>
                )}
                {/* Running header/footer removed from every page. Shown because it is the SOURCE
                    document's furniture — on a past proposal that is the previous solicitation's
                    topic and proposal numbers, which would otherwise be welded into every atom and
                    resurface inside a new proposal's draft. Visible here so a mis-detection can be
                    caught BEFORE the library is written. */}
                {d.strippedFurniture && d.strippedFurniture.length > 0 && (
                  <div className="mt-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] leading-snug text-gray-600">
                    <span className="font-medium">Removed repeated page header/footer:</span>
                    <ul className="mt-0.5 space-y-0.5">
                      {d.strippedFurniture.slice(0, 3).map((f, i) => (
                        <li key={i} className="truncate font-mono text-gray-500">{f}</li>
                      ))}
                      {d.strippedFurniture.length > 3 && (
                        <li className="text-gray-400">+ {d.strippedFurniture.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                )}
                {/* BOX-3: visual content the parser couldn't read as text → route to the box tool. */}
                {d.unextractable && d.unextractable.count > 0 && (
                  <div className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800">
                    {d.unextractable.hint}{' '}
                    {canBrowseLibrary && (
                      <Link href={`/portal/${tenantSlug}/atoms?tab=capture`} className="font-medium underline whitespace-nowrap">Open the box tool →</Link>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-100">
            <button onClick={cancel} disabled={busy} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button onClick={confirmCreate} disabled={busy || preview.totalPlanned === 0} className="text-xs px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              {busy ? 'Atomizing…' : `Create ${preview.totalPlanned} atom${preview.totalPlanned === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) runPreview(e.dataTransfer.files); }}
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
            onChange={(e) => { if (e.target.files?.length) runPreview(e.target.files); }}
          />
          {busy ? (
            <p className="text-sm text-gray-500">Reading &amp; previewing…</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">Drop a document to preview &amp; atomize</p>
              <p className="mt-1 text-xs text-gray-400">PDF · Word · PowerPoint · Excel · text — you confirm before anything is created</p>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-green-700">
          Atomized{typeof result.filesProcessed === 'number' ? ` ${result.filesProcessed} file${result.filesProcessed === 1 ? '' : 's'}` : ''}
          {typeof result.totalAtoms === 'number' ? ` into ${result.totalAtoms} atom${result.totalAtoms === 1 ? '' : 's'}` : ''}
          {canBrowseLibrary ? (
            <>. <Link href={`/portal/${tenantSlug}/atoms`} className="underline">Review in Library</Link>.</>
          ) : ' — added to the company library.'}
        </p>
      )}
    </div>
  );
}
