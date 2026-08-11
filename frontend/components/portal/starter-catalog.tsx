'use client';

/**
 * StarterCatalog (P5.1) — surfaces the dogfooded system-starter catalog to a tenant,
 * front-and-center when the library is EMPTY, as a compact add-anytime affordance
 * otherwise (docs/LIBRARY_AND_VAULTS_DESIGN.md §4).
 *
 *   • Reads the tenant's foundation count (GET library/atoms?grain=foundation) and
 *     the shared catalog (GET library/system-templates).
 *   • "Add starter set" → POST library/system-templates { all: true } — bulk
 *     copy-on-use into MY library (idempotent; skips any already held).
 *
 * The whole set lands as the tenant's own editable copies with derived_from lineage.
 */
import { useState, useEffect, useCallback } from 'react';

interface SystemTemplate { id: string; title: string | null; form: string | null; context: string | null }

export function StarterCatalog({ tenantSlug }: { tenantSlug: string }) {
  const [foundations, setFoundations] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<SystemTemplate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/portal/${tenantSlug}/library/atoms?grain=foundation&limit=1`).then((r) => r.json()).catch(() => null),
      fetch(`/api/portal/${tenantSlug}/library/system-templates`).then((r) => r.json()).catch(() => null),
    ]).then(([atoms, tpl]) => {
      if (cancelled) return;
      setFoundations(typeof atoms?.data?.total === 'number' ? atoms.data.total : 0);
      setCatalog(Array.isArray(tpl?.data) ? tpl.data : []);
    });
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const addAll = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/library/system-templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not add the starter set.'); return; }
      // Reload so the browse surface reflects the newly-copied foundations.
      window.location.reload();
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [tenantSlug]);

  // Nothing to render until both counts are known (avoids a flash).
  if (foundations === null || catalog === null) return null;
  // No system catalog seeded for this tenant: the prominent "add starter set" CTA would vanish and
  // leave an EMPTY library as a silent blank. Give it a first-step upload CTA instead. (A library
  // that already has content needs no CTA here.)
  if (catalog.length === 0) {
    if (foundations > 0) return null;
    return (
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">Your library is empty</p>
        <p className="text-xs text-blue-700/90 mt-1 mb-3">Upload a past proposal or company documents — we shred them into reusable, taggable atoms your drafts and AI pull from.</p>
        <a href={`/portal/${tenantSlug}/atoms?tab=atomize`} className="inline-block text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-2">Upload your first documents →</a>
      </div>
    );
  }

  // Compact add-anytime affordance once the library already holds foundations.
  if (foundations > 0) {
    return (
      <div className="mb-4 flex items-center justify-end">
        <button
          onClick={addAll} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          title="Copy the full starter set into your library (skips any you already have)"
        >
          <span aria-hidden>＋</span>{busy ? 'Adding…' : `Add starter set (${catalog.length})`}
        </button>
      </div>
    );
  }

  // Empty library → the prominent onboarding offer.
  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">Start with the proposal starter set</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Your library is empty. Add {catalog.length} ready-made foundation templates — capability statement,
            one-pager, SBIR/STTR technical &amp; cost volumes, DoW CSO brief, commercialization deck and more. Each
            copies in as your own editable canvas, pre-decomposed into reusable section/group/atom pieces.
          </p>
        </div>
        <button
          onClick={addAll} disabled={busy}
          className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Adding…' : `Add all ${catalog.length}`}
        </button>
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {catalog.map((t) => (
          <li key={t.id} className="rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs text-gray-600">
            {t.title || 'Untitled'}
            {t.form && <span className="ml-1 text-gray-400">{t.form}</span>}
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <p className="mt-2 text-[11px] text-gray-400">
        Prefer to pick? Use <strong>Create canvas → Start from a template</strong> to add them one at a time.
      </p>
    </div>
  );
}
