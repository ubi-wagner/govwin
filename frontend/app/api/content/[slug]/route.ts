/**
 * GET /api/content/[slug]
 *
 * Public endpoint — fetch a single published article by slug.
 * Used by marketing pages to render blog posts, guides, etc.
 *
 * Response:
 *   200: { data: { article: {...} } }
 *   404: { error: 'Article not found' }
 */

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { slug } = await ctx.params;

    if (!slug || typeof slug !== 'string') {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const [article] = await sql<{
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
      metadata: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
    }[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, published_at, featured_image, metadata,
             created_at, updated_at
      FROM cms_content
      WHERE slug = ${slug} AND published = true
      LIMIT 1
    `;

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { article } });
  } catch (e) {
    console.error('[api/content/slug GET] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
