'use client';

/**
 * /admin/automation-framework — the RFP-Pipeline "this changes the framework" control
 * plane (#190 §12, decision ⑦). Edits the platform automation_framework: the hard-to-tenant
 * defaults + ceilings the resolver resolves DOWN to. RFP-Pipeline admin only (enforced by
 * the API route). These values look fixed to a tenant but are tunable here.
 */
import { useEffect, useState } from 'react';

interface Framework {
  curationSlaMinutes: number;
  defaultNudgeDays: number[];
  defaultDueInMinutes: number;
  maxBucketsPerTenant: number;
  maxNudgesPerGate: number;
  agentMonthlyBudgetCeilingUsd: string;
  agentAutoRunDefault: boolean;
}

// Only the LIVE framework knobs the resolver actually enforces are editable here
// (curation SLA pin, tenant caps). default_due_in_minutes / default_nudge_days exist in the
// schema as the reserved lowest-tier fallback but are shadowed by per-gate defaults today, so
// they are deliberately NOT exposed as editable controls (adversarial-sweep MEDIUM-2).
const NUM_FIELDS: { key: keyof Framework; label: string; help: string; unit: string }[] = [
  { key: 'curationSlaMinutes', label: 'Curation SLA', help: 'RFP-admin window to review + build the matrix + release. Framework-hard: a tenant cannot move it.', unit: 'minutes' },
  { key: 'maxBucketsPerTenant', label: 'Max buckets / tenant', help: 'Cap on the number of spotlight buckets a tenant may create.', unit: 'count' },
  { key: 'maxNudgesPerGate', label: 'Max nudges / gate', help: 'Cap on the nudge cadence length (a tenant can shorten, never exceed).', unit: 'count' },
];

export default function AutomationFrameworkPage() {
  const [fw, setFw] = useState<Framework | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/automation-framework');
        if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Failed to load'); return; }
        setFw((await res.json()).data.framework);
      } catch { setError('Network error'); } finally { setLoading(false); }
    })();
  }, []);

  async function save() {
    if (!fw) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/admin/automation-framework', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curationSlaMinutes: fw.curationSlaMinutes,
          maxBucketsPerTenant: fw.maxBucketsPerTenant, maxNudgesPerGate: fw.maxNudgesPerGate,
          agentMonthlyBudgetCeilingUsd: Number(fw.agentMonthlyBudgetCeilingUsd),
          agentAutoRunDefault: fw.agentAutoRunDefault,
        }),
      });
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Failed to save'); return; }
      setFw((await res.json()).data.framework); setSaved(true);
    } catch { setError('Network error'); } finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading framework…</div>;
  if (error && !fw) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!fw) return null;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-xl font-bold text-gray-900">Automation Framework</h1>
      <p className="mt-1 text-sm text-gray-500">
        The platform defaults + ceilings every tenant&apos;s automation resolves down to. These look fixed
        to a tenant — they are tunable only here.
      </p>

      <div className="mt-6 space-y-4">
        {NUM_FIELDS.map((f) => (
          <div key={f.key} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800">{f.label}</div>
                <div className="text-xs text-gray-500">{f.help}</div>
              </div>
              <div className="flex items-center gap-2 flex-none">
                <input type="number" min={1} value={fw[f.key] as number}
                  onChange={(e) => { setFw({ ...fw, [f.key]: parseInt(e.target.value || '0', 10) }); setSaved(false); }}
                  className="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-right focus:border-blue-500 focus:outline-none" />
                <span className="text-xs text-gray-400 w-14">{f.unit}</span>
              </div>
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-violet-900">Agent monthly budget ceiling (USD)</div>
              <div className="text-xs text-violet-700">The hard ceiling. A tenant policy may only lower below it, never raise (decision ⑨).</div>
            </div>
            <input type="number" min={0} step="0.01" value={fw.agentMonthlyBudgetCeilingUsd}
              onChange={(e) => { setFw({ ...fw, agentMonthlyBudgetCeilingUsd: e.target.value }); setSaved(false); }}
              className="w-28 rounded border border-violet-300 px-2 py-1 text-sm text-right focus:border-violet-500 focus:outline-none" />
          </div>
          <label className="mt-3 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={fw.agentAutoRunDefault}
              onChange={(e) => { setFw({ ...fw, agentAutoRunDefault: e.target.checked }); setSaved(false); }}
              className="h-4 w-4 rounded border-violet-300 text-violet-600" />
            <span className="text-xs text-violet-800">Agents auto-run by default (tenants can still disable per trigger)</span>
          </label>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save framework'}
        </button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
