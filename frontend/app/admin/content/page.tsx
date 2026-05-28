import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import CmsPageManager, {
  type CmsBlock,
  type GroupedData,
} from '@/components/admin/cms-page-manager';

export const dynamic = 'force-dynamic';

const PAGE_TAGS = [
  'homepage', 'about', 'features', 'value', 'pricing',
  'how-it-works', 'engine', 'the-expert', 'security', 'infosec',
  'apply', 'get-started', 'resources',
];

const BLOG_TYPES = ['blog_post', 'resource', 'guide'];

export default async function ContentPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  let rows: CmsBlock[] = [];
  try {
    rows = await sql<CmsBlock[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, COALESCE(status, CASE WHEN published THEN 'published' ELSE 'draft' END) AS status,
             published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      ORDER BY display_order ASC, updated_at DESC
    `;
  } catch (e) {
    console.error('[admin/content] query failed:', e);
  }

  // Group content by page tag → section tag
  const grouped: GroupedData = {
    pages: {},
    blog: [],
    other: [],
  };

  for (const row of rows) {
    // Blog-type content goes to the blog tab
    if (BLOG_TYPES.includes(row.contentType)) {
      grouped.blog.push(row);
      continue;
    }

    const tags = row.tags ?? [];
    const pageTag = tags.find((t) => PAGE_TAGS.includes(t));

    if (!pageTag) {
      // No recognized page tag — goes to "other"
      grouped.other.push(row);
      continue;
    }

    // Section tag is the first tag that is not the page tag
    const sectionTag = tags.find((t) => t !== pageTag) ?? 'unknown';

    if (!grouped.pages[pageTag]) {
      grouped.pages[pageTag] = { sections: {} };
    }
    if (!grouped.pages[pageTag].sections[sectionTag]) {
      grouped.pages[pageTag].sections[sectionTag] = [];
    }
    grouped.pages[pageTag].sections[sectionTag].push(row);
  }

  const totalBlocks = rows.length;
  const publishedCount = rows.filter((r) => r.status === 'published').length;
  const draftCount = rows.filter((r) => r.status === 'draft').length;
  const archivedCount = rows.filter((r) => r.status === 'archived').length;

  return (
    <>
      <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800 flex items-center justify-between">
        <span>Content is managed in the CMS portal. This page shows what is currently published.</span>
        <a
          href={process.env.CMS_SERVICE_URL || 'https://rfp-crm-production.up.railway.app/cms/'}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 px-3 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
        >
          Open CMS Editor &rarr;
        </a>
      </div>
      <CmsPageManager
        grouped={grouped}
        totalBlocks={totalBlocks}
        publishedCount={publishedCount}
        draftCount={draftCount}
        archivedCount={archivedCount}
      />
    </>
  );
}
