/**
 * GET   /api/portal/[tenantSlug]/agents/config — Read tenant agent config
 * PATCH /api/portal/[tenantSlug]/agents/config — Update tenant agent config
 *
 * Tenant-level agent configuration: which agents are enabled, model
 * preferences, budget limits, etc.
 *
 * Auth: tenant_admin or above with tenant access.
 *
 * V1 TODO (P2-18): Implement agent configuration CRUD.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // TODO: Implement agent config read
    //
    // SELECT * FROM agent_configs WHERE tenant_id = ${tenantId}::uuid
    // If no row exists, return default config.

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-18',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/agents/config/get] error:', err);
    return NextResponse.json(
      { error: 'Failed to read agent config', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // TODO: Implement agent config update
    // Parse body, validate config keys, upsert agent_configs row

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-18',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/agents/config/patch] error:', err);
    return NextResponse.json(
      { error: 'Failed to update agent config', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
