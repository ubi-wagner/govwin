import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContentBySlug } from '@/lib/cms';
import { renderMarkdown } from '@/lib/markdown';

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
}

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export const revalidate = 60;

export async function generateMetadata({ params }: RouteContext): Promise<Metadata> {
  const { slug } = await params;
  const article = await getContentBySlug(slug);
  if (!article) return { title: 'Not Found' };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.rfppipeline.com';
  return {
    title: `${article.title} | RFP Pipeline`,
    description: article.excerpt || article.title,
    openGraph: {
      title: article.title,
      description: article.excerpt || article.title,
      type: 'article',
      url: `${baseUrl}/resources/${slug}`,
      images: article.featuredImage ? [{ url: article.featuredImage }] : [],
      publishedTime: article.publishedAt?.toISOString(),
      authors: article.author ? [article.author] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.excerpt || article.title,
    },
  };
}

export default async function ResourceArticlePage({ params }: RouteContext) {
  const { slug } = await params;
  const article = await getContentBySlug(slug);

  if (!article) {
    notFound();
  }

  const publishedDate = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', {
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
            {article.contentType.replace('_', ' ')}
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-black text-navy-900">
            {article.title}
          </h1>
          {article.excerpt && (
            <p className="mt-4 text-lg text-navy-600">{article.excerpt}</p>
          )}
          <div className="mt-6 flex items-center gap-4 text-sm text-navy-400">
            {article.author && <span>By {article.author}</span>}
            {publishedDate && <span>{publishedDate}</span>}
          </div>
          {article.tags && article.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
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
          {article.featuredImage && (
            <div className="mb-8 rounded-lg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.featuredImage}
                alt={article.title}
                className="w-full h-auto"
              />
            </div>
          )}

          <div
            className="prose prose-navy max-w-none text-navy-700 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: article.body?.startsWith('<')
              ? sanitizeHtml(article.body)
              : sanitizeHtml(renderMarkdown(article.body)) }}
          />

          {article.externalUrl && (
            <div className="mt-8 p-4 bg-cream-50 border border-cream-200 rounded-lg">
              <p className="text-sm text-navy-600">
                This resource references an external source:
              </p>
              <a
                href={article.externalUrl}
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

      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            Ready to build your federal R&amp;D pipeline?
          </h2>
          <Link href="/apply" className="inline-flex mt-6 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            Apply Now
          </Link>
        </div>
      </section>
    </>
  );
}
