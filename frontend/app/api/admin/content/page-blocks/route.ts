/**
 * Page-block API for the visual editor.
 *
 * GET   ?page=homepage  — All blocks for a page (published + draft), ordered by section + display_order
 * PATCH                 — Batch-save draft edits (versioned)
 * POST  ?action=publish — Batch-publish all drafts for a page
 * POST  ?action=discard — Discard all drafts for a page (revert to published)
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Map page tag to the public marketing URL path for revalidation. */
const PAGE_TO_PATH: Record<string, string> = {
  homepage: '/',
  about: '/about',
  features: '/features',
  value: '/value',
  pricing: '/pricing',
  'how-it-works': '/how-it-works',
  engine: '/engine',
  'the-expert': '/the-expert',
  security: '/security',
  infosec: '/infosec',
  apply: '/apply',
  'get-started': '/get-started',
  resources: '/resources',
};

function adminGuard(session: unknown): NextResponse | null {
  const s = session as { user?: { role?: string; id?: string } | null } | null;
  if (!s?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const role = s.user.role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
  }
  if (!s.user.id) {
    return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  return null;
}

// ─── GET: list blocks for a page ──────────────────────────────────────

export async function GET(request: Request) {
  try {
    const session = await auth();
    const err = adminGuard(session);
    if (err) return err;

    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page');

    if (!page) {
      return NextResponse.json({ error: 'Missing required param: page', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const rows = await sql`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, COALESCE(status, CASE WHEN published THEN 'published' ELSE 'draft' END) AS status,
             published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = 'page_block'
        AND ${page} = ANY(tags)
        AND status IN ('published', 'draft')
      ORDER BY display_order ASC, created_at ASC
    `;

    return NextResponse.json({ data: { blocks: rows } });
  } catch (e) {
    console.error('[api/admin/content/page-blocks GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ─── PATCH: batch-save drafts (with version history) ─────────────────

interface BlockUpdate {
  id: string;
  title?: string;
  body?: string;
  excerpt?: string | null;
  featuredImage?: string | null;
  displayOrder?: number;
  metadata?: Record<string, unknown>;
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    const err = adminGuard(session);
    if (err) return err;

    const userId = (session!.user as { id?: string }).id!;
    const userEmail = (session!.user as { email?: string }).email;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const updates = body.updates as BlockUpdate[] | undefined;
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'Missing or empty updates array', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const savedIds: string[] = [];

    for (const upd of updates) {
      if (!upd.id || typeof upd.id !== 'string') continue;

      // 1. Read current content for version snapshot
      const [current] = await sql<{
        id: string;
        title: string;
        body: string;
        excerpt: string | null;
        featuredImage: string | null;
        displayOrder: number;
        metadata: Record<string, unknown>;
      }[]>`
        SELECT id, title, body, excerpt, featured_image, display_order, metadata
        FROM cms_content
        WHERE id = ${upd.id}
        LIMIT 1
      `;

      if (!current) continue;

      // 2. Build version snapshot from current state
      const existingMeta = (current.metadata ?? {}) as Record<string, unknown>;
      const versions = Array.isArray(existingMeta._versions) ? [...existingMeta._versions] : [];
      const currentVersion = typeof existingMeta._currentVersion === 'number' ? existingMeta._currentVersion : 0;

      // Snapshot current state (without _versions and _currentVersion to avoid recursion)
      const { _versions: _v, _currentVersion: _cv, ...cleanMeta } = existingMeta;
      void _v;
      void _cv;
      const snapshot = {
        version: currentVersion,
        savedAt: new Date().toISOString(),
        savedBy: userEmail ?? userId,
        title: current.title,
        body: current.body,
        excerpt: current.excerpt,
        featuredImage: current.featuredImage,
        displayOrder: current.displayOrder,
        metadata: cleanMeta,
      };

      // Keep last 20 versions
      versions.unshift(snapshot);
      if (versions.length > 20) versions.length = 20;

      const newVersion = currentVersion + 1;

      // 3. Merge incoming metadata with version tracking
      const incomingMeta = upd.metadata ?? {};
      const { _versions: _iv, _currentVersion: _icv, ...cleanIncomingMeta } = incomingMeta as Record<string, unknown>;
      void _iv;
      void _icv;
      const mergedMeta = {
        ...cleanMeta,
        ...cleanIncomingMeta,
        _versions: versions,
        _currentVersion: newVersion,
      };

      // 4. Update the block to draft status
      await sql`
        UPDATE cms_content
        SET title = COALESCE(${upd.title ?? null}, title),
            body = COALESCE(${upd.body ?? null}, body),
            excerpt = ${upd.excerpt !== undefined ? upd.excerpt : sql`excerpt`},
            featured_image = ${upd.featuredImage !== undefined ? upd.featuredImage : sql`featured_image`},
            display_order = COALESCE(${upd.displayOrder ?? null}, display_order),
            metadata = ${JSON.stringify(mergedMeta)}::jsonb,
            status = 'draft',
            published = false,
            updated_at = now()
        WHERE id = ${upd.id}
      `;

      savedIds.push(upd.id);
    }

    return NextResponse.json({ data: { saved: savedIds.length, ids: savedIds } });
  } catch (e) {
    console.error('[api/admin/content/page-blocks PATCH] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ─── POST: publish or discard ────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth();
    const err = adminGuard(session);
    if (err) return err;

    const userId = (session!.user as { id?: string }).id!;
    const userEmail = (session!.user as { email?: string }).email;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : '';
    const page = typeof body.page === 'string' ? body.page.trim() : '';

    if (!page) {
      return NextResponse.json({ error: 'Missing required field: page', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    if (action === 'publish') {
      // Batch-publish all draft blocks for this page
      const rows = await sql<{ id: string }[]>`
        UPDATE cms_content
        SET status = 'published',
            published = true,
            published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE content_type = 'page_block'
          AND ${page} = ANY(tags)
          AND status = 'draft'
        RETURNING id
      `;

      // Revalidate the marketing page
      const publicPath = PAGE_TO_PATH[page];
      if (publicPath) {
        revalidatePath(publicPath);
      }

      await emitEventSingle({
        namespace: 'system',
        type: 'content.page_published',
        actor: userActor(userId, userEmail),
        payload: {
          correlationId: randomUUID(),
          page,
          blocksPublished: rows.length,
          publishedBy: userEmail ?? userId,
        },
      });

      return NextResponse.json({ data: { published: rows.length, page } });
    }

    if (action === 'discard') {
      // Revert all draft blocks for this page back to their last published version.
      // We read the _versions array from metadata and restore the most recent
      // version that was in published state. If no version history exists,
      // we simply delete blocks that were never published.

      // Get all draft blocks for this page
      const drafts = await sql<{
        id: string;
        metadata: Record<string, unknown>;
        publishedAt: Date | null;
      }[]>`
        SELECT id, metadata, published_at
        FROM cms_content
        WHERE content_type = 'page_block'
          AND ${page} = ANY(tags)
          AND status = 'draft'
      `;

      let reverted = 0;
      for (const draft of drafts) {
        const meta = (draft.metadata ?? {}) as Record<string, unknown>;
        const versions = Array.isArray(meta._versions) ? meta._versions : [];

        if (versions.length > 0) {
          // Restore the most recent version snapshot
          const lastVersion = versions[0] as Record<string, unknown>;
          const restoredMeta = (lastVersion.metadata ?? {}) as Record<string, unknown>;

          // Keep version history but decrement current version
          const currentVersion = typeof meta._currentVersion === 'number' ? meta._currentVersion : 1;
          const mergedMeta = {
            ...restoredMeta,
            _versions: versions,
            _currentVersion: currentVersion,
          };

          await sql`
            UPDATE cms_content
            SET title = ${(lastVersion.title as string) ?? ''},
                body = ${(lastVersion.body as string) ?? ''},
                excerpt = ${(lastVersion.excerpt as string | null) ?? null},
                featured_image = ${(lastVersion.featuredImage as string | null) ?? null},
                display_order = ${(lastVersion.displayOrder as number) ?? 0},
                metadata = ${JSON.stringify(mergedMeta)}::jsonb,
                status = 'published',
                published = true,
                updated_at = now()
            WHERE id = ${draft.id}
          `;
          reverted++;
        } else if (draft.publishedAt) {
          // No version history but was previously published — just flip status back
          await sql`
            UPDATE cms_content
            SET status = 'published', published = true, updated_at = now()
            WHERE id = ${draft.id}
          `;
          reverted++;
        }
        // If never published and no versions, leave it as draft (nothing to revert to)
      }

      return NextResponse.json({ data: { discarded: reverted, page } });
    }

    return NextResponse.json({ error: 'Invalid action. Must be "publish" or "discard"', code: 'VALIDATION_ERROR' }, { status: 422 });
  } catch (e) {
    console.error('[api/admin/content/page-blocks POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
