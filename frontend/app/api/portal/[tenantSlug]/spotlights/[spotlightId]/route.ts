/**
 * GET   /api/portal/[tenantSlug]/spotlights/[spotlightId] — Spotlight detail with scored items
 * PATCH /api/portal/[tenantSlug]/spotlights/[spotlightId] — Update spotlight filters/name
 *
 * Auth: tenant_user (GET) or tenant_admin (PATCH) with tenant access.
 *
 * V1 TODO (P2-07): Implement spotlight detail and update.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; spotlightId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, spotlightId } = await ctx.params;
    if (!isValidUUID(spotlightId)) {
      return NextResponse.json(
        { error: 'Invalid spotlight ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

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

    // ── 1. Fetch spotlight + verify it belongs to this tenant ───
    let spotlight: {
      id: string;
      name: string;
      description: string | null;
      naicsCodes: string[];
      keywords: string[];
      agencies: string[];
      programTypes: string[];
      minScore: number;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    } | undefined;
    try {
      [spotlight] = await sql<{
        id: string;
        name: string;
        description: string | null;
        naicsCodes: string[];
        keywords: string[];
        agencies: string[];
        programTypes: string[];
        minScore: number;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }[]>`
        SELECT id, name, description, naics_codes, keywords, agencies,
               program_types, min_score, is_active, created_at, updated_at
        FROM spotlights
        WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/spotlights/detail] spotlight query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!spotlight) {
      return NextResponse.json(
        { error: 'Spotlight not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── 2. Fetch scored items matching spotlight filters ─────
    let items: {
      opportunityId: string;
      title: string;
      agency: string | null;
      closeDate: string | null;
      totalScore: number;
      isPinned: boolean;
      pursuitStatus: string;
      solicitationNumber: string | null;
      programType: string | null;
    }[];
    try {
      items = await sql<typeof items>`
        SELECT o.id AS opportunity_id, o.title, o.agency, o.close_date,
               tpi.total_score, tpi.is_pinned, tpi.pursuit_status,
               o.solicitation_number, o.program_type
        FROM tenant_pipeline_items tpi
        JOIN opportunities o ON o.id = tpi.opportunity_id
        WHERE tpi.tenant_id = ${tenantId}::uuid
          AND tpi.total_score >= ${spotlight.minScore}
        ORDER BY tpi.total_score DESC
        LIMIT 50
      `;
    } catch (e) {
      console.error('[portal/spotlights/detail] items query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        spotlight,
        items,
      },
    });
  } catch (err) {
    console.error('[portal/spotlights/detail] error:', err);
    return NextResponse.json(
      { error: 'Failed to query spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, spotlightId } = await ctx.params;
    if (!isValidUUID(spotlightId)) {
      return NextResponse.json(
        { error: 'Invalid spotlight ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Auth (tenant_admin required for updates) ─────────────────
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
    if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'tenant_admin')) {
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

    // ── Parse body ─────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // ── Verify spotlight exists and belongs to tenant ────────
    let existing: { id: string } | undefined;
    try {
      [existing] = await sql<{ id: string }[]>`
        SELECT id FROM spotlights
        WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/spotlights/update] spotlight query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'Spotlight not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Build SET clauses from allowed fields ────────────────
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    const naicsCodes = Array.isArray(body.naicsCodes) ? body.naicsCodes.filter((v: unknown) => typeof v === 'string') as string[] : undefined;
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter((v: unknown) => typeof v === 'string') as string[] : undefined;
    const agencies = Array.isArray(body.agencies) ? body.agencies.filter((v: unknown) => typeof v === 'string') as string[] : undefined;
    const programTypes = Array.isArray(body.programTypes) ? body.programTypes.filter((v: unknown) => typeof v === 'string') as string[] : undefined;
    const minScore = typeof body.minScore === 'number' ? body.minScore : undefined;
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined;

    if (name !== undefined && !name) {
      return NextResponse.json(
        { error: 'name cannot be empty', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // Apply updates in a single transaction to ensure atomicity
    try {
      await sql.begin(async (tx: any) => {
        if (name !== undefined) await tx`UPDATE spotlights SET name = ${name}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (description !== undefined) await tx`UPDATE spotlights SET description = ${description}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (naicsCodes !== undefined) await tx`UPDATE spotlights SET naics_codes = ${sql.array(naicsCodes)}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (keywords !== undefined) await tx`UPDATE spotlights SET keywords = ${sql.array(keywords)}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (agencies !== undefined) await tx`UPDATE spotlights SET agencies = ${sql.array(agencies)}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (programTypes !== undefined) await tx`UPDATE spotlights SET program_types = ${sql.array(programTypes)}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (minScore !== undefined) await tx`UPDATE spotlights SET min_score = ${minScore}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
        if (isActive !== undefined) await tx`UPDATE spotlights SET is_active = ${isActive}, updated_at = now() WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid`;
      });
    } catch (e) {
      console.error('[portal/spotlights/update] spotlight update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Fetch the updated spotlight to return
    let updated: {
      id: string;
      name: string;
      description: string | null;
      naicsCodes: string[];
      keywords: string[];
      agencies: string[];
      programTypes: string[];
      minScore: number;
      isActive: boolean;
      updatedAt: string;
    } | undefined;
    try {
      [updated] = await sql<{
        id: string;
        name: string;
        description: string | null;
        naicsCodes: string[];
        keywords: string[];
        agencies: string[];
        programTypes: string[];
        minScore: number;
        isActive: boolean;
        updatedAt: string;
      }[]>`
        SELECT id, name, description, naics_codes, keywords, agencies,
               program_types, min_score, is_active, updated_at
        FROM spotlights
        WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/spotlights/update] spotlight re-fetch failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { spotlight: updated } });
  } catch (err) {
    console.error('[portal/spotlights/update] error:', err);
    return NextResponse.json(
      { error: 'Failed to update spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, spotlightId } = await ctx.params;
    if (!isValidUUID(spotlightId)) {
      return NextResponse.json(
        { error: 'Invalid spotlight ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Auth (tenant_admin required for deletes) ────────────────
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
    if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'tenant_admin')) {
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

    // ── Delete spotlight ──────────────────────────────────────
    let deleted: { id: string }[];
    try {
      deleted = await sql<{ id: string }[]>`
        DELETE FROM spotlights
        WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING id
      `;
    } catch (e) {
      console.error('[portal/spotlights/delete] delete query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'Spotlight not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[portal/spotlights/delete] error:', err);
    return NextResponse.json(
      { error: 'Failed to delete spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
