import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { advanceProposalStage } from '@/lib/proposal-advance';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance
 *
 * Advances a proposal to the next gate in its configurable gate_config.
 * Auth: tenant_admin or higher. The advance itself (gate checks, snapshots,
 * stage history, optimistic-locking, events, activity log, AI-review-on-advance
 * enqueue) lives in the shared `advanceProposalStage` core so the manual route
 * and the lock route's auto-advance path never drift.
 *
 * Body: { targetStage?: string, notes?: string, force?: boolean }
 * If targetStage is omitted, advances to the next gate automatically.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
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

    enterTenant(tenantId);

    // ── Input ─────────────────────────────────────────────────────────
    let body: { targetStage?: unknown; notes?: unknown; force?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // No body is acceptable — will auto-advance to next gate
    }
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    // ── Advance (shared core) ──────────────────────────────────────────
    const result = await advanceProposalStage({
      tenantId,
      tenantSlug,
      proposalId,
      actorId: sessionUser.id,
      actorEmail: sessionUser.email ?? null,
      actorRole: role,
      force: !!body.force,
      notes,
      targetStage: typeof body.targetStage === 'string' ? body.targetStage : undefined,
      trigger: 'manual',
    });

    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error, code: result.code };
      if (result.details !== undefined) payload.details = result.details;
      return NextResponse.json(payload, { status: result.status });
    }

    return NextResponse.json({ data: result.data });
  } catch (e) {
    console.error('[api/portal/proposals/advance] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
