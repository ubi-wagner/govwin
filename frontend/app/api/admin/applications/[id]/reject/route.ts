import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { send } from '@/lib/email';
import { applicationRejectedEmail } from '@/lib/email-templates';
import { isValidUUID } from '@/lib/validation';
import { closeTasksForEntity } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  let startId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid application ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
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
    let app: { id: string; status: string; contactName: string; contactEmail: string; companyName: string } | undefined;
    try {
      const rows = await sql<{ id: string; status: string; contactName: string; contactEmail: string; companyName: string }[]>`
        SELECT id, status, contact_name, contact_email, company_name
        FROM applications
        WHERE id = ${id}
        LIMIT 1
      `;
      app = rows[0];
    } catch (e) {
      console.error('[admin/applications/reject] lookup query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!app) {
      return NextResponse.json({ error: 'Application not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (app.status !== 'pending' && app.status !== 'under_review') {
      return NextResponse.json(
        { error: `Application is already ${app.status}`, code: 'VALIDATION_ERROR' },
        { status: 409 },
      );
    }

    // ── Start event ────────────────────────────────────────────────
    startId = await emitEventStart({
      namespace: 'capture',
      type: 'application.rejected',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        applicationId: id,
        companyName: app.companyName,
        contactEmail: app.contactEmail,
      },
    });

    // Update application status
    try {
      await sql`
        UPDATE applications
        SET status = 'rejected',
            reviewed_by = ${userId},
            reviewed_at = now(),
            review_notes = ${reason || null}
        WHERE id = ${id}
      `;
    } catch (e) {
      console.error('[admin/applications/reject] update query failed:', e);
      await emitEventEnd(startId, { error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // The question the triage ToDo asked has now been answered, so the ToDo is moot, not pending.
    // Rejecting drains it exactly as accepting does — the two decisions must not diverge (B51).
    try {
      const closed = await closeTasksForEntity({
        entityType: 'application',
        entityId: id,
        actor: { id: userId, email: (session.user as { email?: string }).email ?? null, role: role as Role, tenantId: null },
        result: { decision: 'rejected', reason },
      });
      if (closed.failed) console.error('[admin/applications/reject] some triage ToDos did not close', closed);
    } catch (taskErr) {
      console.error('[admin/applications/reject] ToDo close failed (non-fatal):', taskErr);
    }

    // Send rejection email (non-fatal)
    let emailSent = false;
    try {
      const emailContent = applicationRejectedEmail({
        contactName: app.contactName,
        companyName: app.companyName,
        reason: reason,
      });
      const r = await send({
        to: app.contactEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        kind: 'transactional',
        // Platform scope: a rejected application never became a tenant, so there is no tenant this
        // send belongs to. NULL is the answer, not a stand-in.
        tenantId: null,
        template: 'application_rejected',
        idempotencyKey: `application_rejected:${id}`,
        tags: ['onboarding'],
      });
      emailSent = r.accepted;
    } catch (e) {
      console.error('[admin/applications/reject] email send failed:', e);
      // non-fatal, continue
    }

    await emitEventEnd(startId, {
      result: { applicationId: id, reason, emailSent },
    });

    return NextResponse.json({ data: { rejected: true } });
  } catch (e) {
    if (startId) {
      await emitEventEnd(startId, { error: { message: e instanceof Error ? e.message : String(e), code: 'HANDLER_THREW' } });
    }
    console.error('[api/admin/applications/reject] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
