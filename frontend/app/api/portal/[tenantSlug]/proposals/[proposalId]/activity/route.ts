import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

const VALID_ACTIVITY_TYPES = [
  'section_edited', 'section_saved', 'section_reverted',
  'section_assigned', 'section_unassigned',
  'stage_advanced', 'stage_reverted',
  'proposal_locked', 'proposal_unlocked',
  'collaborator_invited', 'collaborator_removed',
  'collaborator_access_changed',
  'comment_added', 'comment_resolved',
  'ai_draft_requested', 'ai_review_requested',
  'compliance_checked',
  'outcome_recorded',
  'document_uploaded', 'document_deleted',
  'proposal_created', 'proposal_exported',
] as const;

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/activity
 *
 * Returns the activity log for this proposal.
 * Query params:
 *   ?limit=50        — max rows to return (default 50, max 200)
 *   ?offset=0        — pagination offset (default 0)
 *   ?type=section_saved  — filter by activity_type
 *   ?actor=<uuid>    — filter by actor_id
 *
 * Auth: any tenant member with access.
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
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

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
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
        { error: 'Tenant access denied', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Verify proposal belongs to tenant ────────────────────────────
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/activity] proposal query failed:', dbErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Proposal-level access check for non-admin users ─────────────
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      try {
        const [collab] = await sql<{ userId: string }[]>`
          SELECT user_id FROM proposal_collaborators
          WHERE proposal_id = ${proposalId}::uuid AND user_id = ${sessionUser.id}::uuid
          LIMIT 1
        `;
        if (!collab) {
          return NextResponse.json(
            { error: 'You are not a collaborator on this proposal', code: 'FORBIDDEN' },
            { status: 403 },
          );
        }
      } catch (e) {
        console.error('[api/portal/proposals/activity] collaborator check failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }

    // ── Parse query params ──────────────────────────────────────────
    const url = new URL(request.url);
    const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
    const offset = Math.max(rawOffset, 0);
    const typeFilter = url.searchParams.get('type');
    const actorFilter = url.searchParams.get('actor');

    // Validate type filter
    if (typeFilter && !(VALID_ACTIVITY_TYPES as readonly string[]).includes(typeFilter)) {
      return NextResponse.json(
        { error: 'Invalid activity type', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate actor filter
    if (actorFilter && !isValidUUID(actorFilter)) {
      return NextResponse.json(
        { error: 'Invalid actor ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Query activity log ──────────────────────────────────────────
    let activities: {
      id: string;
      proposalId: string;
      actorId: string | null;
      actorEmail: string | null;
      actorRole: string | null;
      activityType: string;
      sectionId: string | null;
      sectionTitle: string | null;
      details: Record<string, unknown>;
      entityVersion: number | null;
      createdAt: Date;
    }[];
    let total: number;

    try {
    if (typeFilter && actorFilter) {
      activities = await sql<typeof activities>`
        SELECT id, proposal_id, actor_id, actor_email, actor_role,
               activity_type, section_id, section_title, details,
               entity_version, created_at
        FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND activity_type = ${typeFilter}
          AND actor_id = ${actorFilter}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const [countRow] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND activity_type = ${typeFilter}
          AND actor_id = ${actorFilter}::uuid
      `;
      total = parseInt(countRow.count, 10);
    } else if (typeFilter) {
      activities = await sql<typeof activities>`
        SELECT id, proposal_id, actor_id, actor_email, actor_role,
               activity_type, section_id, section_title, details,
               entity_version, created_at
        FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND activity_type = ${typeFilter}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const [countRow] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND activity_type = ${typeFilter}
      `;
      total = parseInt(countRow.count, 10);
    } else if (actorFilter) {
      activities = await sql<typeof activities>`
        SELECT id, proposal_id, actor_id, actor_email, actor_role,
               activity_type, section_id, section_title, details,
               entity_version, created_at
        FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND actor_id = ${actorFilter}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const [countRow] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND actor_id = ${actorFilter}::uuid
      `;
      total = parseInt(countRow.count, 10);
    } else {
      activities = await sql<typeof activities>`
        SELECT id, proposal_id, actor_id, actor_email, actor_role,
               activity_type, section_id, section_title, details,
               entity_version, created_at
        FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const [countRow] = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM proposal_activity_log
        WHERE proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
      `;
      total = parseInt(countRow.count, 10);
    }
    } catch (dbErr) {
      console.error('[api/portal/proposals/activity] activity query failed:', dbErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        activities: activities.map((a) => ({
          id: a.id,
          proposalId: a.proposalId,
          actorId: a.actorId,
          actorEmail: a.actorEmail,
          actorRole: a.actorRole,
          activityType: a.activityType,
          sectionId: a.sectionId,
          sectionTitle: a.sectionTitle,
          details: a.details,
          entityVersion: a.entityVersion,
          createdAt: a.createdAt,
        })),
        total,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/activity] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
