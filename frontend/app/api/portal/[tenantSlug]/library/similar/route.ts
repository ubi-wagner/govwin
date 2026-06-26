import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/library/similar?sectionId=&proposalId=&sort=&limit=
 *
 * "Similar sections" retrieval for the canvas picker (C4). Resolves the section's
 * C1 section_type server-side from sectionId, then returns approved library atoms
 * scoped to that section_type (the `type:<key>` tag) and/or its standard bucket
 * (subcategory), excluding atoms harvested from the current proposal, sorted by
 * the requested key. Tag/bucket-scoped now; embedding-ranked in Phase-4.
 *
 * Auth: any tenant member (read-only library access on their own tenant).
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug } = await ctx.params;
    const url = new URL(request.url);
    const sectionId = url.searchParams.get('sectionId');
    const proposalId = url.searchParams.get('proposalId');
    const sort = url.searchParams.get('sort') ?? 'outcome';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '12', 10) || 12, 1), 50);

    if (!sectionId || !isValidUUID(sectionId)) {
      return NextResponse.json({ error: 'Valid sectionId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (proposalId && !isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposalId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Resolve the section's standard classification (tenant-scoped).
    let section: { sectionType: string | null; standardCategory: string | null } | undefined;
    try {
      [section] = await sql<{ sectionType: string | null; standardCategory: string | null }[]>`
        SELECT s.section_type,
               (SELECT ss.category FROM section_standards ss WHERE ss.key = s.section_type) AS standard_category
        FROM proposal_sections s
        JOIN proposals p ON p.id = s.proposal_id
        WHERE s.id = ${sectionId}::uuid AND p.tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[library/similar] section lookup failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!section) {
      return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const sectionType = section.sectionType;
    const standardCategory = section.standardCategory;

    // Scope: atoms tagged with this section_type, or in the same standard bucket.
    // No section_type → fall back to the tenant's most recent approved atoms.
    const scope =
      sectionType && standardCategory
        ? sql`AND (tags && ${[`type:${sectionType}`]}::text[] OR subcategory = ${standardCategory})`
        : sectionType
          ? sql`AND tags && ${[`type:${sectionType}`]}::text[]`
          : standardCategory
            ? sql`AND subcategory = ${standardCategory}`
            : sql``;

    const orderBy =
      sort === 'usage'
        ? sql`ORDER BY usage_count DESC, created_at DESC`
        : sort === 'recent'
          ? sql`ORDER BY created_at DESC`
          : sql`ORDER BY outcome_score DESC NULLS LAST, usage_count DESC, created_at DESC`;

    // Exclude atoms harvested from the current proposal — only when we have one
    // (a bare `<> NULL` would null out every non-null row).
    const excludeOwn = proposalId
      ? sql`AND (original_proposal_id IS NULL OR original_proposal_id <> ${proposalId}::uuid)`
      : sql``;

    let atoms: {
      id: string;
      content: string;
      category: string;
      subcategory: string | null;
      tags: string[];
      outcomeScore: number | null;
      outcome: string | null;
      usageCount: number;
    }[];
    try {
      atoms = await sql<{
        id: string;
        content: string;
        category: string;
        subcategory: string | null;
        tags: string[];
        outcomeScore: number | null;
        outcome: string | null;
        usageCount: number;
      }[]>`
        SELECT id, content, category, subcategory, tags, outcome_score, outcome, usage_count
        FROM library_units
        WHERE tenant_id = ${tenantId}::uuid
          AND status = 'approved'
          ${scope}
          ${excludeOwn}
        ${orderBy}
        LIMIT ${limit}
      `;
    } catch (e) {
      console.error('[library/similar] atom query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        sectionType,
        standardCategory,
        sort,
        atoms: atoms.map((a) => ({
          id: a.id,
          content: a.content,
          category: a.category,
          subcategory: a.subcategory,
          tags: a.tags,
          outcomeScore: a.outcomeScore,
          outcome: a.outcome,
          usageCount: a.usageCount,
        })),
      },
    });
  } catch (e) {
    console.error('[library/similar] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
