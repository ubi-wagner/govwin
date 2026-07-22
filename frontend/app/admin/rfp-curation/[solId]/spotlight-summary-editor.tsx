'use client';

/**
 * The RFP admin's manual first-pass "spotlight-match summary" (mig 107) — the
 * matching context ranked against customer spotlights. REQUIRED before the push
 * (release into the Opportunity Pipeline); folded into the fan-out card so
 * scoreCard sees it. Self-contained: loads + saves via /api/admin/rfp-curation/[solId].
 */

import { useEffect, useState } from 'react';

export default function SpotlightSummaryEditor({ solId }: { solId: string }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/rfp-curation/${solId}`);
        if (res.ok) {
          const d = await res.json();
          const s = (d.data?.solicitation?.spotlightSummary as string) ?? '';
          setValue(s);
          setSaved(s);
        }
      } catch { /* ignore */ } finally {
        setLoaded(true);
      }
    })();
  }, [solId]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/rfp-curation/${solId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotlightSummary: value }),
      });
      if (res.ok) setSaved(value);
      else { const j = await res.json().catch(() => ({})); setErr(j.error || 'Could not save the summary.'); }
    } catch { setErr('Network error — please try again.'); } finally {
      setBusy(false);
    }
  };

  const dirty = value !== (saved ?? '');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-800">
          Spotlight-match summary <span className="text-rose-600">*</span>
        </h3>
        <span className="text-[11px] text-gray-400">Required before release into the Opportunity Pipeline</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">
        First-pass matching context (from the shred recommendations) — this is what ranks against customer
        spotlight buckets. The full skeleton is a separate, later step.
      </p>
      <textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); setErr(null); }}
        rows={4}
        placeholder={loaded
          ? 'e.g. Navy computer-vision property-intelligence SBIR; agencies: Navy/DoD; tech: CV, edge inference; keywords: maritime, ISR, autonomy…'
          : 'Loading…'}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save summary'}
        </button>
        {!value.trim() && <span className="text-[11px] text-rose-600">Empty — push will be blocked.</span>}
        {value.trim() && !dirty && !err && <span className="text-[11px] text-green-600">Saved</span>}
        {err && <span className="text-[11px] text-rose-600" role="alert">{err}</span>}
      </div>
    </div>
  );
}
