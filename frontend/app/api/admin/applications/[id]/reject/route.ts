import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { sendEmail } from '@/lib/email';
import { applicationRejectedEmail } from '@/lib/email-templates';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin') {
      return NextResponse.json({ error: 'master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { id } = await ctx.params;
    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
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
      return NextResponse.json({ error: 'Review notes are required (min 10 chars)', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // Verify application exists and is actionable
    const [app] = await sql<{ id: string; status: string; contactName: string; contactEmail: string; companyName: string }[]>`
      SELECT id, status, contact_name, contact_email, company_name
      FROM applications
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!app) {
      return NextResponse.json({ error: 'Application not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (app.status !== 'pending' && app.status !== 'under_review') {
      return NextResponse.json(
        { error: `Application is already ${app.status}`, code: 'VALIDATION_ERROR' },
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
      namespace: 'capture',
      type: 'application.rejected',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        correlationId: randomUUID(),
        applicationId: id,
        reason: reason || null,
      },
    });

    // Send rejection email
    const emailContent = applicationRejectedEmail({
      contactName: app.contactName,
      companyName: app.companyName,
      reason: reason,
    });
    await sendEmail({
      to: app.contactEmail,
      subject: emailContent.subject,
      html: emailContent.html,
    });

    return NextResponse.json({ data: { rejected: true } });
  } catch (e) {
    console.error('[api/admin/applications/reject] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
