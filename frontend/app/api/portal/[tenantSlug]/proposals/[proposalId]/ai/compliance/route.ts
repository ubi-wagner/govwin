/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance
 *
 * Check section content against solicitation compliance variables.
 * More targeted than full AI review — returns pass/fail per variable
 * with excerpts showing where each requirement is addressed.
 *
 * Body: { sectionId: string }
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-13): Implement compliance check with Claude.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;

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

    // ── Input validation ─────────────────────────────────────────
    let body: { sectionId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!body.sectionId || typeof body.sectionId !== 'string') {
      return NextResponse.json(
        { error: 'sectionId (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement compliance check
    //
    // 1. Verify proposal + section belong to tenant
    // 2. Fetch section content
    // 3. Fetch solicitation_compliance variables for this proposal's solicitation:
    //    SELECT * FROM solicitation_compliance WHERE solicitation_id = $1
    // 4. Fetch compliance_variables master list for label/description
    // 5. Build prompt: for each compliance variable, does the section text
    //    address this requirement? Extract the relevant excerpt.
    // 6. Call Claude (Haiku for speed — this is a classification task)
    // 7. Return structured result:
    //    { data: {
    //      sectionId, totalVariables, passed, failed, partial,
    //      checks: [{
    //        variableName, variableLabel, status: 'pass'|'fail'|'partial',
    //        excerpt: string|null, suggestion: string|null
    //      }]
    //    }}

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-13',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/proposals/ai/compliance] error:', err);
    return NextResponse.json(
      { error: 'Compliance check failed', code: 'AI_ERROR' },
      { status: 500 },
    );
  }
}
