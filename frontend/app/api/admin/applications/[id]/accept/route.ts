import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { sendEmail } from '@/lib/email';
import { applicationAcceptedEmail } from '@/lib/email-templates';
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

    // Update application status
    await sql`
      UPDATE applications
      SET status = 'accepted',
          reviewed_by = ${userId},
          reviewed_at = now(),
          review_notes = ${reviewNotes || null}
      WHERE id = ${id}
    `;

    // Create or find existing tenant
    const slug = slugify(app.companyName);
    let tenantId: string;
    const [existingTenant] = await sql<{ id: string }[]>`
      SELECT id FROM tenants WHERE slug = ${slug} LIMIT 1
    `;
    if (existingTenant) {
      tenantId = existingTenant.id;
    } else {
      const [newTenant] = await sql<{ id: string }[]>`
        INSERT INTO tenants (name, slug, status)
        VALUES (${app.companyName}, ${slug}, 'active')
        RETURNING id
      `;
      tenantId = newTenant.id;
    }

    // Create or find existing user, reset temp password for re-acceptance
    const tempPw = crypto.randomUUID().slice(0, 12);
    const hash = await bcrypt.hash(tempPw, 12);
    let newUserId: string;

    const [existingUser] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE LOWER(email) = ${app.contactEmail.toLowerCase().trim()} LIMIT 1
    `;
    if (existingUser) {
      newUserId = existingUser.id;
      await sql`
        UPDATE users
        SET password_hash = ${hash},
            temp_password = true,
            tenant_id = ${tenantId},
            is_active = true
        WHERE id = ${existingUser.id}
      `;
    } else {
      const [created] = await sql<{ id: string }[]>`
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

    // Emit system event
    await emitEventSingle({
      namespace: 'identity',
      type: 'tenant.created',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: tenantId,
      payload: {
        applicationId: id,
        tenantSlug: slug,
        tenantName: app.companyName,
        userId: newUserId,
        contactEmail: app.contactEmail,
        reviewNotes: reviewNotes || null,
      },
    });

    // Send welcome email with credentials
    const loginUrl = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''}/login`;
    const emailContent = applicationAcceptedEmail({
      contactName: app.contactName,
      companyName: app.companyName,
      tempPassword: tempPw,
      tenantSlug: slug,
      loginUrl,
    });
    const emailResult = await sendEmail({
      to: app.contactEmail,
      subject: emailContent.subject,
      html: emailContent.html,
    });

    return NextResponse.json({
      data: {
        tenantId: tenantId,
        tenantSlug: slug,
        userId: newUserId,
        contactEmail: app.contactEmail,
        contactName: app.contactName,
        companyName: app.companyName,
        tempPassword: tempPw,
        emailSent: emailResult.provider !== 'skipped',
        emailProvider: emailResult.provider,
        emailError: emailResult.error ?? null,
      },
    });
  } catch (e) {
    console.error('[api/admin/applications/accept] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
