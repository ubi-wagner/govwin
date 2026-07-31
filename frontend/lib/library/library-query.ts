/**
 * The library-browser filter state → the GET /library/atoms query string (P3.2).
 * Pure so the URL construction is unit-testable independent of the React UI.
 */
export interface LibraryFilters {
  grain?: string;
  kind?: string;
  form?: string;
  context?: string;
  collection?: string;
  vehicle?: string;
  q?: string;
  page?: number;
}

/** Build the query string, omitting empty/blank filters (and page 1). */
export function buildLibraryQuery(f: LibraryFilters): string {
  const p = new URLSearchParams();
  const put = (k: string, v?: string) => { const s = (v ?? '').trim(); if (s) p.set(k, s); };
  put('grain', f.grain);
  put('kind', f.kind);
  put('form', f.form);
  put('context', f.context);
  put('collection', f.collection);
  put('vehicle', f.vehicle);
  put('q', f.q);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  return p.toString();
}
