/**
 * Quick status-change endpoint for CMS content (publish / unpublish / archive).
 * POST — Update status by slug (admin only)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

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

    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';

    if (!slug) {
      return NextResponse.json({ error: 'Missing required field: slug', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const validStatuses = ['draft', 'pending', 'published', 'private', 'archived'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const published = status === 'published';

    const rows = await sql<{ id: string }[]>`
      UPDATE cms_content
      SET status = ${status},
          published = ${published},
          published_at = CASE
            WHEN ${status} = 'published' AND published_at IS NULL THEN now()
            WHEN ${status} != 'published' THEN NULL
            ELSE published_at
          END,
          updated_at = now()
      WHERE slug = ${slug}
      RETURNING id
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Content not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await emitEventSingle({
      namespace: 'system',
      type: published ? 'content.published' : 'content.status_changed',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: { correlationId: randomUUID(), slug, status },
    });

    return NextResponse.json({ data: { id: rows[0].id, slug, status } });
  } catch (e) {
    console.error('[api/admin/content/status POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
