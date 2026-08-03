/**
 * Manual AI (color-team) review — POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai-review
 *
 * The admin-triggered analog of the on-advance AI review. Enqueues a color_team_reviewer task per
 * section with content; the reviews land as `ai_review` comments in each section's context-box thread.
 * Advisory — it never edits, advances, locks, or submits. Funnels through requestAiReview so the
 * portal button and the (future) admin doorbell produce one auditable trail.
 *
 * Auth: tenant_admin or above with tenant access (rfp/master admins via their shadow membership).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { requestAiReview } from '@/lib/proposal-ai-review';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(user.role) ? user.role : null;
    if (!role || !user.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(user.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    // Confirm the proposal belongs to this tenant (never trust the id alone).
    let exists: { id: string }[];
    try {
      exists = await sql`SELECT id FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[ai-review] proposal check failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (exists.length === 0) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const { enqueued } = await requestAiReview({
      proposalId,
      tenantId,
      actorId: user.id,
      actorEmail: user.email ?? null,
      role,
      source: 'portal',
    });

    return NextResponse.json({ data: { enqueued } });
  } catch (e) {
    console.error('[ai-review] POST error', e);
    return NextResponse.json({ error: 'AI review request failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
