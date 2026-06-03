import Link from 'next/link';
import { listPages } from '@/lib/content-admin';

export const dynamic = 'force-dynamic';

export default async function SiteContentPage() {
  let pages: Awaited<ReturnType<typeof listPages>> = [];
  try {
    pages = await listPages();
  } catch (e) {
    console.error('[admin/site] listPages failed:', e);
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Site Content</h1>
      <p className="text-sm text-gray-500 mb-6">
        Edit, preview, and publish marketing-page content. Every save is a versioned snapshot;
        publishing swaps the live version the public site reads.
      </p>
      <div className="border rounded-lg divide-y bg-white">
        {pages.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No pages yet.</div>
        )}
        {pages.map((p) => (
          <Link
            key={p.pageKey}
            href={`/admin/site/${encodeURIComponent(p.pageKey)}`}
            className="flex items-center justify-between p-4 hover:bg-gray-50"
          >
            <div>
              <div className="font-medium">{p.pageKey}</div>
              <div className="text-xs text-gray-500">
                {p.contentType} · {p.activeVersion ? `live v${p.activeVersion}` : 'no live version'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {p.hasDraft && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">draft</span>
              )}
              <span className="text-gray-400">&rarr;</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
