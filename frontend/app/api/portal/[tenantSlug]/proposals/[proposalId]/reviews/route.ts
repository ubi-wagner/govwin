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
    // Verify proposal belongs to tenant
    let proposalCheck: { id: string }[];
    try {
      proposalCheck = await sql<{ id: string }[]>`
        SELECT id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      `;
    } catch (dbErr) {
      console.error('[portal/proposals/reviews] proposal check failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (proposalCheck.length === 0) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Use proposal_comments grouped by the stage at which they were made
    let reviews;
    try {
      reviews = await sql`
        SELECT pc.id, pc.section_id, pc.user_id, pc.content, pc.resolved,
               pc.created_at, u.name AS reviewer_name,
               psh.to_stage AS review_stage
        FROM proposal_comments pc
        JOIN users u ON u.id = pc.user_id
        LEFT JOIN proposal_stage_history psh ON psh.proposal_id = pc.proposal_id
          AND psh.created_at <= pc.created_at
        WHERE pc.proposal_id = ${proposalId}::uuid
          AND pc.proposal_id IN (SELECT id FROM proposals WHERE tenant_id = ${tenantId}::uuid)
        ORDER BY pc.created_at DESC
      `;
    } catch (dbErr) {
      console.error('[portal/proposals/reviews] reviews query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { reviews } });
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

    // 1. Verify proposal belongs to tenant and is in 'review' stage
    let proposalCheck: { id: string; stage: string }[];
    try {
      proposalCheck = await sql<{ id: string; stage: string }[]>`
        SELECT id, stage FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
      `;
    } catch (dbErr) {
      console.error('[portal/proposals/reviews] POST proposal check failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (proposalCheck.length === 0) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    if (proposalCheck[0].stage !== 'review') {
      return NextResponse.json(
        { error: 'Proposal must be in review stage to create a review round', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // 2. Create a comment for each reviewer marking the review round
    const reviewerIds = body.reviewerIds ?? [];
    const notes = body.notes ?? '';

    // Record the review round in stage history as a note
    let stageEntry: { id: string };
    try {
      [stageEntry] = await sql<{ id: string }[]>`
        INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
        VALUES (${proposalId}::uuid, 'review', 'review', ${sessionUser.id}::uuid,
                ${`${body.reviewType} review round initiated. ${notes}`.trim()})
        RETURNING id
      `;
    } catch (dbErr) {
      console.error('[portal/proposals/reviews] stage history insert failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // 3. Emit event
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'review.created',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: { proposalId, reviewType: body.reviewType, reviewerIds },
      });
    } catch (evtErr) {
      console.error('[portal/proposals/reviews] event emission failed:', evtErr);
    }

    // 4. Return response
    return NextResponse.json({
      data: {
        reviewId: stageEntry.id,
        reviewType: body.reviewType,
        reviewerCount: reviewerIds.length,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[portal/proposals/reviews/create] error:', err);
    return NextResponse.json(
      { error: 'Failed to create review', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
