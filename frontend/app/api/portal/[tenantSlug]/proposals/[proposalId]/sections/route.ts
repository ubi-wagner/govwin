import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/sections
 *
 * List sections filtered by current user's access level.
 * Admin sees all, contributors see assigned + viewable, external sees shared only.
 * Each section includes: id, title, status, pageLimit, permission.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
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

    // Verify proposal belongs to tenant
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/sections] proposal query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Get user's access level
    const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);

    // Load all sections
    let allSections: {
      id: string;
      sectionNumber: string;
      title: string;
      status: string;
      pageAllocation: number | null;
      version: number;
      assignedTo: string | null;
      artifactId: string | null;
      volumeName: string | null;
      volumeNumber: number | null;
      isLocked: boolean;
      sectionType: string | null;
    }[];
    try {
      allSections = await sql<{
        id: string;
        sectionNumber: string;
        title: string;
        status: string;
        pageAllocation: number | null;
        version: number;
        assignedTo: string | null;
        artifactId: string | null;
        volumeName: string | null;
        volumeNumber: number | null;
        isLocked: boolean;
        sectionType: string | null;
      }[]>`
        SELECT
          id, section_number, title, status,
          page_allocation, version, assigned_to,
          artifact_id, volume_name, volume_number, is_locked, section_type
        FROM proposal_sections
        WHERE proposal_id = ${proposalId}
        ORDER BY section_number ASC
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/sections] sections query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Map sections with per-user permission
    const sections = allSections.map((section) => {
      let permission: 'edit' | 'comment' | 'view' | 'none' = 'none';

      if (access.role === 'admin') {
        permission = 'edit';
      } else if (access.editableSections.includes(section.id)) {
        permission = 'edit';
      } else if (access.commentableSections.includes(section.id)) {
        permission = 'comment';
      } else if (access.viewableSections.includes(section.id)) {
        permission = 'view';
      }

      return {
        id: section.id,
        sectionNumber: section.sectionNumber,
        title: section.title,
        status: section.status,
        pageLimit: section.pageAllocation,
        version: section.version,
        assignedTo: section.assignedTo,
        // E1/E3: artifact grouping + lock state + taxonomy for the workspace UI.
        artifactId: section.artifactId,
        volumeName: section.volumeName,
        volumeNumber: section.volumeNumber,
        isLocked: section.isLocked,
        sectionType: section.sectionType,
        permission,
      };
    });

    // partner_user: only return sections they have explicit access to.
    // tenant_admin/tenant_user: show all sections (hidden ones tagged so UI can grey them).
    // admin (resolveUserAccess): return all with full edit permission.
    const isPartner = role === 'partner_user';
    const data = access.role === 'admin'
      ? sections
      : isPartner
        ? sections.filter((s) => s.permission !== 'none')
        : sections.map((s) => ({
            ...s,
            ...(s.permission === 'none' ? { status: 'hidden' } : {}),
          }));

    return NextResponse.json({
      data: {
        sections: data,
        userRole: access.role,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/sections] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
