import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const platform = url.searchParams.get('platform');

    const validStatuses = ['draft', 'scheduled', 'posting', 'posted', 'failed'];
    const validPlatforms = ['linkedin', 'twitter', 'facebook', 'instagram'];

    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (platform && !validPlatforms.includes(platform)) {
      return NextResponse.json({ error: 'Invalid platform', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      const posts = await sql`
        SELECT sp.id, sp.content_id, sp.social_account_id, sp.platform, sp.post_text,
               sp.media_urls, sp.link_url, sp.scheduled_at, sp.posted_at,
               sp.platform_post_id, sp.status, sp.engagement_data,
               sp.error_message, sp.retry_count, sp.created_by, sp.created_at, sp.updated_at,
               sa.account_name
        FROM social_posts sp
        JOIN social_accounts sa ON sa.id = sp.social_account_id
        WHERE 1=1
          ${status ? sql`AND sp.status = ${status}` : sql``}
          ${platform ? sql`AND sp.platform = ${platform}` : sql``}
        ORDER BY COALESCE(sp.scheduled_at, sp.created_at) DESC
        LIMIT 50
      `;

      return NextResponse.json({ data: posts });
    } catch (e) {
      console.error('[api/admin/crm/social/posts] GET query failed:', e);
      return NextResponse.json({ error: 'Failed to fetch posts', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/social/posts] GET error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    // Validate required fields
    if (!body.social_account_id || typeof body.social_account_id !== 'string') {
      return NextResponse.json({ error: 'social_account_id is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (!body.post_text || typeof body.post_text !== 'string' || (body.post_text as string).trim().length === 0) {
      return NextResponse.json({ error: 'post_text is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      // Verify account exists
      const [account] = await sql<{ id: string; platform: string }[]>`
        SELECT id, platform FROM social_accounts WHERE id = ${body.social_account_id as string} LIMIT 1
      `;
      if (!account) {
        return NextResponse.json({ error: 'Social account not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      const postStatus = typeof body.scheduled_at === 'string' ? 'scheduled' : 'draft';

      const [post] = await sql<{ id: string }[]>`
        INSERT INTO social_posts (
          content_id, social_account_id, platform, post_text,
          media_urls, link_url, scheduled_at, status, created_by
        ) VALUES (
          ${typeof body.content_id === 'string' ? body.content_id : null},
          ${body.social_account_id as string},
          ${account.platform},
          ${(body.post_text as string).trim()},
          ${Array.isArray(body.media_urls) ? body.media_urls as string[] : null},
          ${typeof body.link_url === 'string' ? body.link_url : null},
          ${typeof body.scheduled_at === 'string' ? body.scheduled_at : null},
          ${postStatus},
          ${userId ?? null}
        )
        RETURNING id
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'social_post.created',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: null,
        payload: { postId: post.id, platform: account.platform, status: postStatus },
      });

      return NextResponse.json({ data: { id: post.id, status: postStatus } }, { status: 201 });
    } catch (e) {
      console.error('[api/admin/crm/social/posts] POST insert failed:', e);
      return NextResponse.json({ error: 'Failed to create post', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/social/posts] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
