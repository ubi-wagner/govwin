'use client';

/**
 * SaveAsTemplate — "this volume is a sound template" (docs/CANVAS_GEOMETRY_REDESIGN.md §5d).
 *
 * An admin declares a built volume a template; the server extracts its SKELETON
 * (frame + section organs + muscle slots, content stripped) into a reusable
 * tenant `document_templates` row. Compact popover from the volume header.
 */
import { useState } from 'react';

const TYPES: Array<{ v: string; label: string }> = [
  { v: 'technical_volume', label: 'Technical Volume' },
  { v: 'cost_volume', label: 'Cost Volume' },
  { v: 'slide_deck', label: 'Slide Deck' },
  { v: 'past_performance', label: 'Past Performance' },
  { v: 'key_personnel', label: 'Key Personnel' },
  { v: 'commercialization', label: 'Commercialization' },
  { v: 'abstract', label: 'Abstract' },
  { v: 'cover_sheet', label: 'Cover Sheet' },
  { v: 'supporting_docs', label: 'Supporting Docs' },
  { v: 'custom', label: 'Custom' },
];

export function SaveAsTemplate({
  tenantSlug, proposalId, artifactId, volumeName, defaultType = 'technical_volume', agency, program,
}: {
  tenantSlug: string; proposalId: string; artifactId: string; volumeName: string;
  defaultType?: string; agency?: string; program?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(volumeName || 'Template');
  const [type, setType] = useState(defaultType);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sections: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/templates/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId, proposalId, name: name.trim(), templateType: type, agency, program }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) setDone({ sections: json.data.sections?.length ?? 0 });
      else setErr(json.error || 'Could not save template');
    } catch { setErr('Could not save template'); } finally { setBusy(false); }
  };

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => { setOpen((v) => !v); setDone(null); setErr(null); }}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        title="Extract this volume's skeleton (frame + sections + slots) as a reusable template"
      >
        Save as template
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-left">
          {done ? (
            <div className="text-xs">
              <p className="font-semibold text-emerald-700">Template saved — {done.sections} section skeleton.</p>
              <p className="mt-1 text-gray-500">Find it under <span className="font-medium">Templates</span> to start a new document from it.</p>
              <button onClick={() => setOpen(false)} className="mt-2 text-indigo-600 hover:underline">Close</button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Save volume as template</p>
              <p className="text-[10px] text-gray-400 -mt-1">Keeps the frame + section skeleton + slots; strips the content.</p>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="w-full text-xs border border-gray-300 rounded px-2 py-1" />
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full text-xs border border-gray-300 rounded px-2 py-1">
                {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={save} disabled={busy || !name.trim()} className="flex-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded px-2 py-1">
                  {busy ? 'Extracting…' : 'Extract skeleton'}
                </button>
                <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-700 px-1">Cancel</button>
              </div>
              {err && <p className="text-[11px] text-rose-600">{err}</p>}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
