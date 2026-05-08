import { getPublishedContent } from '@/lib/cms';
import Link from 'next/link';

export const metadata = {
  title: 'Blog — RFP Pipeline',
  description: 'Insights on federal contracting, SBIR proposals, and winning government R&D funding.',
};

export default async function BlogPage() {
  const posts = await getPublishedContent('blog_post', 50);

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <h1 className="text-4xl font-bold text-navy-900 mb-2">Blog</h1>
      <p className="text-gray-500 mb-10">
        Insights on federal contracting, proposal strategy, and winning government R&D funding.
      </p>

      {posts.length === 0 ? (
        <p className="text-gray-400 text-center py-16">Posts coming soon.</p>
      ) : (
        <div className="space-y-8">
          {posts.map((post) => (
            <article key={post.id} className="border-b border-gray-100 pb-8">
              <Link href={`/blog/${post.slug}`} className="group">
                {post.featuredImage && (
                  <img
                    src={post.featuredImage}
                    alt={post.title}
                    className="w-full h-48 object-cover rounded-lg mb-4 group-hover:opacity-90 transition-opacity"
                  />
                )}
                <h2 className="text-xl font-semibold text-navy-900 group-hover:text-brand-600 transition-colors">
                  {post.title}
                </h2>
              </Link>
              <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                {post.author && <span>{post.author}</span>}
                {post.publishedAt && (
                  <>
                    <span>·</span>
                    <span>{new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  </>
                )}
              </div>
              {post.excerpt && (
                <p className="text-gray-600 mt-3 leading-relaxed">{post.excerpt}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {(post.tags ?? []).map((tag: string) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
