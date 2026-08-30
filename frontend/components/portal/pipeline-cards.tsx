'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import PurchaseModal from './purchase-modal';

/**
 * What this opportunity pays, said the way we came by it (mig 241).
 *
 * Three renderings from two fields, and the middle one is why the basis exists: an RFP admin often
 * knows what a Phase I runs when the topic is silent, and that estimate is worth showing — but
 * showing it identically to a figure read from the document would be exactly the fabrication
 * docs/INGEST_PROVENANCE.md forbids. Same rule as the "dates estimated" chip beside it.
 *
 *   stated      →  "$250,000"
 *   estimated   →  "$250,000 · our estimate"
 *   not_stated  →  "Award size not stated"
 *
 * Returns null when nobody has decided — which release now refuses, so it should only be reachable
 * on cards published before the gate existed.
 */
function awardLine(card: Record<string, unknown>): { text: string; estimated: boolean } | null {
  const basis = card.fieldBasis && typeof card.fieldBasis === 'object' && !Array.isArray(card.fieldBasis)
    ? (card.fieldBasis as Record<string, unknown>).award_amount
    : undefined;
  const amount = typeof card.awardAmount === 'number' && Number.isFinite(card.awardAmount)
    ? (card.awardAmount as number)
    : null;
  if (basis === 'not_stated') return { text: 'Award size not stated', estimated: false };
  if (amount === null) return null;
  const money = `$${amount.toLocaleString()}`;
  if (basis === 'estimated') return { text: `${money} · our estimate`, estimated: true };
  return { text: money, estimated: false };
}

/**
 * How much work the solicitation asks for, in one line — the SIZE-OF-JOB signal.
 *
 * `complianceSummary` (page limits · submission format · volume count) is written onto every card
 * by the bridge the moment the RFP team fills in a compliance matrix, was populated on 42 of the 63
 * cards on this box, and until now was read by NO code at all — the same "carried but invisible"
 * shape as the curated record. It is the difference between a seven-page Phase I abstract and a
 * two-volume Direct-to-Phase-II package, which is the single fact most likely to change whether a
 * small business pursues an opportunity at all.
 *
 * Returns null when the RFP team has not curated the matrix yet, so an uncurated card says nothing
 * rather than saying "0 volumes" — absent is not zero.
 */
function effortLine(card: Record<string, unknown>): string | null {
  const cs = card.complianceSummary;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  const c = cs as Record<string, unknown>;
  const n = (k: string): number | null => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? (c[k] as number) : null);
  const parts: string[] = [];
  const tech = n('pageLimitTechnical');
  const cost = n('pageLimitCost');
  if (tech !== null) parts.push(`${tech}-page technical`);
  if (cost !== null) parts.push(`${cost}-page cost`);
  const vols = n('volumeCount');
  if (vols !== null && vols > 0) parts.push(`${vols} volume${vols === 1 ? '' : 's'}`);
  const fmt = typeof c.submissionFormat === 'string' ? c.submissionFormat.trim() : '';
  if (fmt) parts.push(fmt);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * What the RFP team found in the solicitation, on the customer's card.
 *
 * Every field here already rode the bridge and was already matched by both scorers; none of it
 * had ever reached a screen. A ranking a customer cannot see the reason for is a number they have
 * to trust rather than read.
 *
 * The rule for the highlights, which is what makes this worth showing at all: an excerpt is only
 * rendered when it EXISTS. A highlight carried as a bare page anchor would render as an empty row
 * with a page number, which is worse than omitting it — it advertises that something was found and
 * then declines to say what.
 */
function CuratedRecord({ card }: { card: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!card) return null;

  const text = (k: string): string | null => {
    const v = card[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const list = (k: string): string[] =>
    Array.isArray(card[k]) ? (card[k] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

  const summary = text('spotlightSummary');
  const focus = list('techFocusAreas');
  const volumes = list('volumes');
  const items = list('requiredItems');
  const docs = Array.isArray(card.documents) ? (card.documents as Array<Record<string, unknown>>) : [];
  const highlights = (Array.isArray(card.highlights) ? (card.highlights as Array<Record<string, unknown>>) : [])
    .filter((h) => typeof h.text === 'string' && (h.text as string).trim() !== '');
  const estimated = card.datesEstimated === true;
  const effort = effortLine(card);
  const award = awardLine(card);
  const ready = card.provisionReady === true;

  if (!summary && focus.length === 0 && highlights.length === 0 && docs.length === 0 && volumes.length === 0
      && !effort && !ready && !award)
    return null;

  return (
    <div className="mt-2.5 border-t border-gray-100 pt-2.5">
      {summary && <p className="text-[12px] leading-relaxed text-gray-600">{summary}</p>}

      {(focus.length > 0 || estimated) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {focus.slice(0, 4).map((f) => (
            <span key={f} className="rounded bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">{f}</span>
          ))}
          {focus.length > 4 && <span className="text-[10px] text-gray-400">+{focus.length - 4}</span>}
          {/* Provenance, not decoration: an inferred close date moves the timeline score exactly
              like a real one, so the customer is told which kind they are looking at. */}
          {estimated && (
            <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700"
                  title="These dates were inferred during ingest, not read from the solicitation.">
              dates estimated
            </span>
          )}
        </div>
      )}

      {/*
        THE BUY DECISION, ON THE CARD.

        Two facts the bridge has always carried and nothing ever rendered. Both bear on the same
        question — whether to spend $1,999 and several weeks on this opportunity — and both were
        answerable only by buying and finding out.

        `provisionReady` mirrors the master's build_complete flag (mig 182); lib/provisioning/
        complete.ts describes releasing a build-out as the moment "the provisionReady badge flips
        on", and there was no badge. Its absence is NOT a negative claim: an opportunity nobody has
        built out yet is normal, and saying "not ready" about it would be a verdict we have not
        reached. So the badge appears when true and nothing appears when it is not.
      */}
      {(effort || ready || award) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {award && (
            <span className={`text-[11px] font-medium ${award.estimated ? 'text-amber-700' : 'text-gray-700'}`}
                  title={award.estimated
                    ? 'Our RFP team\'s estimate — the solicitation does not state an award size.'
                    : 'Read from the solicitation.'}>
              {award.text}
            </span>
          )}
          {effort && (
            <span className="text-[11px] text-gray-600" title="What the solicitation requires, from our compliance matrix">
              📄 {effort}
            </span>
          )}
          {ready && (
            <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                  title="Our RFP team has finished the build-out for this opportunity — the compliance matrix, volumes and section molds are ready, so a workspace opens fully set up.">
              Ready to build
            </span>
          )}
        </div>
      )}

      {(highlights.length > 0 || docs.length > 0 || volumes.length > 0) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-2 text-[11px] font-medium text-blue-700 hover:underline"
        >
          {open ? 'Hide' : 'What our analysts found'}
          {highlights.length > 0 && ` · ${highlights.length} passage${highlights.length === 1 ? '' : 's'}`}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-2.5">
          {highlights.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Highlighted by our analysts</p>
              <ul className="mt-1 space-y-1.5">
                {highlights.slice(0, 8).map((h, i) => (
                  <li key={i} className="border-l-2 border-blue-200 pl-2">
                    <p className="text-[11.5px] leading-relaxed text-gray-700">“{String(h.text).slice(0, 320)}”</p>
                    {typeof h.page === 'number' && <p className="text-[10px] text-gray-400">page {h.page}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {volumes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">What you would have to write</p>
              <p className="mt-1 text-[11.5px] text-gray-600">{volumes.join(' · ')}</p>
              {items.length > 0 && (
                <p className="mt-0.5 text-[11px] text-gray-500">{items.length} required item{items.length === 1 ? '' : 's'}</p>
              )}
            </div>
          )}

          {docs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Published documents</p>
              <ul className="mt-1 space-y-0.5">
                {docs.slice(0, 6).map((d, i) => (
                  <li key={i} className="text-[11.5px] text-gray-600">
                    {String(d.filename ?? 'document')}
                    {typeof d.pageCount === 'number' && <span className="text-gray-400"> · {d.pageCount} pages</span>}
                  </li>
                ))}
              </ul>
              {/* The manifest lists what the organization published. Pin is what makes it yours. */}
              <p className="mt-1 text-[10px] text-gray-400">Pin this opportunity to copy them into your own library.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Card {
  id: string;
  opportunityId: string;
  card: Record<string, unknown> | null;
  bridgeVersion: number;
  lifecycleStatus: string;
  submissionStage: string;
  pursuitStatus: string;
  docsCopied: boolean;
  docsUpdateAvailable: boolean;
  /** Per-bucket ranking array — one card, N scoring lenses (mig 096 · bucket id·name·summary·score). */
  rankings?: { bucketId: string; name: string; summary: string | null; score: number }[];
  /** Latest opportunity_analyst assessment (its output.text is a match analysis); null until the agent runs. */
  fitOutput?: Record<string, unknown> | null;
}

/** Days until `dateStr` (negative if past); null when unparseable. */
const daysUntil = (dateStr: string | null): number | null => {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86_400_000) : null;
};
/** Urgency chip for the close date: red ≤3d, amber ≤14d, else gray; "Closed" once past. */
function closeChip(dateStr: string | null): { label: string; cls: string } | null {
  const d = daysUntil(dateStr);
  if (d === null) return null;
  if (d < 0) return { label: 'Closed', cls: 'bg-gray-100 text-gray-500' };
  if (d === 0) return { label: 'Closes today', cls: 'bg-rose-100 text-rose-700' };
  const label = `Closes in ${d}d`;
  if (d <= 3) return { label, cls: 'bg-rose-100 text-rose-700' };
  if (d <= 14) return { label, cls: 'bg-amber-100 text-amber-700' };
  return { label, cls: 'bg-gray-100 text-gray-500' };
}
/** Concise AI fit level from the analyst's output text; null when absent. `invoke_agent` nests the
 *  string at output.result.text (the queue stores the whole invoke result), so read that first and
 *  fall back to a flat output.text — matching the analyst's summarize_result "…match" buckets. */
function fitFromOutput(out: unknown): { label: string; cls: string; full: string } | null {
  const o = out && typeof out === 'object' ? (out as { text?: unknown; result?: { text?: unknown } }) : null;
  const raw = typeof o?.result?.text === 'string' ? o.result.text : typeof o?.text === 'string' ? o.text : '';
  const text = raw.trim();
  if (!text) return null;
  if (/strong match/i.test(text)) return { label: 'Strong fit', cls: 'bg-emerald-100 text-emerald-700', full: text };
  if (/moderate match/i.test(text)) return { label: 'Moderate fit', cls: 'bg-blue-100 text-blue-700', full: text };
  if (/weak match/i.test(text)) return { label: 'Weak fit', cls: 'bg-amber-100 text-amber-700', full: text };
  if (/no match/i.test(text)) return { label: 'Low fit', cls: 'bg-gray-100 text-gray-500', full: text };
  return { label: 'AI fit noted', cls: 'bg-indigo-100 text-indigo-700', full: text };
}

type SortKey = 'pinned' | 'close' | 'agency' | 'title';
const SORT_LABELS: Record<SortKey, string> = { pinned: 'Best match', close: 'Close date', agency: 'Agency', title: 'Title' };

const str = (c: Card, k: string) => (c.card && typeof c.card[k] === 'string' ? (c.card[k] as string) : null);

/** The card's score in one bucket (-1 when that bucket hasn't scored it → it sinks to the bottom). */
const bucketScore = (c: Card, bucketId: string): number => c.rankings?.find((r) => r.bucketId === bucketId)?.score ?? -1;

/**
 * Pinned cards always float to the top; then by the chosen key. `bucket:<id>` re-ranks the ONE
 * list by that lens' score — "rank per bucket serially by OPP, parallel across buckets" (the same
 * card carries every bucket's score in `rankings`, so switching lens is a client re-sort, no refetch).
 */
function sortCards(cards: Card[], sortBy: string): Card[] {
  const bucketId = sortBy.startsWith('bucket:') ? sortBy.slice(7) : null;
  return [...cards].sort((a, b) => {
    if (a.docsCopied !== b.docsCopied) return a.docsCopied ? -1 : 1;
    if (bucketId) return bucketScore(b, bucketId) - bucketScore(a, bucketId);
    if (sortBy === 'close') {
      const da = str(a, 'closeDate'); const db = str(b, 'closeDate');
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return new Date(da).getTime() - new Date(db).getTime();
    }
    if (sortBy === 'agency') return (str(a, 'agency') ?? '').localeCompare(str(b, 'agency') ?? '');
    if (sortBy === 'title') return (str(a, 'title') ?? '').localeCompare(str(b, 'title') ?? '');
    return 0;
  });
}

const STAGE_BADGE: Record<string, { label: string; cls: string }> = {
  nofo: { label: 'NOFO', cls: 'bg-slate-100 text-slate-600' },
  pre_release: { label: 'Pre-Release', cls: 'bg-indigo-100 text-indigo-700' },
  updated: { label: 'Updated', cls: 'bg-blue-100 text-blue-700' },
  closed: { label: 'Closed', cls: 'bg-amber-100 text-amber-700' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
};

export default function PipelineCards({ tenantSlug, role }: { tenantSlug: string; role: Role }) {
  // The `role` prop was received and never read (the only other `role` in this file was the HTML
  // role="alert"). /cards admits anyone passing canManageBuckets — which explicitly INCLUDES a
  // tenant_user holding the designee grant (lib/db.ts, settable from the Team page) — but both
  // buying paths are floored at tenant_admin server-side:
  //   • POST …/purchase            → gate(tenantSlug, 'tenant_admin') → 403 "Insufficient permissions"
  //   • /portal/<slug>/portals     → tenant_admin-gated page
  // So the designee saw a primary emerald "Purchase" CTA that could only ever 403. Read the prop.
  const canBuy = hasRoleAtLeast(role, 'tenant_admin');
  // Deep link from a notification (lib/event-labels.ts). Opportunity notifications used to point at
  // /spotlights/<id>, a retired stub that redirects to /cards and DROPS the id — so the user landed
  // on the generic list, not the card they were told about. They point here now; honour the id.
  const [focusOpp, setFocusOpp] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [includePassed, setIncludePassed] = useState(false);
  const [purchaseCard, setPurchaseCard] = useState<Card | null>(null);
  const [buckets, setBuckets] = useState<{ id: string; name: string }[]>([]);
  const [sortBy, setSortBy] = useState<string>('pinned');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (includeClosed) qs.set('includeClosed', 'true');
      if (includePassed) qs.set('includePassed', 'true');
      const res = await fetch(`/api/portal/${tenantSlug}/cards${qs.toString() ? `?${qs}` : ''}`);
      if (res.ok) { const d = (await res.json()).data; setCards(d?.cards ?? []); setBuckets(d?.buckets ?? []); setErr(null); }
      else setErr('Could not load your opportunity cards.');
    } catch { setErr('Could not load your opportunity cards.'); } finally { setLoading(false); }
  }, [tenantSlug, includeClosed, includePassed]);

  useEffect(() => { load(); }, [load]);

  // Read ?opp= once, then scroll it into view when the cards have rendered. Highlight persists so
  // the user can see WHICH card the notification meant even after the scroll settles.
  useEffect(() => {
    const opp = new URLSearchParams(window.location.search).get('opp');
    if (opp) setFocusOpp(opp);
  }, []);
  useEffect(() => {
    if (!focusOpp || cards.length === 0) return;
    document.getElementById(`opp-${focusOpp}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusOpp, cards.length]);

  const act = useCallback(async (opp: string, method: 'POST' | 'DELETE', qs = '') => {
    setBusy(opp); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/cards/${opp}/documents${qs}`, { method });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'That action could not be completed — please try again.');
        return;
      }
      await load();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(null); }
  }, [tenantSlug, load]);

  // Set pursuit intent — 'passed' = dismiss (drops out of the default feed), 'unreviewed' = restore.
  const setPursuit = useCallback(async (opp: string, status: string) => {
    setBusy(opp); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/cards/${opp}/pursuit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || 'That could not be completed — please try again.'); return; }
      await load();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(null); }
  }, [tenantSlug, load]);

  // An opportunity whose close date has passed is closed to the customer whatever the admin
  // lifecycle says — nobody has flipped lifecycle_status, because that is a manual admin
  // transition with no date sweeper behind it. So "Include closed" has to honour the date too,
  // using the same predicate the chip renders from; otherwise the filter hides admin-closed
  // cards while leaving expired ones on screen, which reads as simply broken.
  // The card a notification deep-linked to is always kept: telling someone to look at an
  // opportunity and then hiding it because it just closed is worse than showing it closed.
  const visible = useMemo(
    () => (includeClosed
      ? cards
      : cards.filter((c) => c.opportunityId === focusOpp || (daysUntil(str(c, 'closeDate')) ?? 0) >= 0)),
    [cards, includeClosed, focusOpp],
  );
  const sorted = useMemo(() => sortCards(visible, sortBy), [visible, sortBy]);
  const selectedBucketId = sortBy.startsWith('bucket:') ? sortBy.slice(7) : null;
  const selectedBucketName = selectedBucketId ? buckets.find((b) => b.id === selectedBucketId)?.name : null;

  return (
    <div>
      {err && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{err}</div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4 text-sm">
        <label className="flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed
        </label>
        <label className="flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={includePassed} onChange={(e) => setIncludePassed(e.target.checked)} /> Show passed
        </label>
        <button onClick={load} className="text-blue-600 hover:underline">Refresh</button>
        <span className="text-gray-400">· {visible.length} cards</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          aria-label="Sort opportunities"
          className="ml-auto text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-600"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>)}
          {buckets.length > 0 && (
            <optgroup label="Rank by bucket">
              {buckets.map((b) => <option key={b.id} value={`bucket:${b.id}`}>Bucket: {b.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>}
      {!loading && visible.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No opportunities yet.</p>
          <p className="text-sm mt-1">Cards appear here as the RFP team releases opportunities.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((c) => (
          <div
            key={c.id}
            id={`opp-${c.opportunityId}`}
            className={`border rounded-xl p-4 bg-white scroll-mt-24 ${
              focusOpp === c.opportunityId
                ? 'border-amber-400 ring-2 ring-amber-200'
                : c.docsCopied ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800">{str(c, 'title') ?? 'Untitled opportunity'}</h3>
              {STAGE_BADGE[c.submissionStage] && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${STAGE_BADGE[c.submissionStage].cls}`}>{STAGE_BADGE[c.submissionStage].label}</span>
              )}
            </div>
            <p className="text-xs text-gray-500">{str(c, 'agency') ?? '—'}{str(c, 'programType') ? ` · ${str(c, 'programType')}` : ''}</p>
            {selectedBucketId && (
              <div className="mt-1.5">
                <span className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums" title={`Score in the “${selectedBucketName}” bucket`}>
                  {selectedBucketName}: {(() => { const s = bucketScore(c, selectedBucketId); return s < 0 ? '—' : Math.round(s); })()}
                </span>
              </div>
            )}
            {(() => {
              const chip = closeChip(str(c, 'closeDate'));
              const fit = fitFromOutput(c.fitOutput);
              if (!chip && !fit) return null;
              return (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {chip && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${chip.cls}`} title={str(c, 'closeDate') ? `Closes ${new Date(str(c, 'closeDate') as string).toLocaleDateString()}` : undefined}>{chip.label}</span>}
                  {fit && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${fit.cls}`} title={fit.full}>✨ {fit.label}</span>}
                </div>
              );
            })()}
            {Array.isArray(c.rankings) && c.rankings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1" title="Ranked by your spotlight buckets">
                {c.rankings.slice(0, 4).map((r) => (
                  <span key={r.bucketId} title={r.summary ?? r.name}
                    className="inline-flex items-center gap-1 rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                    <span className="font-medium text-gray-700">{r.name}</span>
                    <span className="tabular-nums text-gray-500">{Math.round(r.score)}</span>
                  </span>
                ))}
                {c.rankings.length > 4 && <span className="self-center text-[10px] text-gray-400">+{c.rankings.length - 4}</span>}
              </div>
            )}
            {/*
              WHAT THE CURATOR PRODUCED — until now, carried and invisible.

              The bridge has been putting the summary, the technology focus, the volume structure,
              the document manifest and the admin's highlights on every card, and both scorers have
              been matching them. The customer's card showed a title, an agency and a score. So the
              ranking was explainable only to the ranker: a lens surfaced an opportunity and the
              person reading it had no way to see WHY, or what the analyst had already found in a
              330-page solicitation on their behalf.

              Deliberately collapsed. A card in a list is scanned, not read — the summary and the
              first technology areas sit inline, and the analyst's marked passages open on demand.
            */}
            <CuratedRecord card={c.card as Record<string, unknown>} />
            {c.docsUpdateAvailable && (
              <div className="mt-2 flex items-center justify-between rounded bg-amber-50 border border-amber-200 px-2 py-1">
                <span className="text-[11px] text-amber-700">Update available</span>
                <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'POST', '?action=resync')} className="text-[11px] font-medium text-amber-800 hover:underline">Resync</button>
              </div>
            )}
            {/*
              THE VERDICT, THEN THE TRANSFER — two rows, in that order, because they are two
              different commitments (mig 240).

              Row 1 is the thumb: an opinion, one UPDATE, no I/O, cannot fail. It is meant to be
              pressed liberally while scanning a feed, which is the whole reason it must not drag a
              document copy behind it.

              Row 2 appears only ONCE the customer has said yes, and it is the one that moves bytes.
              "View Solicitation" names what the customer gets rather than what the system does, and
              it navigates into the reading view — the copy is plumbing underneath a destination, not
              a chore between them and the content.

              Nothing here removes anything. A thumbs-down sorts the card last and drops it from the
              default view; the row stays in the mirror, keeps receiving every republish, and keeps
              any copy already made. "Release my copy" is a deliberate, separate control.
            */}
            <div className="mt-3 flex items-center gap-1.5">
              <button
                disabled={busy === c.opportunityId}
                aria-pressed={c.pursuitStatus === 'monitoring' || c.pursuitStatus === 'pursuing'}
                onClick={() => setPursuit(c.opportunityId, c.pursuitStatus === 'monitoring' ? 'unreviewed' : 'monitoring')}
                title={c.pursuitStatus === 'monitoring'
                  ? 'Interested — ranks similar opportunities higher and lets us nudge you before it closes. Click to undo.'
                  : 'Interested — ranks similar opportunities higher and lets us nudge you before it closes.'}
                className={`text-xs rounded px-2.5 py-1 border font-medium disabled:opacity-50 ${
                  c.pursuitStatus === 'monitoring' || c.pursuitStatus === 'pursuing'
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}
              >
                👍{c.pursuitStatus === 'pursuing' ? ' Pursuing' : c.pursuitStatus === 'monitoring' ? ' Interested' : ''}
              </button>
              <button
                disabled={busy === c.opportunityId}
                aria-pressed={c.pursuitStatus === 'passed'}
                onClick={() => setPursuit(c.opportunityId, c.pursuitStatus === 'passed' ? 'unreviewed' : 'passed')}
                title={c.pursuitStatus === 'passed'
                  ? 'Not a fit — sorted last and hidden from your feed. It stays in your list and keeps updating. Click to undo.'
                  : 'Not a fit — sorts it last, hides it from your feed, and teaches your ranking. Nothing is deleted.'}
                className={`text-xs rounded px-2.5 py-1 border font-medium disabled:opacity-50 ${
                  c.pursuitStatus === 'passed'
                    ? 'bg-gray-700 border-gray-700 text-white'
                    : 'bg-white border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300'}`}
              >
                👎{c.pursuitStatus === 'passed' ? ' Passed' : ''}
              </button>
              {canBuy ? (
                <a href={`/portal/${tenantSlug}/portals?opp=${c.opportunityId}`} className="text-xs text-gray-600 hover:text-gray-900 ml-auto">Build →</a>
              ) : (
                <span className="text-xs text-gray-400 ml-auto" title="Only a company admin can purchase a proposal portal. Mark what you want and ask yours to buy it.">Admin buys</span>
              )}
            </div>

            {/* Revealed by the up-vote: the transfer, and the money. Purchase is no longer GATED on a
                verdict — the route never required one — but it belongs beside the opportunities the
                customer has actually said yes to rather than on all sixty. */}
            {(c.pursuitStatus === 'monitoring' || c.pursuitStatus === 'pursuing') && (
              <div className="mt-1.5 flex items-center gap-1.5">
                {c.docsCopied ? (
                  <>
                    <a href={`/portal/${tenantSlug}/cards/${c.opportunityId}/solicitation`}
                       className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1">
                      View Solicitation
                    </a>
                    <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'DELETE')}
                            title="Remove your local copy of the documents. Your rating and the opportunity stay."
                            className="text-xs text-gray-400 hover:text-gray-700">Release copy</button>
                  </>
                ) : (
                  <button
                    disabled={busy === c.opportunityId}
                    onClick={() => act(c.opportunityId, 'POST')}
                    title="Copy the solicitation documents into your library so you can read them with our analysts' highlights."
                    className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1 disabled:opacity-50"
                  >
                    {busy === c.opportunityId ? 'Fetching…' : 'View Solicitation'}
                  </button>
                )}
                {canBuy && (
                  <button onClick={() => setPurchaseCard(c)} className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1">Purchase</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {purchaseCard && (
        <PurchaseModal
          tenantSlug={tenantSlug}
          opportunityId={purchaseCard.opportunityId}
          title={str(purchaseCard, 'title') ?? 'Untitled opportunity'}
          card={purchaseCard.card}
          onClose={() => setPurchaseCard(null)}
          onPurchased={() => {
            const opp = purchaseCard.opportunityId;
            setPurchaseCard(null);
            window.location.assign(`/portal/${tenantSlug}/portals?opp=${opp}`);
          }}
        />
      )}
    </div>
  );
}
