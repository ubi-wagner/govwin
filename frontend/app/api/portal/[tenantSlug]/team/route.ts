import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
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

    const members = await sql<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      isActive: boolean;
      lastLoginAt: string | null;
      createdAt: string;
    }[]>`
      SELECT id, email, name, role, is_active, last_login_at, created_at
      FROM users
      WHERE tenant_id = ${tenantId}
        AND is_active = true
      ORDER BY created_at ASC
    `;

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

    if (!['tenant_admin', 'tenant_user', 'partner_user'].includes(memberRole)) {
      return NextResponse.json(
        { error: 'Role must be tenant_admin, tenant_user, or partner_user', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Check if user already exists
    const [existing] = await sql<{ id: string; tenantId: string | null }[]>`
      SELECT id, tenant_id FROM users WHERE email = ${email} LIMIT 1
    `;

    if (existing) {
      if (existing.tenantId === tenantId) {
        return NextResponse.json({ error: 'User is already a team member', code: 'VALIDATION_ERROR' }, { status: 409 });
      }
      return NextResponse.json(
        { error: 'User belongs to another organization', code: 'VALIDATION_ERROR' },
        { status: 409 },
      );
    }

    // Create new user with temp password
    const tempPassword = randomUUID().slice(0, 12);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const [newUser] = await sql<{ id: string }[]>`
      INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password)
      VALUES (${email}, ${name || null}, ${memberRole}, ${tenantId}, ${passwordHash}, true)
      RETURNING id
    `;

    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.team_member_invited',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
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
