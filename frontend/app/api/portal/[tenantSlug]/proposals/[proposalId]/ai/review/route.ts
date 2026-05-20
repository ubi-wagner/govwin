/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/review
 *
 * Run AI quality/compliance review on a proposal section. Claude evaluates
 * the section content against the RFP requirements and compliance matrix,
 * returning scores, suggestions, and specific improvement recommendations.
 *
 * Body: { sectionId: string, reviewType?: 'quality' | 'compliance' | 'both' }
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-12): Implement AI review with Claude.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

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
    let body: { sectionId?: string; reviewType?: string };
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

    const reviewType = body.reviewType ?? 'both';
    if (!['quality', 'compliance', 'both'].includes(reviewType)) {
      return NextResponse.json(
        { error: 'reviewType must be quality, compliance, or both', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement AI review
    //
    // 1. Verify proposal + section belong to tenant
    // 2. Fetch section content (canvas JSON or plain text)
    // 3. Fetch compliance requirements for this proposal's solicitation
    // 4. Build review prompt asking Claude to evaluate:
    //    - Quality: clarity, specificity, persuasiveness, page budget usage
    //    - Compliance: does each requirement have an addressed response?
    // 5. Call Claude (Sonnet for analysis)
    // 6. Parse structured response into review object:
    //    { overallScore: 0-100, qualityScore, complianceScore,
    //      issues: [{type, severity, location, description, suggestion}],
    //      strengths: [string], improvements: [string] }
    // 7. Optionally save as proposal_comments with user_id = 'ai-reviewer'
    // 8. Emit proposal:section.reviewed event
    // 9. Return { data: review }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-12',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/proposals/ai/review] error:', err);
    return NextResponse.json(
      { error: 'AI review failed', code: 'AI_ERROR' },
      { status: 500 },
    );
  }
}
