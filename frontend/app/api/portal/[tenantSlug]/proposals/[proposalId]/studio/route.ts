/**
 * Proposal Studio — the 3-phase (Draft → Refine → Compliance) gated draft workflow.
 *
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/studio
 *   Body: { action: 'start' | 'regenerate' | 'approve', guidance?: string, auto?: boolean }
 *   - start      → begin phase 1 (Draft). auto:true runs all 3 loops back-to-back (the doorbell path).
 *   - regenerate → re-run the CURRENT phase, threading the admin's review comments as `guidance`.
 *   - approve    → advance to the next phase (or, after Compliance, mark 'complete').
 *   All go through requestReviewPhase → emit proposal:review_phase.requested. Advisory: phases land in
 *   review-staged canvas_versions; the Studio never advances a stage, locks, or submits.
 *
 * GET returns { studioPhase, studioPhaseStatus, studioAuto } for the wizard.
 *
 * Auth: tenant_admin or above with tenant access (rfp/master admins via their shadow membership).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import {
  requestReviewPhase,
  STUDIO_PHASES,
  NEXT_STUDIO_PHASE,
  type StudioPhase,
} from '@/lib/proposal-studio';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

async function resolve(ctx: RouteContext) {
  const { tenantSlug, proposalId } = await ctx.params;
  if (!isValidUUID(proposalId)) {
    return { error: NextResponse.json({ error: 'Invalid proposal ID', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  }
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const user = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(user.role) ? user.role : null;
  if (!role || !user.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(user.id, role, tenantId);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  enterTenant(tenantId);
  return { user: { id: user.id, email: user.email ?? null, role }, tenantId, proposalId };
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const r = await resolve(ctx);
    if ('error' in r) return r.error;
    const { tenantId, proposalId } = r;
    let rows: { studioPhase: string | null; studioPhaseStatus: string | null; studioAuto: boolean }[];
    try {
      rows = await sql`
        SELECT studio_phase AS "studioPhase", studio_phase_status AS "studioPhaseStatus", studio_auto AS "studioAuto"
        FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[studio] GET failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (rows.length === 0) return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ data: rows[0] });
  } catch (e) {
    console.error('[studio] GET error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const r = await resolve(ctx);
    if ('error' in r) return r.error;
    const { user, tenantId, proposalId } = r;

    let body: { action?: unknown; guidance?: unknown; auto?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const action = body.action;
    if (action !== 'start' && action !== 'regenerate' && action !== 'approve') {
      return NextResponse.json({ error: "action must be 'start', 'regenerate', or 'approve'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const auto = body.auto === true;
    let guidance: string | null = null;
    if (body.guidance !== undefined && body.guidance !== null) {
      if (typeof body.guidance !== 'string') {
        return NextResponse.json({ error: 'guidance must be a string', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      guidance = body.guidance.trim().slice(0, 8000) || null;
    }

    // Fetch the proposal (tenant-scoped) + its current phase.
    let proposal: { opportunityId: string | null; studioPhase: string | null } | undefined;
    try {
      [proposal] = await sql<{ opportunityId: string | null; studioPhase: string | null }[]>`
        SELECT opportunity_id AS "opportunityId", studio_phase AS "studioPhase"
        FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[studio] POST fetch failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });

    const current = STUDIO_PHASES.includes(proposal.studioPhase as StudioPhase) ? (proposal.studioPhase as StudioPhase) : null;

    // Resolve the target phase for this action.
    let target: StudioPhase | 'complete';
    if (action === 'start') {
      target = 'draft';
    } else if (action === 'regenerate') {
      if (!current) return NextResponse.json({ error: 'No active Studio phase to regenerate; start first', code: 'CONFLICT' }, { status: 409 });
      target = current;
    } else {
      // approve → advance
      if (!current) return NextResponse.json({ error: 'No active Studio phase to approve; start first', code: 'CONFLICT' }, { status: 409 });
      target = NEXT_STUDIO_PHASE[current];
    }

    // Terminal: approve past Compliance → mark complete (no phase to run).
    if (target === 'complete') {
      try {
        await sql`UPDATE proposals SET studio_phase = 'complete', studio_phase_status = NULL, studio_auto = false WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid`;
      } catch (e) {
        console.error('[studio] complete update failed', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      return NextResponse.json({ data: { phase: 'complete', status: null } });
    }

    try {
      await requestReviewPhase({
        proposalId,
        tenantId,
        opportunityId: proposal.opportunityId,
        phase: target,
        auto: action === 'start' ? auto : false,
        guidance: action === 'regenerate' ? guidance : null,
        actorId: user.id,
        actorEmail: user.email,
        role: user.role,
        source: 'studio_portal',
      });
    } catch (e) {
      console.error('[studio] requestReviewPhase failed', e);
      return NextResponse.json({ error: 'Studio phase request failed', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { phase: target, status: 'running', auto: action === 'start' ? auto : false } });
  } catch (e) {
    console.error('[studio] POST error', e);
    return NextResponse.json({ error: 'Studio phase request failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
