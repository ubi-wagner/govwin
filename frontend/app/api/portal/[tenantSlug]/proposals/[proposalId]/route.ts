import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';

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

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Load proposal with opportunity context ──────────────────────
    const [proposal] = await sql<{
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

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Load sections ───────────────────────────────────────────────
    const sections = await sql<{
      id: string;
      sectionNumber: string;
      title: string;
      status: string;
      pageAllocation: number | null;
      version: number;
    }[]>`
      SELECT
        ps.id,
        ps.section_number,
        ps.title,
        ps.status,
        ps.page_allocation,
        ps.version
      FROM proposal_sections ps
      WHERE ps.proposal_id = ${proposalId}
      ORDER BY ps.section_number ASC
    `;

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
          pageAllocation: s.pageAllocation,
          version: s.version,
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
