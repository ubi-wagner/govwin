import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

type ContentRow = {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  published: boolean;
  publishedAt: Date | null;
  author: string | null;
  tags: string[];
  updatedAt: Date;
};

export default async function ContentPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  let rows: ContentRow[] = [];
  try {
    rows = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, published, published_at,
             author, tags, updated_at
      FROM cms_content
      ORDER BY updated_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[admin/content] query failed:', e);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Content Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            {rows.length} articles &middot;{' '}
            {rows.filter((r) => r.published).length} published
          </p>
        </div>
        <Link
          href="/admin/content/new"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Article
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-500">No content yet. Create your first article.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Author</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tags</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/content/${row.slug}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {row.title}
                    </Link>
                    <div className="text-xs text-gray-400 mt-0.5">/{row.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {row.contentType.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    {row.published ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Published
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{row.author ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {row.updatedAt
                      ? new Date(row.updatedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
