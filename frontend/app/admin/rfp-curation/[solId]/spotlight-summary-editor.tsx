'use client';

/**
 * The RFP admin's curation fields, editable at EVERY status — including after push
 * (the mid-window contract: post-Spotlight-release edits re-fan the tenant mirrors).
 *
 *  - Spotlight-match summary (mig 107): the matching context ranked against customer
 *    spotlights. REQUIRED before the push; folded into the fan-out card so scoreCard
 *    sees it — a post-push save re-publishes + re-ranks automatically.
 *  - Expert note: the opportunity's customer-visible note (`opportunities.expert_notes`,
 *    rides the card snapshot). Previously write-only from intake — this is its edit home.
 *
 * Self-contained: loads + saves via /api/admin/rfp-curation/[solId] (PATCH), which
 * returns the propagation counts shown after a live save.
 */

import { useEffect, useState } from 'react';

interface Propagation { republished: number; skipped: number; unchanged?: number; cardsRefreshed: number }

export default function SpotlightSummaryEditor({ solId }: { solId: string }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prop, setProp] = useState<Propagation | null>(null);
  const [pushed, setPushed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/rfp-curation/${solId}`);
        if (res.ok) {
          const d = await res.json();
          const s = (d.data?.solicitation?.spotlightSummary as string) ?? '';
          const n = (d.data?.solicitation?.expertNotes as string) ?? '';
          setValue(s); setSaved(s);
          setNote(n); setNoteSaved(n);
          setPushed(d.data?.solicitation?.status === 'pushed_to_pipeline');
        }
      } catch { /* ignore */ } finally {
        setLoaded(true);
      }
    })();
  }, [solId]);

  const save = async () => {
    setBusy(true); setErr(null); setProp(null);
    try {
      const body: Record<string, string> = {};
      if (value !== (saved ?? '')) body.spotlightSummary = value;
      if (note !== (noteSaved ?? '')) body.expertNotes = note;
      const res = await fetch(`/api/admin/rfp-curation/${solId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        // Baseline from the server ECHO, not the local closure — the route trims to its
        // limits, and baselining the untrimmed text would show "Saved" for text that wasn't.
        if (body.spotlightSummary !== undefined) {
          const echoed = (j?.data?.spotlightSummary as string) ?? value;
          setSaved(echoed); setValue(echoed);
        }
        if (body.expertNotes !== undefined) {
          const echoedN = (j?.data?.expertNotes as string) ?? note;
          setNoteSaved(echoedN); setNote(echoedN);
        }
        if (j?.data?.propagation) setProp(j.data.propagation as Propagation);
      } else {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Could not save.');
      }
    } catch { setErr('Network error — please try again.'); } finally {
      setBusy(false);
    }
  };

  const dirty = value !== (saved ?? '') || note !== (noteSaved ?? '');

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
        spotlight buckets. Editable after release too: a save re-fans every tenant&apos;s mirror card.
      </p>
      <textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); setErr(null); setProp(null); }}
        rows={4}
        maxLength={5000}
        disabled={!loaded || busy}
        placeholder={loaded
          ? 'e.g. Navy computer-vision property-intelligence SBIR; agencies: Navy/DoD; tech: CV, edge inference; keywords: maritime, ISR, autonomy…'
          : 'Loading…'}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="mt-3 mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          Expert note
          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-800 align-middle">Customer-visible</span>
        </h3>
        <span className="text-[11px] text-gray-400">Shown on every tenant&apos;s card</span>
      </div>
      <textarea
        value={note}
        onChange={(e) => { setNote(e.target.value); setErr(null); setProp(null); }}
        rows={2}
        maxLength={5000}
        disabled={!loaded || busy}
        placeholder={loaded ? 'e.g. Component instructions expected in Amendment 3 — page limits may tighten.' : 'Loading…'}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty || !loaded}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : pushed && dirty ? 'Save — broadcasts to tenant cards' : 'Save'}
        </button>
        {!value.trim() && (
          <span className="text-[11px] text-rose-600">
            {pushed ? 'Summary empty — tenant ranking will degrade.' : 'Summary empty — push will be blocked.'}
          </span>
        )}
        {value.trim() && !dirty && !err && <span className="text-[11px] text-green-600">Saved</span>}
        {prop && prop.republished > 0 && (
          <span className="text-[11px] text-emerald-700">
            Broadcast to tenants — {prop.cardsRefreshed} card(s) refreshed
          </span>
        )}
        {prop && prop.republished === 0 && !err && (
          <span className="text-[11px] text-gray-400">
            {(prop.unchanged ?? 0) > 0 ? 'Saved — no card-visible change to broadcast' : 'Not yet released — nothing to broadcast'}
          </span>
        )}
        {err && <span className="text-[11px] text-rose-600" role="alert">{err}</span>}
      </div>
    </div>
  );
}
