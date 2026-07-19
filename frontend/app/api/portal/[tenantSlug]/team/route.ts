import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import bcrypt from 'bcryptjs';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/team
 *
 * List all team members for this tenant (across all proposals).
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    let members: {
      id: string;
      email: string;
      name: string | null;
      role: string;
      isActive: boolean;
      lastLoginAt: string | null;
      createdAt: string;
    }[];
    try {
      members = await sql<typeof members>`
        SELECT u.id, u.email, u.name, m.role, (m.status = 'active') AS is_active,
               u.last_login_at, u.created_at
        FROM user_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ${tenantId} AND m.source IN ('home', 'manual')
        ORDER BY u.created_at ASC
      `;
    } catch (dbErr) {
      console.error('[api/portal/team] GET query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: members });
  } catch (e) {
    console.error('[api/portal/team] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/portal/[tenantSlug]/team
 *
 * Invite a new team member to the tenant (not proposal-specific).
 * Auth: tenant_admin only.
 *
 * Body: { email, name, role }
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { email?: unknown; name?: unknown; role?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const memberRole = typeof body.role === 'string' ? body.role : 'tenant_user';

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (name.length > 200) {
      return NextResponse.json({ error: 'Name exceeds maximum length (200 chars)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (email.length > 320) {
      return NextResponse.json({ error: 'Email exceeds maximum length (320 chars)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!['tenant_admin', 'tenant_user', 'partner_user'].includes(memberRole)) {
      return NextResponse.json(
        { error: 'Role must be tenant_admin, tenant_user, or partner_user', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Check if user already exists
    let existing: { id: string; tenantId: string | null } | undefined;
    try {
      [existing] = await sql<{ id: string; tenantId: string | null }[]>`
        SELECT id, tenant_id FROM users WHERE email = ${email} LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/team] POST user lookup failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (existing) {
      if (existing.tenantId === tenantId) {
        return NextResponse.json({ error: 'User is already a team member', code: 'VALIDATION_ERROR' }, { status: 409 });
      }
      return NextResponse.json(
        { error: 'User belongs to another organization', code: 'VALIDATION_ERROR' },
        { status: 409 },
      );
    }

    // ── Start event for team member invitation ────────────────────
    const startId = await emitEventStart({
      namespace: 'capture',
      type: 'team_member.invited',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { email, name, role: memberRole },
    });

    // Create new user with temp password
    const tempPassword = randomUUID().slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    let newUser: { id: string };
    try {
      [newUser] = await sql<{ id: string }[]>`
        INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password)
        VALUES (${email}, ${name || null}, ${memberRole}, ${tenantId}, ${passwordHash}, true)
        RETURNING id
      `;
    } catch (dbErr) {
      console.error('[api/portal/team] POST user insert failed:', dbErr);
      await emitEventEnd(startId, { error: { message: String(dbErr), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Materialize the login-selectable HOME membership (multi-membership identity) so
    // every user is membership-backed, not only reachable via the legacy users.tenant_id
    // read-through. ON CONFLICT reactivates a previously-deactivated one (never-delete).
    try {
      await sql`
        INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
        VALUES (${newUser.id}, ${tenantId}, ${memberRole}, 'active', 'home', ${sessionUser.id})
        ON CONFLICT (user_id, tenant_id) DO UPDATE
          SET status = 'active', role = EXCLUDED.role
          WHERE user_memberships.status <> 'active'
      `;
    } catch (dbErr) {
      // Non-fatal — the user exists; legacy read-through still grants access in transition.
      console.error('[api/portal/team] membership insert failed:', dbErr);
    }

    // Send invite email with credentials
    let teamEmailResult: { provider: string; error?: string } = { provider: 'skipped' };
    try {
      const { sendEmail } = await import('@/lib/email');
      const { collaboratorInviteEmail } = await import('@/lib/email-templates');
      const loginUrl = `${process.env.NEXTAUTH_URL || ''}/login`;
      const emailContent = collaboratorInviteEmail({
        recipientName: name,
        recipientEmail: email,
        inviterName: (session.user as { name?: string }).name || 'Your admin',
        proposalTitle: 'Team Membership',
        role: memberRole,
        permission: 'full',
        isNewUser: true,
        tempPassword,
        loginUrl,
      });
      teamEmailResult = await sendEmail({ to: email, subject: emailContent.subject, html: emailContent.html });
    } catch (e) {
      console.error('[api/portal/team] invite email failed:', e);
      teamEmailResult = { provider: 'skipped', error: e instanceof Error ? e.message : String(e) };
    }

    // Emit email delivery completion event (closed-loop)
    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'email.team_invite_delivered',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: {
          recipientEmail: email,
          userId: newUser.id,
          status: teamEmailResult.provider !== 'skipped' && !teamEmailResult.error ? 'sent' : 'failed',
          provider: teamEmailResult.provider,
          error: teamEmailResult.error ?? null,
        },
      });
    } catch {
      // Best-effort — never break the main flow
    }

    // ── End event for team member invitation ────────────────────────
    await emitEventEnd(startId, {
      result: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        userId: newUser.id,
        email,
        name,
        role: memberRole,
      },
    });

    return NextResponse.json({
      data: {
        id: newUser.id,
        email,
        name,
        role: memberRole,
      },
    });
  } catch (e) {
    console.error('[api/portal/team] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
