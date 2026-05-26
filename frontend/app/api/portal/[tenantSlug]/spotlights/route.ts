/**
 * GET  /api/portal/[tenantSlug]/spotlights — List tenant spotlights (saved search buckets)
 * POST /api/portal/[tenantSlug]/spotlights — Create a new spotlight
 *
 * Spotlights are saved search configurations that filter the opportunity feed.
 * Each has filters (program_types, agencies, naics_codes, keywords) and shows
 * a count of matching scored items.
 *
 * Auth: tenant_user or above for GET, tenant_admin or above for POST.
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
    try {
      // spotlights table: id, tenant_id, name, description, naics_codes[],
      //   keywords[], agencies[], program_types[], min_score, is_active,
      //   created_at, updated_at
      const spotlights = await sql`
        SELECT
          s.id,
          s.name,
          s.description,
          s.naics_codes,
          s.keywords,
          s.agencies,
          s.program_types,
          s.min_score,
          s.is_active,
          s.created_at,
          s.updated_at
        FROM spotlights s
        WHERE s.tenant_id = ${tenantId}::uuid
        ORDER BY s.created_at DESC
      `;

      return NextResponse.json({ data: { spotlights } });
    } catch (dbErr) {
      console.error('[portal/spotlights] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to query spotlights', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
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
      description?: string;
      program_types?: string[];
      agencies?: string[];
      naics_codes?: string[];
      keywords?: string[];
      min_score?: number;
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
    try {
      const programTypes = Array.isArray(body.program_types) ? body.program_types : [];
      const agencies = Array.isArray(body.agencies) ? body.agencies : [];
      const naicsCodes = Array.isArray(body.naics_codes) ? body.naics_codes : [];
      const keywords = Array.isArray(body.keywords) ? body.keywords : [];
      const minScore = typeof body.min_score === 'number' ? body.min_score : 0;

      const [spotlight] = await sql<{
        id: string;
        name: string;
        createdAt: string;
      }[]>`
        INSERT INTO spotlights (
          tenant_id, name, description, program_types, agencies,
          naics_codes, keywords, min_score
        ) VALUES (
          ${tenantId}::uuid,
          ${body.name},
          ${body.description ?? null},
          ${sql.array(programTypes)},
          ${sql.array(agencies)},
          ${sql.array(naicsCodes)},
          ${sql.array(keywords)},
          ${minScore}
        )
        RETURNING id, name, created_at
      `;

      try {
        await emitEventSingle({
          namespace: 'capture',
          type: 'saved_search.created',
          actor: userActor(sessionUser.id, sessionUser.email),
          tenantId,
          payload: { spotlightId: spotlight.id, name: body.name },
        });
      } catch (evtErr) {
        console.error('[portal/spotlights] event emission failed:', evtErr);
      }

      return NextResponse.json(
        { data: { id: spotlight.id, name: spotlight.name, created_at: spotlight.createdAt } },
        { status: 201 },
      );
    } catch (dbErr) {
      console.error('[portal/spotlights/create] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to create spotlight', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/spotlights/create] error:', err);
    return NextResponse.json(
      { error: 'Failed to create spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
