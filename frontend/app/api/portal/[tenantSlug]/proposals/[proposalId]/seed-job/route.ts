import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, enterTenant, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

interface Params { params: Promise<{ tenantSlug: string; proposalId: string }> }

/** GET — fetch the active seed job for a proposal (rfp_admin / master_admin only). */
export async function GET(_req: Request, { params }: Params) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

  const sessionUser = session.user as { id?: string; role?: unknown; tenantId?: string | null };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  // Reuse is now self-serve: tenant_admin+ (own tenant, verified below) — was rfp/master only.
  if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'tenant_admin')) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  const tenantId = tenant.id as string;

  if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) {
    return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
  }

  enterTenant(tenantId);

  try {
    const [job] = await sql<{
      id: string;
      status: string;
      candidateProposals: unknown;
      sourceProposalId: string | null;
      sectionMapping: unknown;
      sectionDecisions: unknown;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    }[]>`
      SELECT lsj.id, lsj.status,
             lsj.candidate_proposals AS "candidateProposals",
             lsj.source_proposal_id AS "sourceProposalId",
             lsj.section_mapping    AS "sectionMapping",
             lsj.section_decisions  AS "sectionDecisions",
             lsj.error_message      AS "errorMessage",
             lsj.created_at         AS "createdAt",
             lsj.updated_at         AS "updatedAt"
      FROM library_seed_jobs lsj
      JOIN proposals p ON p.id = lsj.proposal_id
      WHERE lsj.proposal_id = ${proposalId}::uuid
        AND lsj.tenant_id   = ${tenantId}::uuid
        AND p.tenant_id     = ${tenantId}::uuid
      ORDER BY lsj.created_at DESC
      LIMIT 1
    `;
    if (!job) return NextResponse.json({ data: null });
    return NextResponse.json({ data: job });
  } catch (e) {
    console.error('[seed-job/GET]', e);
    return NextResponse.json({ error: 'Server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
