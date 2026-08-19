/**
 * Manual AI (color-team) review — /api/portal/[tenantSlug]/proposals/[proposalId]/ai-review
 *
 * POST                     enqueue a color_team_reviewer task per section with content
 * POST {retryFailed:true}  re-queue ONLY the sections whose last review failed
 * GET                      what actually happened to those reviews
 *
 * The reviews land as `ai_review` comments in each section's context-box thread. Advisory — never
 * edits, advances, locks, or submits. Funnels through requestAiReview so the portal button and the
 * admin doorbell produce one auditable trail.
 *
 * WHY GET EXISTS. POST returned `{ enqueued }` and that was the last thing the customer ever heard.
 * A task that fails afterwards — most often the fabric's hourly rate limit, which on this database
 * killed 36 of 68 queued reviews — surfaced nowhere at all. No comment, no error, no retry: from
 * the customer's side identical to "the reviewer had nothing to say", which invites shipping an
 * unreviewed section believing it passed. GET reports per-section state and the reason for every
 * failure; retryFailed re-queues just those.
 *
 * Auth: tenant_admin or above with tenant access (rfp/master admins via their shadow membership).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { requestAiReview } from '@/lib/proposal-ai-review';
import { getColorTeamStatus, failedReviewSectionIds } from '@/lib/proposal-color-team';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
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

    let body: { retryFailed?: boolean } = {};
    try { body = await request.json(); } catch { /* an empty body means "review everything" */ }

    // Retry re-queues ONLY the failed sections. A blanket re-run would post a second, possibly
    // contradictory review comment on every section that already succeeded, and would spend the
    // same hourly budget that caused the failure — turning one retry into the next outage.
    let onlySectionIds: string[] | undefined;
    if (body.retryFailed) {
      onlySectionIds = await failedReviewSectionIds(proposalId);
      if (onlySectionIds.length === 0) {
        return NextResponse.json({
          error: 'No failed reviews to retry.', code: 'NOTHING_TO_RETRY',
        }, { status: 409 });
      }
    }

    const { enqueued, visual } = await requestAiReview({
      proposalId,
      tenantId,
      actorId: user.id,
      actorEmail: user.email ?? null,
      role,
      source: 'portal',
      onlySectionIds,
    });

    // `visual` reports the pass that LOOKED at the rendered volumes, alongside the per-section
    // text reviewers `enqueued` counts. Surfaced so the caller can say what actually ran — a review
    // that silently did half its job is the thing this whole pass exists to stop.
    return NextResponse.json({ data: { enqueued, retried: !!body.retryFailed, ...(visual ? { visual } : {}) } });
  } catch (e) {
    console.error('[ai-review] POST error', e);
    return NextResponse.json({ error: 'AI review request failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}


export async function GET(_request: Request, ctx: RouteContext) {
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
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(user.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId);

    // Never trust the id alone — the proposal must belong to THIS tenant.
    let exists: { id: string }[];
    try {
      exists = await sql`SELECT id FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[ai-review] GET proposal check failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (exists.length === 0) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ data: await getColorTeamStatus(proposalId) });
  } catch (e) {
    console.error('[ai-review] GET error', e);
    return NextResponse.json({ error: 'Could not read the review status', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
