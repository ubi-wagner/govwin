import Link from 'next/link';
import { listPages, listDocuments, DOC_TYPES, type PageSummary } from '@/lib/content-admin';
import { SEED_PAGE_KEYS } from '@/lib/page-content';

export const dynamic = 'force-dynamic';

export default async function SiteContentPage() {
  let pages: PageSummary[] = [];
  let docs: Awaited<ReturnType<typeof listDocuments>> = [];
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

  // Surface every known page, even ones not yet seeded into content_pages —
  // opening one initializes it from its defaults so it's never undiscoverable.
  const seen = new Set(pages.map((p) => p.pageKey));
  const unseeded: PageSummary[] = SEED_PAGE_KEYS.filter((k) => !seen.has(k)).map((pageKey) => ({
    pageKey,
    contentType: 'page',
    activeVersion: null,
    hasDraft: false,
    lastUpdated: new Date(0),
  }));
  pages = [...pages, ...unseeded].sort((a, b) => a.pageKey.localeCompare(b.pageKey));

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Site Content</h1>
      <p className="text-sm text-gray-500 mb-6">
        Edit, preview, and publish website content. Every save is a versioned snapshot;
        publishing swaps the live version the public site reads.
      </p>

      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Pages</h2>
      <div className="border rounded-lg divide-y bg-white mb-8">
        {pages.length === 0 && <div className="p-4 text-sm text-gray-500">No pages yet.</div>}
        {pages.map((p) => (
          <Link
            key={p.pageKey}
            href={`/admin/site/${encodeURIComponent(p.pageKey)}`}
            className="flex items-center justify-between p-4 hover:bg-gray-50"
          >
            <div>
              <div className="font-medium">{p.pageKey}</div>
              <div className="text-xs text-gray-500">
                {p.contentType} · {p.activeVersion ? `live v${p.activeVersion}` : 'using page defaults'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {p.hasDraft && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">draft</span>}
              {!p.activeVersion && !p.hasDraft && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">defaults</span>
              )}
              <span className="text-gray-400">&rarr;</span>
            </div>
          </Link>
        ))}
      </div>

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
            className="flex items-center justify-between p-4 hover:bg-gray-50"
          >
            <div>
              <div className="font-medium">{d.title || d.slug}</div>
              <div className="text-xs text-gray-500">
                {d.contentType} · {d.slug} · {d.activeVersion ? `live v${d.activeVersion}` : 'no live version'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {d.hasDraft && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">draft</span>}
              <span className="text-gray-400">&rarr;</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
