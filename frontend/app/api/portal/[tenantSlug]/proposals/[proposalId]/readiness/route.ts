import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { computeSubmissionReadiness } from '@/lib/proposal/submission-readiness';

export const dynamic = 'force-dynamic';

/**
 * GET — the submission-readiness verdict for a proposal: a go / not-ready roll-up over section
 * lock state, requirement coverage, and the advisory format floor, with an actionable blocker list.
 * Read-only + advisory (computes; never locks/submits). Any member with access to the proposal.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string; proposalId: string }> },
) {
  try {
    const { tenantSlug, proposalId } = await params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyProposalAccess(u.id, role, u.tenantId, tenantId, proposalId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    let report;
    try {
      report = await computeSubmissionReadiness(proposalId, tenantId);
    } catch (e) {
      console.error('[proposals/readiness] compute failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!report) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ data: report });
  } catch (err) {
    console.error('[proposals/readiness] error:', err);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
