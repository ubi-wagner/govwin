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
  /** Award size + how we came by it (mig 241) — required before release, estimate allowed. */
  const [awardBasis, setAwardBasis] = useState('');
  const [awardBasisSaved, setAwardBasisSaved] = useState('');
  const [awardAmount, setAwardAmount] = useState('');
  const [awardAmountSaved, setAwardAmountSaved] = useState('');

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
          // The GET is `SELECT cs.*, o.*`, so the basis arrives as the whole map (camelCased by
          // postgres.toCamel: field_basis → fieldBasis). Reading a top-level `awardBasis` that no
          // query produces is the plumbed-and-dry shape this session has already hit twice.
          const fb = d.data?.solicitation?.fieldBasis;
          const b = (fb && typeof fb === 'object' && typeof fb.award_amount === 'string') ? fb.award_amount : '';
          const a = d.data?.solicitation?.awardAmount;
          const aStr = typeof a === 'number' ? String(a) : '';
          setAwardBasis(b); setAwardBasisSaved(b);
          setAwardAmount(aStr); setAwardAmountSaved(aStr);
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
      // The award is sent as its own PATCH: the route treats summary / note / award as three
      // independent writes and emits a different event for each, so batching them would make one
      // event stand for three decisions.
      const awardBody: Record<string, unknown> | null =
        awardBasis !== awardBasisSaved || awardAmount !== awardAmountSaved
          ? { awardBasis, ...(awardBasis === 'not_stated' ? {} : { awardAmount: Number(awardAmount) }) }
          : null;
      const res = Object.keys(body).length > 0
        ? await fetch(`/api/admin/rfp-curation/${solId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : new Response(JSON.stringify({ data: {} }), { status: 200 });
      if (awardBody) {
        const ar = await fetch(`/api/admin/rfp-curation/${solId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(awardBody),
        });
        if (!ar.ok) {
          const j = await ar.json().catch(() => ({}));
          setErr(j.error || 'Could not save the award size.'); setBusy(false); return;
        }
        setAwardBasisSaved(awardBasis); setAwardAmountSaved(awardAmount);
      }
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

  const dirty = value !== (saved ?? '') || note !== (noteSaved ?? '')
    || awardBasis !== awardBasisSaved || awardAmount !== awardAmountSaved;

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
      {/*
        AWARD SIZE — the first question a small business asks, and until mig 241 it had no way in:
        `award_amount` had zero writers in the tree and measured 0 of 22 on the box while the bridge
        carried it onto every card.

        The BASIS is the control, not the number. Demanding a figure from an admin reading a BAA
        that states none leaves two options — block the release or invent one — and inventing it is
        what INGEST_PROVENANCE forbids. "Our estimate" is the middle path: real knowledge, badged
        so a customer never mistakes it for something we read.
      */}
      <div className="mt-3 mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          Award size <span className="text-rose-600">*</span>
          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-800 align-middle">Customer-visible</span>
        </h3>
        <span className="text-[11px] text-gray-400">Required before release — an estimate counts</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={awardBasis}
          onChange={(e) => { setAwardBasis(e.target.value); setErr(null); setProp(null); }}
          disabled={!loaded || busy}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">— not decided —</option>
          <option value="stated">Stated in the solicitation</option>
          <option value="estimated">Admin estimated amount</option>
          <option value="not_stated">Solicitation does not state one</option>
        </select>
        {awardBasis && awardBasis !== 'not_stated' && (
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">$</span>
            <input
              type="number" min="0" step="1000" value={awardAmount}
              onChange={(e) => { setAwardAmount(e.target.value); setErr(null); setProp(null); }}
              disabled={!loaded || busy}
              placeholder="250000"
              className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}
        {awardBasis === 'estimated' && (
          <span className="text-[11px] text-amber-700">Shown to customers as &ldquo;our estimate&rdquo;</span>
        )}
        {awardBasis === 'not_stated' && (
          <span className="text-[11px] text-gray-500">Shown to customers as &ldquo;Award size not stated&rdquo;</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty || !loaded}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : pushed && dirty ? 'Save — broadcasts to tenant cards' : 'Save'}
        </button>
        {!awardBasis && (
          <span className="text-[11px] text-rose-600">Award size undecided — push will be blocked.</span>
        )}
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
