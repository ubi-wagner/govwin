/**
 * GET  /api/portal/[tenantSlug]/proposals/[proposalId]/reviews — List review rounds
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/reviews — Create new review round
 *
 * Color team review system: pink_team, red_team, gold_team.
 * Each round has reviewer assignments, per-section comments, and pass/fail status.
 *
 * Auth: tenant_user (GET) or tenant_admin (POST) with tenant access.
 *
 * V1 TODO (P2-14): Implement color team review CRUD.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
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

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement review listing
    //
    // This requires a reviews / review_comments schema. Options:
    // a) Use proposal_comments with a "review_round" field
    // b) Create dedicated tables: proposal_reviews + proposal_review_items
    //
    // For V1, use proposal_comments grouped by stage at which they were made:
    // SELECT pc.id, pc.section_id, pc.user_id, pc.content, pc.resolved,
    //        pc.created_at, u.name AS reviewer_name,
    //        psh.to_stage AS review_stage
    // FROM proposal_comments pc
    // JOIN users u ON u.id = pc.user_id
    // LEFT JOIN proposal_stage_history psh ON psh.proposal_id = pc.proposal_id
    //   AND psh.created_at <= pc.created_at
    // WHERE pc.proposal_id = ${proposalId}
    //   AND pc.proposal_id IN (SELECT id FROM proposals WHERE tenant_id = ${tenantId}::uuid)
    // ORDER BY pc.created_at DESC

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-14',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/proposals/reviews/list] error:', err);
    return NextResponse.json(
      { error: 'Failed to query reviews', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;

    // ── Auth (tenant_admin for creating review rounds) ───────────
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
      reviewType?: string;
      reviewerIds?: string[];
      notes?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const validReviewTypes = ['pink_team', 'red_team', 'gold_team'];
    if (!body.reviewType || !validReviewTypes.includes(body.reviewType)) {
      return NextResponse.json(
        { error: `reviewType must be one of: ${validReviewTypes.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // TODO: Implement review round creation
    //
    // 1. Verify proposal belongs to tenant and is in 'review' stage
    // 2. Create review round record (or use stage advancement as the trigger)
    // 3. Assign reviewers to sections
    // 4. Emit proposal:review.created event
    // 5. Return { data: { reviewId, reviewType, reviewerCount } }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-14',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/proposals/reviews/create] error:', err);
    return NextResponse.json(
      { error: 'Failed to create review', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
