/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/review
 *
 * Queue AI review jobs for proposal sections. For each section with content,
 * create a pipeline job that will evaluate quality and compliance via Claude.
 *
 * Body: { sectionId?: string, reviewType?: 'quality' | 'compliance' | 'both' }
 *   - If sectionId provided, only review that one section
 *   - If omitted, queue review for all sections with content
 *
 * Auth: tenant_user or above with tenant access.
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

    const reviewType = body.reviewType ?? 'both';
    if (!['quality', 'compliance', 'both'].includes(reviewType)) {
      return NextResponse.json(
        { error: 'reviewType must be quality, compliance, or both', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    try {
      // Verify proposal belongs to this tenant
      const [proposal] = await sql<{
        id: string;
        title: string;
        solicitationId: string | null;
      }[]>`
        SELECT id, title, solicitation_id
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
      `;

      if (!proposal) {
        return NextResponse.json(
          { error: 'Proposal not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      // Fetch sections to review
      let sections: { id: string; title: string; content: string | null; status: string }[];
      if (body.sectionId) {
        sections = await sql<{ id: string; title: string; content: string | null; status: string }[]>`
          SELECT id, title, content, status
          FROM proposal_sections
          WHERE id = ${body.sectionId} AND proposal_id = ${proposalId}
        `;
        if (sections.length === 0) {
          return NextResponse.json(
            { error: 'Section not found', code: 'NOT_FOUND' },
            { status: 404 },
          );
        }
      } else {
        // All sections with content
        sections = await sql<{ id: string; title: string; content: string | null; status: string }[]>`
          SELECT id, title, content, status
          FROM proposal_sections
          WHERE proposal_id = ${proposalId}
            AND content IS NOT NULL
          ORDER BY section_number ASC
        `;
      }

      // Filter to only sections that actually have content
      const reviewable = sections.filter((s) => s.content !== null && s.content.length > 0);

      if (reviewable.length === 0) {
        return NextResponse.json({
          data: { sections_queued: 0, message: 'No sections with content to review' },
        });
      }

      // This route validates the request and emits proposal.review_requested,
      // which the color_team_reviewer agent archetype handles
      // (pipeline/src/agents/archetypes/color_team_reviewer.py) once the agent
      // loop is active. It does NOT invoke a client-side review tool — there is
      // no proposal.review_section tool; section drafting/revision is the
      // separate, registered proposal.draft_section tool.
      const sectionsQueued = reviewable.length;

      // Emit event
      await emitEventSingle({
        namespace: 'proposal',
        type: 'proposal.review_requested',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: {
          proposalId,
          sectionsQueued,
          reviewType,
        },
      });

      // ── Activity log ──────────────────────────────────────────────
      try {
        await sql`
          INSERT INTO proposal_activity_log
            (proposal_id, tenant_id, actor_id, actor_email, actor_role,
             activity_type, details)
          VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                  ${sessionUser.email ?? null}, ${role},
                  'ai_review_requested',
                  ${JSON.stringify({ sections_queued: sectionsQueued, review_type: reviewType })}::jsonb)
        `;
      } catch (logErr) {
        console.error('[portal/proposals/ai/review] activity log failed', logErr);
      }

      return NextResponse.json({
        data: { sections_queued: sectionsQueued },
      });
    } catch (dbErr) {
      console.error('[portal/proposals/ai/review] DB error:', dbErr);
      return NextResponse.json(
        { error: 'AI review queuing failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/proposals/ai/review] error:', err);
    return NextResponse.json(
      { error: 'AI review failed', code: 'AI_ERROR' },
      { status: 500 },
    );
  }
}
