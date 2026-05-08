import { getContentBySlug, getPublishedContent } from '@/lib/cms';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const post = await getContentBySlug(slug);
  if (!post) return { title: 'Not Found' };
  return {
    title: `${post.title} — RFP Pipeline Blog`,
    description: post.excerpt ?? post.body?.slice(0, 160),
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getContentBySlug(slug);
  if (!post || post.contentType !== 'blog_post') notFound();

  const recent = await getPublishedContent('blog_post', 4);
  const related = recent.filter((p) => p.id !== post.id).slice(0, 3);

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/blog" className="text-sm text-brand-600 hover:text-brand-800 mb-6 inline-block">
        &larr; Back to Blog
      </Link>

      {post.featuredImage && (
        <img
          src={post.featuredImage}
          alt={post.title}
          className="w-full h-64 object-cover rounded-lg mb-6"
        />
      )}

      <h1 className="text-3xl font-bold text-navy-900 mb-3">{post.title}</h1>

      <div className="flex items-center gap-3 text-sm text-gray-500 mb-8">
        {post.author && <span className="font-medium">{post.author}</span>}
        {post.publishedAt && (
          <>
            <span>·</span>
            <span>{new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </>
        )}
      </div>

      <div className="prose prose-lg max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
        {post.body}
      </div>

      {(post.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t">
          {post.tags.map((tag: string) => (
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
