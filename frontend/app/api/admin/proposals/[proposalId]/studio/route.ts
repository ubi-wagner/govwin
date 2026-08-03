/**
 * POST /api/admin/proposals/[proposalId]/studio — the Proposal Studio doorbell (full automation).
 *
 * The admin-plane "run all 3 loops automatically" trigger: starts the Studio at phase 1 (Draft) with
 * auto=true, so Draft → Refine → Compliance auto-chain with no human stop — no portal descent. Emits
 * proposal:review_phase.requested (source='studio_doorbell') via the same requestReviewPhase helper the
 * portal wizard uses. Advisory: it never advances a stage, locks, or submits. docs/PROPOSAL_STUDIO_DESIGN.md.
 *
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { requestReviewPhase } from '@/lib/proposal-studio';

interface RouteContext {
  params: Promise<{ proposalId: string }>;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, ctx: RouteContext) {
  try {
    const { proposalId } = await ctx.params;
    const session = await auth();
    const u = session?.user as { id?: string; email?: string; role?: unknown } | undefined;
    const role: Role | null = isRole(u?.role) ? (u!.role as Role) : null;
    if (!u?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!UUID_RE.test(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let proposal: { id: string; tenantId: string; opportunityId: string | null } | undefined;
    try {
      [proposal] = await sqlBypass<{ id: string; tenantId: string; opportunityId: string | null }[]>`
        SELECT id, tenant_id AS "tenantId", opportunity_id AS "opportunityId"
        FROM proposals WHERE id = ${proposalId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[admin/studio] lookup failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });

    enterTenant(proposal.tenantId);
    try {
      await requestReviewPhase({
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        opportunityId: proposal.opportunityId,
        phase: 'draft',
        auto: true,
        guidance: null,
        actorId: u.id,
        actorEmail: u.email ?? null,
        role,
        source: 'studio_doorbell',
      });
    } catch (e) {
      console.error('[admin/studio] requestReviewPhase failed', e);
      return NextResponse.json({ error: 'Studio auto-run failed', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { proposalId: proposal.id, tenantId: proposal.tenantId, phase: 'draft', auto: true } });
  } catch (e) {
    console.error('[admin/studio] error', e);
    return NextResponse.json({ error: 'Studio auto-run failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
