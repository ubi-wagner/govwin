import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getContentBySlugAdmin, getPublishedContent, type ContentRow } from '@/lib/cms';
import { renderMarkdown } from '@/lib/markdown';
import AdminPreviewToolbar from '@/components/admin/preview-toolbar';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ contentId: string }>;
}

// ─── Rendering helpers (mirror the public pages) ────────────────────

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
}

function BlogPostPreview({ content, related }: { content: ContentRow; related: ContentRow[] }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/blog" className="text-sm text-brand-600 hover:text-brand-800 mb-6 inline-block">
        &larr; Back to Blog
      </Link>

      {content.featuredImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={content.featuredImage}
          alt={content.title}
          className="w-full h-64 object-cover rounded-lg mb-6"
        />
      )}

      <h1 className="text-3xl font-bold text-navy-900 mb-3">{content.title}</h1>

      <div className="flex items-center gap-3 text-sm text-gray-500 mb-8">
        {content.author && <span className="font-medium">{content.author}</span>}
        {content.publishedAt && (
          <>
            <span>·</span>
            <span>{new Date(content.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </>
        )}
      </div>

      <div
        className="prose prose-lg max-w-none text-gray-700 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(content.body)) }}
      />

      {(content.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t">
          {content.tags.map((tag: string) => (
            <span key={tag} className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">{tag}</span>
          ))}
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-12 pt-8 border-t">
          <h3 className="text-lg font-semibold text-navy-900 mb-4">More from the Blog</h3>
          <div className="grid gap-4">
            {related.map((r) => (
              <Link key={r.id} href={`/blog/${r.slug}`} className="group flex gap-4 items-start">
                <div>
                  <div className="font-medium text-navy-900 group-hover:text-brand-600 transition-colors">{r.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{r.excerpt?.slice(0, 100)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResourcePreview({ content }: { content: ContentRow }) {
  const publishedDate = content.publishedAt
    ? new Date(content.publishedAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-3xl mx-auto px-6 py-16">
          <Link
            href="/resources"
            className="text-sm text-brand-500 hover:text-brand-700 font-medium mb-6 inline-block"
          >
            &larr; Back to Resources
          </Link>
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">
            {content.contentType.replace('_', ' ')}
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-black text-navy-900">
            {content.title}
          </h1>
          {content.excerpt && (
            <p className="mt-4 text-lg text-navy-600">{content.excerpt}</p>
          )}
          <div className="mt-6 flex items-center gap-4 text-sm text-navy-400">
            {content.author && <span>By {content.author}</span>}
            {publishedDate && <span>{publishedDate}</span>}
          </div>
          {content.tags && content.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {content.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-3xl mx-auto px-6 py-16">
          {content.featuredImage && (
            <div className="mb-8 rounded-lg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={content.featuredImage}
                alt={content.title}
                className="w-full h-auto"
              />
            </div>
          )}

          <div
            className="prose prose-navy max-w-none text-navy-700 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(content.body)) }}
          />

          {content.externalUrl && (
            <div className="mt-8 p-4 bg-cream-50 border border-cream-200 rounded-lg">
              <p className="text-sm text-navy-600">
                This resource references an external source:
              </p>
              <a
                href={content.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex text-sm text-brand-500 hover:text-brand-700 font-medium"
              >
                Visit original source &rarr;
              </a>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function PageBlockPreview({ content }: { content: ContentRow }) {
  const pageTags = content.tags?.filter((t) =>
    ['homepage', 'about', 'features', 'value', 'pricing', 'how-it-works', 'engine', 'the-expert', 'security', 'infosec', 'apply', 'get-started', 'resources'].includes(t)
  ) ?? [];
  const sectionTags = content.tags?.filter((t) => !pageTags.includes(t)) ?? [];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm font-medium text-blue-800 mb-2">Page Block Context</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {pageTags.map((tag) => (
            <span key={tag} className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium">
              Page: {tag}
            </span>
          ))}
          {sectionTags.map((tag) => (
            <span key={tag} className="bg-purple-100 text-purple-700 px-2 py-1 rounded font-medium">
              Section: {tag}
            </span>
          ))}
          <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded">
            Order: #{content.displayOrder}
          </span>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-navy-900 mb-2">{content.title}</h1>
      {content.excerpt && (
        <p className="text-lg text-navy-600 mb-6">{content.excerpt}</p>
      )}
      <div className="prose prose-navy max-w-none text-navy-700 leading-relaxed whitespace-pre-wrap">
        {content.body}
      </div>

      {Object.keys(content.metadata ?? {}).length > 0 && (
        <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-xs font-medium text-gray-500 mb-2">Metadata</p>
          <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap">
            {JSON.stringify(content.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function GenericPreview({ content }: { content: ContentRow }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">
        {content.contentType.replace('_', ' ')}
      </p>
      <h1 className="font-display text-3xl font-bold text-navy-900 mb-3">{content.title}</h1>
      {content.excerpt && (
        <p className="text-lg text-navy-600 mb-6">{content.excerpt}</p>
      )}
      {content.featuredImage && (
        <div className="mb-8 rounded-lg overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.featuredImage}
            alt={content.title}
            className="w-full h-auto"
          />
        </div>
      )}
      <div className="prose prose-navy max-w-none text-navy-700 leading-relaxed whitespace-pre-wrap">
        {content.body}
      </div>
      {content.tags && content.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t">
          {content.tags.map((tag) => (
            <span key={tag} className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Preview Page ──────────────────────────────────────────────

export default async function ContentPreviewPage({ params }: RouteContext) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  const { contentId } = await params;
  const content = await getContentBySlugAdmin(contentId);

  if (!content) {
    notFound();
  }

  // Fetch related content for blog posts
  let related: ContentRow[] = [];
  if (content.contentType === 'blog_post') {
    try {
      const recent = await getPublishedContent('blog_post', 4);
      related = recent.filter((p) => p.id !== content.id).slice(0, 3);
    } catch {
      // Non-critical — proceed without related posts
    }
  }

  return (
    <div>
      <AdminPreviewToolbar
        content={{
          id: content.id,
          slug: content.slug,
          title: content.title,
          contentType: content.contentType,
          status: content.status,
        }}
      />

      {/* Push content below toolbar */}
      <div className="pt-10">
        {content.contentType === 'blog_post' && (
          <BlogPostPreview content={content} related={related} />
        )}
        {(content.contentType === 'resource' || content.contentType === 'guide') && (
          <ResourcePreview content={content} />
        )}
        {content.contentType === 'page_block' && (
          <PageBlockPreview content={content} />
        )}
        {!['blog_post', 'resource', 'guide', 'page_block'].includes(content.contentType) && (
          <GenericPreview content={content} />
        )}
      </div>
    </div>
  );
}
