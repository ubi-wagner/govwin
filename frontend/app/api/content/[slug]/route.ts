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
import { getContentBySlug } from '@/lib/cms';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { slug } = await ctx.params;

    if (!slug || typeof slug !== 'string') {
      return NextResponse.json({ error: 'Missing slug', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── READS THE CANONICAL STORE, THROUGH THE SHARED HELPER ────────────────────────────────
    // This used to run its own SELECT against `cms_content`, the superseded table — so a public
    // endpoint served the pre-migration set while every marketing page served the current one, and
    // anything published since the move answered 404 here. It now goes through `getContentBySlug`,
    // the same function the pages use, rather than a second query that can drift from it.
    const article = await getContentBySlug(slug);

    if (!article) {
      return NextResponse.json({ error: 'Article not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ data: { article } });
  } catch (e) {
    console.error('[api/content/slug GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
