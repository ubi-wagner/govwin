'use client';

import { useCallback, useEffect, useState } from 'react';

interface Limits { maxStages: number; maxCollaborators: number; maxManagers: number; maxNudges: number }

export default function GuardrailDefaults() {
  const [limits, setLimits] = useState<Limits>({ maxStages: 3, maxCollaborators: 10, maxManagers: 1, maxNudges: 3 });
  const [defaults, setDefaults] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/guardrail-defaults');
      if (res.ok) {
        const cfg = (await res.json()).data?.defaults as { limits?: Partial<Limits>; defaults?: Record<string, unknown> } | null;
        if (cfg?.limits) setLimits((p) => ({ ...p, ...cfg.limits }));
        setDefaults(cfg?.defaults ?? null);
      }
    } catch { /* keep */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    setBusy(true); setSaved(false); setErr(null);
    try {
      const res = await fetch('/api/admin/guardrail-defaults', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limits }) });
      if (res.ok) setSaved(true);
      else { const j = await res.json().catch(() => ({})); setErr(j.error || 'Could not save the limits.'); }
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [limits]);

  const field = (k: keyof Limits, label: string) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type="number" min={1} value={limits[k]} onChange={(e) => setLimits((p) => ({ ...p, [k]: Math.max(1, parseInt(e.target.value || '1', 10)) }))} className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
    </div>
  );

  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-white space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {field('maxStages', 'Max stages')}
        {field('maxCollaborators', 'Max collaborators')}
        {field('maxManagers', 'Max managers')}
        {field('maxNudges', 'Max nudges')}
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy} onClick={save} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-2 disabled:opacity-50">{busy ? 'Saving…' : 'Save limits'}</button>
        {saved && <span className="text-sm text-green-700">Saved ✓</span>}
        {err && <span className="text-sm text-red-500" role="alert">{err}</span>}
      </div>
      {defaults && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Default stages + nudge schedule (JSON):</p>
          <pre className="text-[11px] bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">{JSON.stringify(defaults, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
