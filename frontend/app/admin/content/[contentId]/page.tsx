import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
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
  const isNew = contentId === 'new';

  let existing: ContentEditRow | null = null;

  if (!isNew) {
    try {
      const [row] = await sql<ContentEditRow[]>`
        SELECT id, slug, title, content_type, body, excerpt, author, tags,
               status, published, published_at, featured_image, external_url,
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
      redirect('/admin/content');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {isNew ? 'New Content' : `Edit: ${existing?.title}`}
      </h1>
      <ContentEditorForm
        existing={existing ? {
          id: existing.id,
          slug: existing.slug,
          title: existing.title,
          contentType: existing.contentType,
          body: existing.body,
          excerpt: existing.excerpt ?? '',
          author: existing.author ?? '',
          tags: existing.tags ?? [],
          published: existing.published,
          featuredImage: existing.featuredImage ?? '',
          externalUrl: existing.externalUrl ?? '',
          displayOrder: existing.displayOrder ?? 0,
          metadata: existing.metadata ?? {},
        } : null}
      />
    </div>
  );
}
