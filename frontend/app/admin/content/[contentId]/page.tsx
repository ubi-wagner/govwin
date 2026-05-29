import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import PageBlockEditor from '@/components/admin/page-block-editor';
import ContentEditorForm from '@/components/admin/content-editor-form';

export const dynamic = 'force-dynamic';

interface ContentEditRow {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  body: string;
  excerpt: string | null;
  author: string | null;
  tags: string[];
  published: boolean;
  status: string;
  publishedAt: Date | null;
  featuredImage: string | null;
  externalUrl: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
}

interface RouteContext {
  params: Promise<{ contentId: string }>;
}

export default async function ContentEditorPage({ params }: RouteContext) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  const { contentId } = await params;

  let existing: ContentEditRow | null = null;

  try {
    const [row] = await sql<ContentEditRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             COALESCE(status, CASE WHEN published THEN 'published' ELSE 'draft' END) AS status,
             published, published_at, featured_image, external_url,
             display_order, metadata
      FROM cms_content
      WHERE slug = ${contentId}
      LIMIT 1
    `;
    existing = row ?? null;
  } catch (e) {
    console.error('[admin/content/edit] query failed:', e);
  }

  if (!existing) {
    return notFound();
  }

  const content: ContentEditRow = existing;

  // For page_block type, use the specialized page block editor with inline metadata
  if (content.contentType === 'page_block') {
    return (
      <div className="p-6">
        <PageBlockEditor
          existing={{
            id: content.id,
            slug: content.slug,
            title: content.title,
            contentType: content.contentType,
            body: content.body,
            excerpt: content.excerpt,
            tags: content.tags ?? [],
            status: content.status,
            featuredImage: content.featuredImage,
            displayOrder: content.displayOrder ?? 0,
            metadata: content.metadata ?? {},
          }}
        />
      </div>
    );
  }

  // For other content types, use the generic editor form
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Edit: {content.title}
      </h1>
      <ContentEditorForm
        existing={{
          id: content.id,
          slug: content.slug,
          title: content.title,
          contentType: content.contentType,
          body: content.body,
          excerpt: content.excerpt ?? '',
          author: content.author ?? '',
          tags: content.tags ?? [],
          published: content.published,
          status: content.status,
          featuredImage: content.featuredImage ?? '',
          externalUrl: content.externalUrl ?? '',
          displayOrder: content.displayOrder ?? 0,
          metadata: content.metadata ?? {},
        }}
      />
    </div>
  );
}
