import Link from 'next/link';
import { listPages, listDocuments, DOC_TYPES, type PageSummary } from '@/lib/content-admin';
import { SEED_PAGE_KEYS } from '@/lib/page-content';
import { getPageViewCounts, pageKeyToPath } from '@/lib/analytics-admin';

export const dynamic = 'force-dynamic';

const JUNK_KEYS = new Set(['undefined', 'null', '']);

function shortActor(s: string | null): string {
  if (!s) return 'system';
  return s.includes('@') ? s.split('@')[0] : s;
}
function fmtWhen(d: Date | null): string {
  if (!d) return '';
  const t = new Date(d).getTime();
  if (!t || t < 1000) return ''; // epoch placeholder = never edited (using defaults)
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function SiteContentPage() {
  let pages: PageSummary[] = [];
  let docs: Awaited<ReturnType<typeof listDocuments>> = [];
  let viewCounts: Record<string, number> = {};
  try {
    pages = await listPages();
  } catch (e) {
    console.error('[admin/site] listPages failed:', e);
  }
  try {
    docs = await listDocuments();
  } catch (e) {
    console.error('[admin/site] listDocuments failed:', e);
  }
  try {
    viewCounts = await getPageViewCounts(30);
  } catch (e) {
    console.error('[admin/site] view counts failed:', e);
  }

  // Merge DB pages with the registry (so un-seeded pages are still listed), drop
  // junk keys, and split the site-chrome (header/footer) out from public pages.
  const seen = new Set(pages.map((p) => p.pageKey));
  const unseeded: PageSummary[] = SEED_PAGE_KEYS.filter((k) => !seen.has(k)).map((pageKey) => ({
    pageKey, contentType: 'page', activeVersion: null, hasDraft: false, lastUpdated: null, lastUpdatedBy: null,
  }));
  const all = [...pages, ...unseeded].filter((p) => p.pageKey && !JUNK_KEYS.has(p.pageKey));
  const chrome = all.find((p) => p.pageKey === 'site-chrome') ?? null;
  const publicPages = all
    .filter((p) => p.pageKey !== 'site-chrome')
    .sort((a, b) => a.pageKey.localeCompare(b.pageKey));

  const row = (p: PageSummary, label?: string) => {
    const views = viewCounts[pageKeyToPath(p.pageKey)];
    const when = fmtWhen(p.lastUpdated);
    return (
      <Link
        key={p.pageKey}
        href={`/admin/site/${encodeURIComponent(p.pageKey)}`}
        className="flex items-center justify-between gap-4 p-4 hover:bg-gray-50"
      >
        <div className="min-w-0">
          <div className="font-medium">{label ?? p.pageKey}</div>
          <div className="text-xs text-gray-500 truncate">
            {p.activeVersion ? `live v${p.activeVersion}` : 'using page defaults'}
            {when && ` · updated ${when} by ${shortActor(p.lastUpdatedBy)}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {views != null && (
            <span className="text-xs text-gray-400 tabular-nums" title="Page views, last 30 days">
              {views.toLocaleString()} views
            </span>
          )}
          {p.hasDraft && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">draft</span>}
          {!p.activeVersion && !p.hasDraft && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">defaults</span>
          )}
          <span className="text-gray-400">&rarr;</span>
        </div>
      </Link>
    );
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-2xl font-bold">Site Content</h1>
        <Link
          href="/admin/analytics"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border hover:bg-gray-50"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Analytics &rarr;
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Edit, preview, and publish website content. Every save is a versioned snapshot;
        publishing swaps the live version the public site reads.
      </p>

      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Pages</h2>
      <div className="border rounded-lg divide-y bg-white mb-8">
        {publicPages.length === 0 && <div className="p-4 text-sm text-gray-500">No pages yet.</div>}
        {publicPages.map((p) => row(p))}
      </div>

      {chrome && (
        <>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Site-wide</h2>
          <div className="border rounded-lg divide-y bg-white mb-8">
            {row(chrome, 'Header & Footer')}
          </div>
        </>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Documents</h2>
        <div className="flex flex-wrap gap-2">
          {DOC_TYPES.map((t) => (
            <Link key={t} href={`/admin/site/docs/${t}/new`} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">
              + {t.replace('_', ' ')}
            </Link>
          ))}
        </div>
      </div>
      <div className="border rounded-lg divide-y bg-white">
        {docs.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No documents yet. Use the buttons above to create one.</div>
        )}
        {docs.map((d) => (
          <Link
            key={`${d.contentType}:${d.slug}`}
            href={`/admin/site/docs/${d.contentType}/${encodeURIComponent(d.slug)}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-gray-50"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">{d.title || d.slug}</div>
              <div className="text-xs text-gray-500 truncate">
                {d.contentType.replace('_', ' ')} · {d.slug} · {d.activeVersion ? `live v${d.activeVersion}` : 'no live version'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {d.hasDraft && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">draft</span>}
              {!d.activeVersion && !d.hasDraft && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">retired</span>
              )}
              <span className="text-gray-400">&rarr;</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
