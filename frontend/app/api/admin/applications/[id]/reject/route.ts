import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin') {
      return NextResponse.json({ error: 'master_admin role required' }, { status: 403 });
    }

    const { id } = await ctx.params;
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session' }, { status: 401 });
    }

    // Parse body for rejection reason (required)
    let reason = '';
    try {
      const body = await request.json();
      if (typeof body.reason === 'string') {
        reason = body.reason.trim();
      }
    } catch {
      // no valid JSON body
    }

    if (!reason || reason.length < 10) {
      return NextResponse.json({ error: 'Review notes are required (min 10 chars)' }, { status: 422 });
    }

    // Verify application exists and is actionable
    const [app] = await sql<{ id: string; status: string }[]>`
      SELECT id, status
      FROM applications
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (app.status !== 'pending' && app.status !== 'under_review') {
      return NextResponse.json(
        { error: `Application is already ${app.status}` },
        { status: 409 },
      );
    }

    // Update application status
    await sql`
      UPDATE applications
      SET status = 'rejected',
          reviewed_by = ${userId},
          reviewed_at = now(),
          review_notes = ${reason || null}
      WHERE id = ${id}
    `;

    // Emit system event
    await emitEventSingle({
      namespace: 'identity',
      type: 'application.rejected',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        applicationId: id,
        reason: reason || null,
      },
    });

    return NextResponse.json({ data: { rejected: true } });
  } catch (e) {
    console.error('[api/admin/applications/reject] error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
