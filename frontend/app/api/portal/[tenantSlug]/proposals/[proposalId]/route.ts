import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]
 *
 * Returns proposal detail with sections + opportunity context.
 * Auth: tenant member access check.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    // Partner-containment: proposal-wide reads are for tenant members (tenant_user+). External
    // collaborators (partner_user) reach only their granted sections via the scoped section routes;
    // verifyTenantAccess alone is true for their collaborator membership, so it must NOT gate this.
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
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
    enterTenant(tenantId); // RLS choke point: pin tenant context in the handler's own frame

    // ── Load proposal with opportunity context ──────────────────────
    let proposal: {
      id: string;
      title: string;
      stage: string;
      isLocked: boolean;
      createdAt: Date;
      opportunityId: string;
      solicitationId: string | null;
      agency: string | null;
      topicNumber: string | null;
      closeDate: Date | null;
      programType: string | null;
      solicitationTitle: string | null;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        title: string;
        stage: string;
        isLocked: boolean;
        createdAt: Date;
        opportunityId: string;
        solicitationId: string | null;
        agency: string | null;
        topicNumber: string | null;
        closeDate: Date | null;
        programType: string | null;
        solicitationTitle: string | null;
      }[]>`
        SELECT
          p.id,
          p.title,
          p.stage,
          p.is_locked,
          p.created_at,
          p.opportunity_id,
          p.solicitation_id,
          o.agency,
          o.topic_number,
          o.close_date,
          o.program_type,
          cs.solicitation_title
        FROM proposals p
        JOIN opportunities o ON o.id = p.opportunity_id
        LEFT JOIN curated_solicitations cs ON cs.id = p.solicitation_id
        WHERE p.id = ${proposalId}
          AND p.tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/detail] proposal query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Load sections with completion markers ─────────────────────
    let sections: {
      id: string;
      sectionNumber: string;
      title: string;
      status: string;
      isLocked: boolean;
      lockedAt: Date | null;
      pageAllocation: number | null;
      version: number;
      completedStage: string | null;
      completedAt: Date | null;
      acceptedBy: string | null;
      acceptedAt: Date | null;
      acceptedByName: string | null;
    }[];
    try {
      sections = await sql<typeof sections>`
        SELECT
          ps.id,
          ps.section_number,
          ps.title,
          ps.status,
          ps.is_locked,
          ps.locked_at,
          ps.page_allocation,
          ps.version,
          ps.completed_stage,
          ps.completed_at,
          ps.accepted_by,
          ps.accepted_at,
          u.name AS accepted_by_name
        FROM proposal_sections ps
        LEFT JOIN users u ON u.id = ps.accepted_by
        WHERE ps.proposal_id = ${proposalId}
        ORDER BY ps.section_number ASC
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/detail] sections query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── Load supporting documents ──────────────────────────────────
    let supportingDocs: {
      id: string;
      requirementLabel: string;
      requirementSource: string | null;
      category: string;
      isRequired: boolean;
      storageKey: string | null;
      originalFilename: string | null;
      fileSize: number | null;
      contentType: string | null;
      status: string;
      uploadedBy: string | null;
      uploadedAt: Date | null;
      reviewedBy: string | null;
      reviewedAt: Date | null;
      notes: string | null;
    }[] = [];
    try {
      supportingDocs = await sql<typeof supportingDocs>`
        SELECT id, requirement_label, requirement_source, category, is_required,
               storage_key, original_filename, file_size, content_type,
               status, uploaded_by, uploaded_at, reviewed_by, reviewed_at, notes
        FROM proposal_supporting_docs
        WHERE proposal_id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid
        ORDER BY
          CASE category WHEN 'supporting_document' THEN 1 WHEN 'proposal_input' THEN 2 ELSE 3 END,
          requirement_label
      `;
    } catch (sdErr) {
      // Non-fatal — table may not exist yet on older deployments
      console.error('[api/portal/proposals/detail] supporting docs query failed (non-fatal):', sdErr);
    }

    // ── Load stage completion history ──────────────────────────────
    let stageSnapshots: {
      stage: string;
      completedBy: string | null;
      completedByName: string | null;
      completedAt: Date;
      totalSections: number;
      sectionsComplete: number;
      sectionsApproved: number;
      notes: string | null;
    }[] = [];
    try {
      stageSnapshots = await sql<typeof stageSnapshots>`
        SELECT scs.stage, scs.completed_by, u.name AS completed_by_name,
               scs.completed_at, scs.total_sections, scs.sections_complete,
               scs.sections_approved, scs.notes
        FROM stage_completion_snapshots scs
        LEFT JOIN users u ON u.id = scs.completed_by
        WHERE scs.proposal_id = ${proposalId}::uuid
        ORDER BY scs.completed_at ASC
      `;
    } catch (snapErr) {
      // Non-fatal — table may not exist yet on older deployments
      console.error('[api/portal/proposals/detail] stage snapshots query failed (non-fatal):', snapErr);
    }

    return NextResponse.json({
      data: {
        proposal: {
          id: proposal.id,
          title: proposal.title,
          stage: proposal.stage,
          isLocked: proposal.isLocked,
          createdAt: proposal.createdAt,
          opportunityId: proposal.opportunityId,
          solicitationId: proposal.solicitationId,
          agency: proposal.agency,
          topicNumber: proposal.topicNumber,
          closeDate: proposal.closeDate,
          programType: proposal.programType,
          solicitationTitle: proposal.solicitationTitle,
        },
        sections: sections.map((s) => ({
          id: s.id,
          sectionNumber: s.sectionNumber,
          title: s.title,
          status: s.status,
          isLocked: s.isLocked,
          lockedAt: s.lockedAt,
          pageAllocation: s.pageAllocation,
          version: s.version,
          completedStage: s.completedStage,
          completedAt: s.completedAt,
          acceptedBy: s.acceptedBy,
          acceptedByName: s.acceptedByName,
          acceptedAt: s.acceptedAt,
          // Lock is authoritative: a locked section is never editable, regardless
          // of completed_stage. (Matches the section editor page guard.)
          isEditable: !s.isLocked && (s.completedStage === null || s.completedStage === proposal.stage),
        })),
        stageCompletionHistory: stageSnapshots.map((snap) => ({
          stage: snap.stage,
          completedBy: snap.completedBy,
          completedByName: snap.completedByName,
          completedAt: snap.completedAt,
          totalSections: snap.totalSections,
          sectionsComplete: snap.sectionsComplete,
          sectionsApproved: snap.sectionsApproved,
          notes: snap.notes,
        })),
        supportingDocs: supportingDocs.map((sd) => ({
          id: sd.id,
          requirementLabel: sd.requirementLabel,
          requirementSource: sd.requirementSource,
          category: sd.category,
          isRequired: sd.isRequired,
          originalFilename: sd.originalFilename,
          fileSize: sd.fileSize,
          contentType: sd.contentType,
          status: sd.status,
          uploadedBy: sd.uploadedBy,
          uploadedAt: sd.uploadedAt,
          reviewedBy: sd.reviewedBy,
          reviewedAt: sd.reviewedAt,
          notes: sd.notes,
        })),
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/detail] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
