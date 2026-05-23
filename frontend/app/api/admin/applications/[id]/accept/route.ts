import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { sendEmail } from '@/lib/email';
import { applicationAcceptedEmail } from '@/lib/email-templates';
import { isValidUUID } from '@/lib/validation';
import bcrypt from 'bcryptjs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(request: Request, ctx: RouteContext) {
  let eventId = '';
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

    // Parse optional review notes from request body
    let reviewNotes = '';
    try {
      const body = await request.json();
      if (typeof body.reviewNotes === 'string') reviewNotes = body.reviewNotes.trim();
    } catch { }

    // Fetch application
    const [app] = await sql<{
      id: string;
      companyName: string;
      contactEmail: string;
      contactName: string;
      status: string;
    }[]>`
      SELECT id, company_name, contact_email, contact_name, status
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

    // ── Start event for multi-step accept operation ────────────────
    eventId = await emitEventStart({
      namespace: 'capture',
      type: 'application.accepted',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        applicationId: id,
        companyName: app.companyName,
        contactEmail: app.contactEmail,
      },
    });

    // Wrap tenant + user + application update in a transaction
    // so partial failures don't leave orphaned rows
    const tempPw = crypto.randomUUID().slice(0, 12);
    const hash = await bcrypt.hash(tempPw, 12);

    // eslint-disable-next-line
    const result = await sql.begin(async (tsql: any) => {
      // Create tenant with unique slug
      const slug = slugify(app.companyName);
      let finalSlug = slug;
      let existingTenant = (await tsql`
        SELECT id FROM tenants WHERE slug = ${finalSlug} LIMIT 1
      `)[0];
      let suffix = 2;
      while (existingTenant) {
        finalSlug = `${slug}-${suffix}`;
        existingTenant = (await tsql`
          SELECT id FROM tenants WHERE slug = ${finalSlug} LIMIT 1
        `)[0];
        suffix++;
      }
      const [newTenant] = await tsql`
        INSERT INTO tenants (name, slug, status)
        VALUES (${app.companyName}, ${finalSlug}, 'active')
        RETURNING id
      `;
      const tenantId = newTenant.id;

      // Create or find existing user, reset temp password for re-acceptance
      let newUserId: string;

      const [existingUser] = await tsql`
        SELECT id FROM users WHERE LOWER(email) = ${app.contactEmail.toLowerCase().trim()} LIMIT 1
      `;
      if (existingUser) {
        newUserId = existingUser.id;
        await tsql`
          UPDATE users
          SET password_hash = ${hash},
              temp_password = true,
              tenant_id = ${tenantId},
              is_active = true
          WHERE id = ${existingUser.id}
        `;
      } else {
        const [created] = await tsql`
          INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
          VALUES (
            ${app.contactEmail.toLowerCase().trim()},
            ${app.contactName},
            'tenant_admin',
            ${tenantId},
            ${hash},
            true,
            true
          )
          RETURNING id
        `;
        newUserId = created.id;
      }

      // Update application status AFTER tenant+user creation succeeds
      await tsql`
        UPDATE applications
        SET status = 'accepted',
            reviewed_by = ${userId},
            reviewed_at = now(),
            review_notes = ${reviewNotes || null}
        WHERE id = ${id}
      `;

      return { tenantId, finalSlug, newUserId };
    });

    const { tenantId, finalSlug, newUserId } = result;

    // Send welcome email with credentials
    const loginUrl = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''}/login`;
    const emailContent = applicationAcceptedEmail({
      contactName: app.contactName,
      contactEmail: app.contactEmail,
      companyName: app.companyName,
      tempPassword: tempPw,
      tenantSlug: finalSlug,
      loginUrl,
    });
    const emailResult = await sendEmail({
      to: app.contactEmail,
      subject: emailContent.subject,
      html: emailContent.html,
    });

    await emitEventEnd(eventId, {
      result: {
        tenantId,
        tenantSlug: finalSlug,
        userId: newUserId,
        emailSent: emailResult.provider !== 'skipped',
      },
    });

    return NextResponse.json({
      data: {
        tenantId: tenantId,
        tenantSlug: finalSlug,
        userId: newUserId,
        contactEmail: app.contactEmail,
        contactName: app.contactName,
        companyName: app.companyName,
        emailSent: emailResult.provider !== 'skipped',
        emailProvider: emailResult.provider,
        emailFailed: !!emailResult.error,
      },
    });
  } catch (e) {
    console.error('[api/admin/applications/accept] error:', e);
    if (eventId) {
      await emitEventEnd(eventId, {
        error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' },
      });
    }
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
