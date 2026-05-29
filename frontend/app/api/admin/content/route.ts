/**
 * Content API for managing CMS articles (blog posts, resources, guides).
 *
 * GET  — List published content, filterable by type and tags (public)
 * POST — Create/update content (admin only, upsert on slug)
 * DELETE — Delete content by slug (admin only)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

// ─── GET: public listing ───────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');
    const type = searchParams.get('type');
    const tag = searchParams.get('tag');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 100);

    // Single article by slug — return full body
    if (slug) {
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
        return NextResponse.json({ error: 'Article not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      return NextResponse.json({ data: { article } });
    }

    // List articles — excerpt only, no body
    const articles = await sql<{
      id: string;
      slug: string;
      title: string;
      contentType: string;
      excerpt: string | null;
      author: string | null;
      tags: string[];
      publishedAt: Date | null;
      featuredImage: string | null;
    }[]>`
      SELECT id, slug, title, content_type, excerpt, author, tags,
             published_at, featured_image
      FROM cms_content
      WHERE published = true
        AND (${type ?? null}::text IS NULL OR content_type = ${type ?? null})
        AND (${tag ?? null}::text IS NULL OR ${tag ?? null} = ANY(tags))
      ORDER BY published_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({ data: { articles } });
  } catch (e) {
    console.error('[api/admin/content GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ─── POST: create/update content (admin only) ─────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Input validation
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const articleBody = typeof body.body === 'string' ? body.body : '';

    if (!slug || !title || !contentType || !articleBody) {
      return NextResponse.json(
        { error: 'Missing required fields: slug, title, contentType, body', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const validTypes = ['blog_post', 'resource', 'guide', 'announcement', 'faq', 'testimonial', 'team_member', 'social_post', 'page_block'];
    if (!validTypes.includes(contentType)) {
      return NextResponse.json(
        { error: `Invalid contentType. Must be one of: ${validTypes.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() || null : null;
    const author = typeof body.author === 'string' ? body.author.trim() || null : null;
    const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : [];
    const validStatuses = ['draft', 'pending', 'published', 'private', 'archived'];
    const status = typeof body.status === 'string' && validStatuses.includes(body.status) ? body.status : 'draft';
    const published = status === 'published';
    const featuredImage = typeof body.featuredImage === 'string' ? body.featuredImage.trim() || null : null;
    const externalUrl = typeof body.externalUrl === 'string' ? body.externalUrl.trim() || null : null;
    const displayOrder = typeof body.displayOrder === 'number' ? body.displayOrder : 0;
    const metadata = typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {};

    const eventType = contentType === 'page_block'
      ? 'content.block_updated'
      : published ? 'content.published' : 'content.updated';

    const startId = await emitEventStart({
      namespace: 'system',
      type: eventType,
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: { slug, title, contentType },
    });

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO cms_content (
        slug, title, content_type, body, excerpt, author, tags,
        published, status, published_at, featured_image, external_url,
        display_order, metadata, created_by
      ) VALUES (
        ${slug}, ${title}, ${contentType}, ${articleBody}, ${excerpt},
        ${author}, ${tags}, ${published}, ${status},
        ${published ? sql`now()` : sql`NULL`},
        ${featuredImage}, ${externalUrl}, ${displayOrder},
        ${JSON.stringify(metadata)}::jsonb, ${userId}
      )
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        content_type = EXCLUDED.content_type,
        body = EXCLUDED.body,
        excerpt = EXCLUDED.excerpt,
        author = EXCLUDED.author,
        tags = EXCLUDED.tags,
        published = EXCLUDED.published,
        status = EXCLUDED.status,
        published_at = CASE
          WHEN EXCLUDED.status = 'published' AND cms_content.published_at IS NULL
          THEN now()
          WHEN EXCLUDED.status != 'published' THEN NULL
          ELSE cms_content.published_at
        END,
        featured_image = EXCLUDED.featured_image,
        external_url = EXCLUDED.external_url,
        display_order = EXCLUDED.display_order,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `;

    await emitEventEnd(startId, {
      result: { contentId: row.id, slug, contentType },
    });

    return NextResponse.json({ data: { id: row.id, slug } });
  } catch (e) {
    console.error('[api/admin/content POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ─── DELETE: remove content by slug (admin only) ──────────────────

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');
    if (!slug) {
      return NextResponse.json({ error: 'Missing required param: slug', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const startId = await emitEventStart({
      namespace: 'system',
      type: 'content.deleted',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: { slug },
    });

    const rows = await sql<{ id: string }[]>`
      DELETE FROM cms_content WHERE slug = ${slug} RETURNING id
    `;

    if (rows.length === 0) {
      await emitEventEnd(startId, { error: { message: 'Article not found', code: 'NOT_FOUND' } });
      return NextResponse.json({ error: 'Article not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await emitEventEnd(startId, {
      result: { slug, deletedId: rows[0].id },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (e) {
    console.error('[api/admin/content DELETE] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
