'use client';

import { useCallback, useState } from 'react';

/**
 * Package atomizer — the value-prop intake. Drop a COMPLETED proposal package
 * (a set of docs), optionally stamp its source context (agency/program/phase/
 * solicitation/topic — the "FROM" pedigree), and auto-atomize the whole thing
 * into the library. Every extracted atom carries content-class + context tags so
 * it's immediately reusable — and rank-matched — for the next proposal.
 */

interface DocResult { file: string; format: string; atoms: number; skipped?: number; reference?: boolean; error?: string }
interface PackageResult { packageName: string | null; filesProcessed: number; totalAtoms: number; context: string[]; docs: DocResult[] }

const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md';
const PROGRAMS = ['', 'sbir', 'sttr', 'baa', 'ota', 'cso', 'rif'];
const PHASES = ['', '1', '2', '3'];

export function PackageAtomizer({ tenantSlug, onDone }: { tenantSlug: string; onDone?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [packageName, setPackageName] = useState('');
  const [agency, setAgency] = useState('');
  const [program, setProgram] = useState('');
  const [phase, setPhase] = useState('');
  const [sol, setSol] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<PackageResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...Array.from(list).filter((f) => !seen.has(f.name + f.size))].slice(0, 12);
    });
  };
  const removeFile = (i: number) => setFiles((p) => p.filter((_, x) => x !== i));

  const atomize = useCallback(async () => {
    if (files.length === 0) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      if (packageName.trim()) fd.append('packageName', packageName.trim());
      const context: Record<string, string> = {};
      if (agency.trim()) context.agency = agency.trim();
      if (program) context.program = program;
      if (phase) context.phase = phase;
      if (sol.trim()) context.sol = sol.trim();
      if (topic.trim()) context.topic = topic.trim();
      if (Object.keys(context).length) fd.append('context', JSON.stringify(context));

      const res = await fetch(`/api/portal/${tenantSlug}/atoms/atomize-package`, { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(json.data as PackageResult);
        setFiles([]);
        onDone?.();
      } else {
        setErr(json.error || 'Package atomization failed');
      }
    } catch { setErr('Package atomization failed'); } finally { setBusy(false); }
  }, [files, packageName, agency, program, phase, sol, topic, tenantSlug, onDone]);

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left — dropzone + file list */}
      <div className="lg:col-span-2 space-y-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition ${drag ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
        >
          <p className="text-sm text-gray-600">Drop a completed proposal package here, or</p>
          <label className="inline-block mt-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 cursor-pointer">
            Choose files
            <input type="file" multiple accept={ACCEPT} className="hidden" disabled={busy}
                   onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <p className="mt-2 text-[11px] text-gray-400">pdf · docx · pptx · xlsx · txt · md — up to 12 files. Every file becomes a foundational document; its sections become tagged, reusable atoms.</p>
        </div>

        {files.length > 0 && (
          <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
            <div className="px-4 py-2 text-xs text-gray-500">{files.length} file{files.length > 1 ? 's' : ''} queued</div>
            {files.map((f, i) => (
              <div key={f.name + i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700 truncate">{f.name} <span className="text-gray-400">· {(f.size / 1024).toFixed(0)} KB</span></span>
                <button onClick={() => removeFile(i)} disabled={busy} className="text-gray-400 hover:text-rose-600 text-xs">remove</button>
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 text-sm">
            <p className="font-semibold text-emerald-800">Atomized {result.filesProcessed} document{result.filesProcessed > 1 ? 's' : ''} → {result.totalAtoms} atoms added to your library.</p>
            {result.context.length > 0 && <p className="mt-1 text-xs text-emerald-700">Context stamped on every atom: {result.context.join(' · ')}</p>}
            <ul className="mt-2 space-y-0.5 text-xs text-emerald-800">
              {result.docs.map((d, i) => (
                <li key={i}>• {d.file} — {d.error ? <span className="text-rose-600">{d.error}</span> : d.atoms === 0 && d.reference ? `registered as a foundational document (no sections long enough to atomize)` : <>{d.atoms} atoms ({d.format}){d.skipped ? <span className="text-emerald-600/70"> · skipped {d.skipped} short block{d.skipped > 1 ? 's' : ''}</span> : null}</>}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-emerald-700">Switch to the Library tab to browse them, or refine any atom in the Atomize tab.</p>
          </div>
        )}
      </div>

      {/* Right — package context + go */}
      <div className="space-y-3">
        <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
          <h3 className="text-sm font-semibold">Package context <span className="font-normal text-gray-400">(optional)</span></h3>
          <p className="text-[11px] text-gray-500">Stamps the &quot;FROM&quot; pedigree on every atom so reuse ranks by where it came from (the AFWERX→Navy loop). All confirmable later.</p>
          <input value={packageName} onChange={(e) => setPackageName(e.target.value)} placeholder="Package name (e.g. Aerivio AFWERX CSO 2026-1)" className={`${inputCls} w-full`} />
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">agency</span><input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="e.g. Air Force" className={`${inputCls} flex-1`} /></div>
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">program</span>
            <select value={program} onChange={(e) => setProgram(e.target.value)} className={`${inputCls} flex-1`}>
              {PROGRAMS.map((p) => <option key={p} value={p}>{p ? p.toUpperCase() : 'add…'}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value)} className={`${inputCls} flex-1`}>
              {PHASES.map((p) => <option key={p} value={p}>{p ? `Phase ${p}` : 'add…'}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">solicit.</span><input value={sol} onChange={(e) => setSol(e.target.value)} placeholder="e.g. AFWERX-CSO-2026-1" className={`${inputCls} flex-1`} /></div>
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">topic</span><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. N251-042" className={`${inputCls} flex-1`} /></div>

          <button onClick={atomize} disabled={busy || files.length === 0}
                  className="w-full text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-2 disabled:opacity-50">
            {busy ? 'Atomizing…' : `Atomize package${files.length ? ` (${files.length})` : ''}`}
          </button>
          {err && <p className="text-xs text-rose-600">{err}</p>}
        </div>
      </div>
    </div>
  );
}
