'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
// The scorer's OWN weight table, not a copy of it. `lib/bucket-scoring` is a zero-import leaf
// precisely so a client component can import it without pulling `node:async_hooks` or a database
// into the browser bundle — and so the percentage a customer reads here is computed by the same
// code that computes their score. A re-typed number would be a confident lie about their own lens.
import { describeComposition, type BucketCriteria, type SignalCoverage } from '@/lib/bucket-scoring';

interface Bucket { id: string; name: string; description: string | null; criteria: Record<string, unknown> }
interface RankedRow { opportunityId: string; score: number; factors: Record<string, number>; card: Record<string, unknown> | null; isPinned: boolean }

export default function SpotlightBuckets({ tenantSlug, canEdit }: { tenantSlug: string; canEdit: boolean }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [cap, setCap] = useState<number | null>(null);
  /** Per-signal reach across this tenant's own cards, in both scopes the ranker uses. */
  const [coverage, setCoverage] = useState<{ open: SignalCoverage; all: SignalCoverage } | null>(null);
  const [ranked, setRanked] = useState<RankedRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reranking, setReranking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  // Tracks which bucket the pipeline poll should still write to, so switching
  // buckets (or deleting the open one) cancels stale in-flight refreshes.
  const activeRef = useRef<string | null>(null);
  // create form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [agencies, setAgencies] = useState('');
  const [programTypes, setProgramTypes] = useState('');
  const [naics, setNaics] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  /**
   * What this lens will actually score on, computed live from the form.
   *
   * A bucket used to be four boxes with no feedback, so a customer could name three agencies and
   * never learn that keywords were carrying 67% of the result. `describeComposition` reads the same
   * weight table `scoreCard` does, so this cannot drift from the score it describes.
   *
   * With `coverage` it also says how many of THIS tenant's opportunities each criterion can reach.
   * The share is what the signal is worth if the data is there; the coverage is whether it is. A
   * NAICS criterion shown as "25%" against a feed where no opportunity carries a NAICS code is a
   * confident description of a ranking that is really keywords and closing date at 100%.
   */
  const composition = useMemo(() => {
    const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const criteria: BucketCriteria = {
      keywords: split(keywords), agencies: split(agencies),
      programTypes: split(programTypes), naics: split(naics), useTimeline: true,
    };
    // The scope the ranker will actually use — `rankBucket` drops closed cards unless the bucket
    // asks for them, so the count shown must follow the same checkbox.
    return describeComposition(criteria, includeClosed ? coverage?.all : coverage?.open);
  }, [keywords, agencies, programTypes, naics, includeClosed, coverage]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets`);
      if (res.ok) {
        const d = (await res.json()).data;
        setBuckets(d?.buckets ?? []);
        if (typeof d?.cap === 'number') setCap(d.cap);
        // Absent (an older build, a failed read) leaves coverage null, which renders as no claim —
        // never as "reaches 0 opportunities", which would be a finding we did not make.
        setCoverage(d?.coverage ?? null);
      } else setErr('Could not load your buckets.');
    } catch { setErr('Could not load your buckets.'); } finally { setLoading(false); }
  }, [tenantSlug]);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    const criteria = {
      keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
      agencies: agencies.split(',').map((s) => s.trim()).filter(Boolean),
      programTypes: programTypes.split(',').map((s) => s.trim()).filter(Boolean),
      naics: naics.split(',').map((s) => s.trim()).filter(Boolean),
      includeClosed,
      useTimeline: true,
    };
    setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, criteria }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not create the bucket.'); return; }
      setName(''); setKeywords(''); setAgencies(''); setProgramTypes(''); setNaics(''); setIncludeClosed(false);
      await load(); router.refresh(); // refresh the console's bucket count
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [tenantSlug, name, keywords, agencies, programTypes, naics, includeClosed, load, router]);

  const resetForm = useCallback(() => {
    setEditingId(null); setName(''); setKeywords(''); setAgencies(''); setProgramTypes(''); setNaics(''); setIncludeClosed(false); setErr(null);
    setPrefilled(false);
  }, []);

  /**
   * Start from the company profile.
   *
   * `tenant_profiles` holds `naics_codes`, `keywords`, `agency_priorities` and `set_aside_types` —
   * a column-for-column match for BucketCriteria, collected on the profile page, read by the
   * dashboard and the agent tools, and until now not read by bucket authoring. The customer was
   * being asked to recall what they had already typed.
   *
   * It FILLS rather than replaces: a field the customer has already touched is left alone, because
   * a convenience that discards typing is not one. Empty profile fields are simply skipped, so a
   * thin profile yields a partial prefill rather than blanking the form.
   */
  const prefillFromProfile = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/profile`);
      if (!res.ok) { setErr('Could not read your company profile.'); return; }
      // { data: { tenant, profile } } — the profile is NESTED, and its columns arrive camelCased
      // by lib/db.ts's postgres.toCamel transform (naics_codes → naicsCodes).
      const p = ((await res.json()).data?.profile ?? {}) as Record<string, unknown>;
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
      // The profile splits agencies two ways; a bucket has one field, so both feed it, de-duped.
      const sources = {
        keywords: list(p.keywords),
        naics: list(p.naicsCodes),
        agencies: [...new Set([...list(p.agencyPriorities), ...list(p.targetAgencies)])],
      };
      // A profile ROW usually exists with every array empty — one of the two on this box is exactly
      // that. So "is there anything to copy", not "is there a row": a button that reports success
      // and changes nothing is the version that wastes someone's afternoon.
      if (!Object.values(sources).some((v) => v.length > 0)) {
        setErr('Your company profile has nothing to copy yet — fill it in on the Profile page and this will do the typing for you.');
        return;
      }
      const fill = (current: string, vals: string[], set: (s: string) => void) => {
        if (current.trim() === '' && vals.length) set(vals.join(', '));
      };
      fill(keywords, sources.keywords, setKeywords);
      fill(naics, sources.naics, setNaics);
      fill(agencies, sources.agencies, setAgencies);
      setPrefilled(true);
    } catch { setErr('Network error — please try again.'); }
  }, [tenantSlug, keywords, naics, agencies]);

  const startEdit = useCallback((b: Bucket) => {
    const c = (b.criteria ?? {}) as Record<string, unknown>;
    const arr = (k: string) => (Array.isArray(c[k]) ? (c[k] as unknown[]).filter((x): x is string => typeof x === 'string').join(', ') : '');
    setEditingId(b.id);
    setName(b.name);
    setKeywords(arr('keywords')); setAgencies(arr('agencies')); setProgramTypes(arr('programTypes')); setNaics(arr('naics'));
    setIncludeClosed(c.includeClosed === true);
    setErr(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !name.trim()) return;
    setBusy(true); setErr(null);
    // Full criteria set sent; the PATCH route MERGES so untouched keys (useTimeline/weights) survive.
    const criteria = {
      keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
      agencies: agencies.split(',').map((s) => s.trim()).filter(Boolean),
      programTypes: programTypes.split(',').map((s) => s.trim()).filter(Boolean),
      naics: naics.split(',').map((s) => s.trim()).filter(Boolean),
      includeClosed,
    };
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, criteria }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not save the bucket.'); return; }
      resetForm(); await load(); router.refresh();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [tenantSlug, editingId, name, keywords, agencies, programTypes, naics, includeClosed, load, router, resetForm]);

  const del = useCallback(async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not delete the bucket.'); return; }
      if (openId === id) { setRanked(null); setOpenId(null); activeRef.current = null; setReranking(false); }
      await load(); router.refresh();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [tenantSlug, openId, load, router]);

  const rank = useCallback(async (id: string) => {
    setBusy(true);
    setReranking(true);
    activeRef.current = id;
    setOpenId(id);
    const loadRanked = async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/buckets/${id}`);
        if (res.ok && activeRef.current === id) setRanked((await res.json()).data?.ranked ?? []);
      } catch { /* ignore */ }
    };
    try {
      // Ranking is async — the POST emits buckets.updated and the pipeline
      // OnBucketsUpdated workflow rescores tenant-side. Show what's there now,
      // then poll a few times to pick up the fresh scores as they land.
      await fetch(`/api/portal/${tenantSlug}/buckets/${id}?action=rank`, { method: 'POST' });
      await loadRanked();
    } catch { /* ignore */ } finally { setBusy(false); }
    for (const delay of [1500, 2000, 2500]) {
      await new Promise((r) => setTimeout(r, delay));
      if (activeRef.current !== id) return; // user switched buckets — abandon this poll
      await loadRanked();
    }
    if (activeRef.current === id) setReranking(false);
  }, [tenantSlug]);

  const str = (c: Record<string, unknown> | null, k: string) => (c && typeof c[k] === 'string' ? (c[k] as string) : null);
  const atCap = cap != null && buckets.length >= cap;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {canEdit && (
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold mb-2 flex items-center justify-between gap-2">
              <span>{editingId ? 'Edit bucket' : 'New bucket'}</span>
              {editingId
                ? <button onClick={resetForm} className="text-[11px] font-normal text-gray-400 hover:text-gray-600">Cancel</button>
                : cap != null && <span className={`text-[11px] font-normal ${atCap ? 'text-rose-600' : 'text-gray-400'}`}>{buckets.length}/{cap} used</span>}
            </h3>
            {atCap && !editingId && <p className="text-[11px] text-rose-600 mb-2">Bucket limit reached — delete one to add another.</p>}
            {/* Fills only the fields still empty, so it never discards typing. */}
            {!editingId && !atCap && (
              <button
                type="button"
                onClick={prefillFromProfile}
                className="w-full text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-1.5 mb-2"
              >
                Start from our company profile
              </button>
            )}
            {prefilled && (
              <p className="text-[11px] text-gray-500 mb-2">
                Filled from your profile — edit anything that does not belong in this lens.
              </p>
            )}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. AF Autonomy)" disabled={atCap && !editingId} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2 disabled:bg-gray-50 disabled:text-gray-400" />
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="keywords, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={agencies} onChange={(e) => setAgencies(e.target.value)} placeholder="agencies, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={programTypes} onChange={(e) => setProgramTypes(e.target.value)} placeholder="program types (SBIR, STTR)" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="NAICS codes, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              Include closed opportunities
            </label>
            {/* What this lens will score on. Computed from the SCORER's weight table, not a copy. */}
            <div className="border-t border-gray-100 pt-2 mb-2">
              {composition.entries.length === 0 ? (
                <p className="text-[11px] text-gray-400">
                  Add at least one keyword, agency, program type or NAICS code — a lens with no signals scores everything the same.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-gray-500">
                    Scores on {composition.entries.length} signal{composition.entries.length === 1 ? '' : 's'}:{' '}
                    {composition.entries.map((e, i) => (
                      <span key={e.key}>
                        {i > 0 && ', '}
                        <span className="text-gray-700">{e.label}</span> {e.share}%
                      </span>
                    ))}
                  </p>
                  {/*
                    MEASURED, NOT HEDGED.

                    This line used to read "a signal is skipped for any opportunity that does not
                    carry that field" — true whether the field is on every opportunity or on none,
                    and therefore impossible to act on. It now says which. The dead ones are named
                    first because they are the finding: a criterion at 25% of a score that reaches
                    nothing is worth more to know about than four that work.
                  */}
                  {(() => {
                    const measured = composition.entries.filter((e) => e.carried !== null && e.cards !== null);
                    const dead = measured.filter((e) => e.carried === 0 && (e.cards ?? 0) > 0);
                    if (measured.length === 0) {
                      // Coverage did not load. Fall back to the old hedge rather than inventing a number.
                      return composition.entries.some((e) => e.conditional && e.key !== 'timeline') ? (
                        <p className="text-[11px] text-gray-400 mt-1">
                          A signal is skipped for any opportunity that does not carry that field — it is not counted against it.
                        </p>
                      ) : null;
                    }
                    return (
                      <>
                        {dead.length > 0 && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 mt-1">
                            {/* Phrased around the OPPORTUNITIES, not the criterion, so the sentence
                                agrees whether one signal is dead or three and whatever their labels
                                are ("NAICS codes reaches" does not). */}
                            None of your {dead[0].cards} opportunities carry {dead.map((e) => e.label).join(' or ')} —
                            that {dead.reduce((s, e) => s + e.share, 0)}% is really being carried by the other signals.
                          </p>
                        )}
                        <p className="text-[11px] text-gray-400 mt-1">
                          Reach:{' '}
                          {measured.map((e, i) => (
                            <span key={e.key} className={e.carried === 0 ? 'text-amber-700' : undefined}>
                              {i > 0 && ' · '}
                              {e.label} {e.carried}/{e.cards}
                            </span>
                          ))}
                        </p>
                      </>
                    );
                  })()}
                </>
              )}
            </div>
            <button disabled={busy || !name.trim() || (atCap && !editingId)} onClick={editingId ? saveEdit : create} className="w-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">{editingId ? 'Save changes' : 'Create'}</button>
          </div>
        )}
        <div className="space-y-2">
          {buckets.map((b) => (
            <div key={b.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 truncate" title={b.name}>{b.name}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <button disabled={busy} onClick={() => rank(b.id)} className="text-xs font-medium text-blue-600 hover:underline">Rank →</button>
                  {canEdit && (
                    <button disabled={busy} onClick={() => startEdit(b)} title="Edit bucket" className={`text-xs ${editingId === b.id ? 'text-blue-600' : 'text-gray-400 hover:text-blue-600'}`}>✎</button>
                  )}
                  {canEdit && (
                    <button disabled={busy} onClick={() => del(b.id)} title="Delete bucket" className="text-xs text-gray-300 hover:text-rose-600">✕</button>
                  )}
                </span>
              </div>
            </div>
          ))}
          {err && <p className="text-xs text-rose-600">{err}</p>}
          {/* Since #189 no buckets are seeded on tenant creation, so this is a NEW CUSTOMER'S FIRST
              VIEW, not a rare edge — it has to say what a bucket is and what to do, rather than
              report an absence. It also states the fallback, because "no buckets" must not read as
              "your opportunities are missing": the pipeline is there, just ordered by recency. */}
          {buckets.length === 0 && !err && (
            loading
              ? <p className="text-xs text-gray-400">Loading buckets…</p>
              : (
                <div className="border border-dashed border-gray-300 rounded-lg p-4 bg-gray-50/60">
                  <p className="text-sm font-medium text-gray-700">No ranking lenses yet</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    A bucket is your own lens on the opportunity pipeline — name the keywords,
                    agencies or program types you care about, and every opportunity gets scored
                    against it as it arrives.
                  </p>
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                    Until you add one, your opportunities are listed newest first.
                    {canEdit ? ' Create your first lens above.' : ' An admin on your team can add one.'}
                  </p>
                </div>
              )
          )}
        </div>
      </div>

      <div className="lg:col-span-2">
        {reranking && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" aria-hidden />
            Rescore queued — scores refresh as the pipeline processes.
          </div>
        )}
        {ranked == null ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {reranking ? 'Ranking…' : 'Rank a bucket to see your pipeline ordered.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400 mb-2">{ranked.length} opportunities ranked{openId ? ` · bucket ${buckets.find((b) => b.id === openId)?.name}` : ''}</p>
            {ranked.map((r, i) => (
              <div key={r.opportunityId} className="border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-6">#{i + 1}</span>
                  <span className="flex-1 text-sm text-gray-800 truncate">{str(r.card, 'title') ?? r.opportunityId}</span>
                  {r.isPinned && <span className="text-[10px] text-blue-600">pinned</span>}
                  <span className="text-sm font-semibold text-gray-700 w-10 text-right">{r.score}</span>
                </div>
                {r.factors && Object.keys(r.factors).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 pl-9">
                    {Object.entries(r.factors).map(([k, v]) => (
                      <span key={k} className="text-[9px] bg-gray-100 text-gray-500 rounded px-1 py-0.5">{k} {v}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {ranked.length === 0 && <p className="text-sm text-gray-400">No cards to rank yet — releases populate the pipeline.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
