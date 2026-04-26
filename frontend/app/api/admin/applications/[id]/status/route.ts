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
      return NextResponse.json({ error: 'Missing user id' }, { status: 401 });
    }

    let body: { status: string; note: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validStatuses = ['pending', 'under_review', 'accepted', 'rejected', 'withdrawn'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 422 },
      );
    }

    if (!body.note || body.note.trim().length < 5) {
      return NextResponse.json(
        { error: 'Audit note required (min 5 chars)' },
        { status: 422 },
      );
    }

    const [app] = await sql<{ id: string; status: string; companyName: string; contactEmail: string }[]>`
      SELECT id, status, company_name, contact_email FROM applications WHERE id = ${id} LIMIT 1
    `;
    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    const previousStatus = app.status;

    await sql`
      UPDATE applications
      SET status = ${body.status},
          reviewed_by = ${userId},
          reviewed_at = now(),
          review_notes = ${body.note.trim()}
      WHERE id = ${id}
    `;

    await emitEventSingle({
      namespace: 'identity',
      type: 'application.status_changed',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        applicationId: id,
        companyName: app.companyName,
        contactEmail: app.contactEmail,
        previousStatus,
        newStatus: body.status,
        note: body.note.trim(),
      },
    });

    return NextResponse.json({
      data: { previousStatus, newStatus: body.status },
    });
  } catch (e) {
    console.error('[api/admin/applications/status] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
