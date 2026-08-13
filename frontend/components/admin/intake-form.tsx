'use client';

import { useState } from 'react';

const EMPTY = { title: '', agency: '', office: '', orgUnit: '', solicitationNumber: '', programType: 'SBIR', submissionStage: 'pre_release', preReleaseDate: '', closeDate: '', poc: '', pocEmail: '', sourceUrl: '', description: '', expertNotes: '', docsDownloadable: false };

export default function IntakeForm() {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ solicitationId: string } | { error: string } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const submit = async () => {
    if (!f.title.trim() || !f.agency.trim()) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/api/admin/intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: f.title, agency: f.agency, office: f.office || null, solicitationNumber: f.solicitationNumber || null,
          programType: f.programType || null, closeDate: f.closeDate || null, description: f.description || null,
          orgUnit: f.orgUnit || null, preReleaseDate: f.preReleaseDate || null, expertNotes: f.expertNotes || null,
          submissionStage: f.submissionStage === 'nofo' ? 'nofo' : 'pre_release',
          intakeMeta: { poc: f.poc || undefined, pocEmail: f.pocEmail || undefined, sourceUrl: f.sourceUrl || undefined, docsDownloadable: f.docsDownloadable, foundBy: 'admin' },
        }),
      });
      const body = await res.json();
      setResult(res.ok ? body.data : { error: body.error ?? 'Failed' });
      if (res.ok) setF(EMPTY);
    } catch { setResult({ error: 'Network error' }); } finally { setBusy(false); }
  };

  const input = 'w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm';

  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-white space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="block text-xs text-gray-500 mb-1">Title *</label><input className={input} value={f.title} onChange={set('title')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Agency *</label><input className={input} value={f.agency} onChange={set('agency')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Office</label><input className={input} value={f.office} onChange={set('office')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Unit</label><input className={input} value={f.orgUnit} onChange={set('orgUnit')} placeholder="e.g. AFRL/RIED" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Solicitation #</label><input className={input} value={f.solicitationNumber} onChange={set('solicitationNumber')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Program</label>
          <select className={input} value={f.programType} onChange={set('programType')}><option>SBIR</option><option>STTR</option><option>BAA</option><option>OTA</option><option>CSO</option></select>
        </div>
        <div><label className="block text-xs text-gray-500 mb-1">Initial stage</label>
          <select className={input} value={f.submissionStage} onChange={set('submissionStage')}><option value="pre_release">Pre-Release</option><option value="nofo">NOFO</option></select>
        </div>
        <div><label className="block text-xs text-gray-500 mb-1">Pre-release date</label><input type="date" className={input} value={f.preReleaseDate} onChange={set('preReleaseDate')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Close date</label><input type="date" className={input} value={f.closeDate} onChange={set('closeDate')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">POC</label><input className={input} value={f.poc} onChange={set('poc')} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">POC email</label><input className={input} value={f.pocEmail} onChange={set('pocEmail')} /></div>
      </div>
      <div><label className="block text-xs text-gray-500 mb-1">Source URL</label><input className={input} value={f.sourceUrl} onChange={set('sourceUrl')} placeholder="https://sam.gov/…" /></div>
      <div><label className="block text-xs text-gray-500 mb-1">Description / notes</label><textarea rows={3} className={input} value={f.description} onChange={set('description')} /></div>
      <div><label className="block text-xs text-gray-500 mb-1">RFP Expert Notes</label><textarea rows={2} className={input} value={f.expertNotes} onChange={set('expertNotes')} placeholder="Internal expert notes carried on the opportunity card" /></div>
      <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.docsDownloadable} onChange={set('docsDownloadable')} /> Docs were downloadable</label>
      <div className="flex items-center gap-3">
        <button disabled={busy || !f.title.trim() || !f.agency.trim()} onClick={submit} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-2 disabled:opacity-50">{busy ? 'Staging…' : 'Stage into review queue'}</button>
        {result && 'solicitationId' in result && <span className="text-sm text-green-700">Staged ✓ <a className="text-blue-600 hover:underline" href="/admin/rfp-curation">Curate it →</a></span>}
        {result && 'error' in result && <span className="text-sm text-red-600">{result.error}</span>}
      </div>
    </div>
  );
}
