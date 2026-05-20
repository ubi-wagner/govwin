import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ postId: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
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
    const { postId } = await ctx.params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    const validStatuses = ['draft', 'scheduled', 'posting', 'posted', 'failed'];
    if (body.status !== undefined && (typeof body.status !== 'string' || !validStatuses.includes(body.status))) {
      return NextResponse.json({ error: 'Invalid status', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      const [existing] = await sql<{ id: string; status: string }[]>`
        SELECT id, status FROM social_posts WHERE id = ${postId} LIMIT 1
      `;
      if (!existing) {
        return NextResponse.json({ error: 'Post not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      await sql`
        UPDATE social_posts SET
          post_text = COALESCE(${typeof body.post_text === 'string' ? body.post_text.trim() : null}, post_text),
          link_url = ${body.link_url !== undefined ? (typeof body.link_url === 'string' ? body.link_url : null) : sql`link_url`},
          scheduled_at = ${body.scheduled_at !== undefined ? (typeof body.scheduled_at === 'string' ? body.scheduled_at : null) : sql`scheduled_at`},
          status = COALESCE(${typeof body.status === 'string' ? body.status : null}, status)
        WHERE id = ${postId}
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'social_post.updated',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: null,
        payload: { postId, updates: Object.keys(body) },
      });

      return NextResponse.json({ data: { id: postId } });
    } catch (e) {
      console.error('[api/admin/crm/social/posts/[postId]] PATCH query failed:', e);
      return NextResponse.json({ error: 'Failed to update post', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/social/posts/[postId]] PATCH error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
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
    const { postId } = await ctx.params;

    try {
      const [existing] = await sql<{ id: string; status: string; platform: string }[]>`
        SELECT id, status, platform FROM social_posts WHERE id = ${postId} LIMIT 1
      `;
      if (!existing) {
        return NextResponse.json({ error: 'Post not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      if (existing.status === 'posted') {
        return NextResponse.json({ error: 'Post already published', code: 'CONFLICT' }, { status: 409 });
      }
      if (existing.status === 'posting') {
        return NextResponse.json({ error: 'Post is currently being published', code: 'CONFLICT' }, { status: 409 });
      }

      // Mark as posting — the social poster worker will pick it up
      await sql`
        UPDATE social_posts SET status = 'posting', scheduled_at = NOW()
        WHERE id = ${postId}
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'social_post.publish_requested',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: null,
        payload: { postId, platform: existing.platform },
      });

      return NextResponse.json({ data: { id: postId, status: 'posting' } });
    } catch (e) {
      console.error('[api/admin/crm/social/posts/[postId]] POST publish failed:', e);
      return NextResponse.json({ error: 'Failed to publish post', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/social/posts/[postId]] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
