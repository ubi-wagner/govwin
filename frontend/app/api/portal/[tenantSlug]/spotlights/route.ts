/**
 * GET  /api/portal/[tenantSlug]/spotlights — List tenant spotlights (saved search buckets)
 * POST /api/portal/[tenantSlug]/spotlights — Create a new spotlight
 *
 * Spotlights are saved search configurations that filter the opportunity feed.
 * Each has filters (program_types, agencies, naics_codes, keywords) and shows
 * a count of matching scored items.
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-06): Implement spotlight CRUD.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

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

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Tenant lookup + access ───────────────────────────────────
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

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement spotlight listing
    //
    // SELECT s.id, s.name, s.filters, s.created_at, s.updated_at,
    //        (SELECT count(*)::int FROM tenant_pipeline_items tpi
    //         JOIN opportunities o ON o.id = tpi.opportunity_id
    //         WHERE tpi.tenant_id = s.tenant_id
    //           AND <apply s.filters against o columns>) AS item_count
    // FROM spotlights s
    // WHERE s.tenant_id = ${tenantId}::uuid
    // ORDER BY s.created_at DESC

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-06',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/spotlights] error:', err);
    return NextResponse.json(
      { error: 'Failed to query spotlights', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, ctx: RouteContext) {
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
      email?: string;
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

    // ── Tenant lookup + access ───────────────────────────────────
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

    // ── Input validation ─────────────────────────────────────────
    let body: {
      name?: string;
      filters?: {
        program_types?: string[];
        agencies?: string[];
        naics_codes?: string[];
        keywords?: string[];
      };
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'name (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement spotlight creation
    //
    // INSERT INTO spotlights (id, tenant_id, name, filters, created_at, updated_at)
    // VALUES (gen_random_uuid(), ${tenantId}::uuid, ${body.name}, ${JSON.stringify(body.filters)}::jsonb, now(), now())
    // RETURNING id, name, filters, created_at
    //
    // Emit event:
    // await emitEventSingle({ namespace: 'capture', type: 'spotlight.created', ... })

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-06',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/spotlights/create] error:', err);
    return NextResponse.json(
      { error: 'Failed to create spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
