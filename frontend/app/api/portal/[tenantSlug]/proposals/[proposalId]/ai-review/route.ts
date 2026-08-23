/**
 * Manual AI (color-team) review — /api/portal/[tenantSlug]/proposals/[proposalId]/ai-review
 *
 * POST                     enqueue a color_team_reviewer task per section with content
 * POST {scope:{…}}         aim ONE reviewer at one rung of the canvas scope ladder (mig 207) —
 *                          a node, a library-derived group, a section, a page range, the document
 * POST {retryFailed:true}  re-queue ONLY the reviews whose last attempt failed, each at its own scope
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
import { getColorTeamStatus, failedReviewTargets, type FailedReviewTarget } from '@/lib/proposal-color-team';
import type { Selection } from '@/lib/canvas/scope';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/** A bounded id from a client. Canvas node/group ids are not UUIDs (`sec-1__n-4`, `g-abc-2`). */
const cleanId = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && v.length <= 200 ? v.trim() : undefined;

/**
 * Validate a client-supplied scope, or reject it.
 *
 * Returns undefined for "no scope given" (the fan-out) and null for "a scope was given and it is
 * not one" — the caller distinguishes them, so a malformed selection is a 400 rather than a silent
 * fall-through to reviewing the entire proposal. A typo that reviews forty sections instead of one
 * figure spends the tenant's whole hourly agent budget.
 */
function parseScope(raw: unknown): (Selection & { sectionId?: string }) | null | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;

  const out: Selection & { sectionId?: string } = {};
  const nodeId = cleanId(s.nodeId);
  const groupId = cleanId(s.groupId);
  const sectionId = cleanId(s.sectionId);
  if (nodeId) out.nodeId = nodeId;
  if (groupId) out.groupId = groupId;
  if (sectionId) out.sectionId = sectionId;

  if (s.pageRange != null) {
    if (typeof s.pageRange !== 'object') return null;
    const p = s.pageRange as Record<string, unknown>;
    const start = Number(p.start);
    const end = Number(p.end);
    // Bounded on both ends: `paginate` walks the document, and a range of 1..1e9 is a request to
    // scan it a billion times over.
    if (!Number.isInteger(start) || !Number.isInteger(end)
        || start < 1 || end < start || end > 10_000) return null;
    out.pageRange = { start, end };
  }

  // A body of `{scope:{}}` means the whole document — a real, deliberate level, distinct from
  // sending no scope at all (which takes the per-section fan-out).
  return out;
}

/** Turn a stored failed-review scope back into the selection that produced it. */
function selectionFromScopeRef(f: FailedReviewTarget): (Selection & { sectionId?: string }) | null {
  const ref = (f.scopeRef ?? {}) as Record<string, unknown>;
  if (f.scopeLevel === 'node') {
    const nodeId = cleanId(ref.nodeId);
    return nodeId ? { nodeId, sectionId: f.sectionId } : null;
  }
  if (f.scopeLevel === 'group') {
    const groupId = cleanId(ref.groupId);
    return groupId ? { groupId, sectionId: f.sectionId } : null;
  }
  if (f.scopeLevel === 'pages') {
    const p = ref.pages as { start?: unknown; end?: unknown } | undefined;
    const start = Number(p?.start);
    const end = Number(p?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
    return { pageRange: { start, end }, sectionId: f.sectionId };
  }
  if (f.scopeLevel === 'document') return { sectionId: f.sectionId };
  return null;
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

    let body: {
      retryFailed?: boolean;
      scope?: { nodeId?: unknown; groupId?: unknown; sectionId?: unknown; pageRange?: unknown };
    } = {};
    try { body = await request.json(); } catch { /* an empty body means "review everything" */ }

    // ── SCOPED REQUEST (mig 207) ────────────────────────────────────────────────────────────────
    // Aim ONE reviewer at one rung of the canvas scope ladder. Validated field-by-field: `scope`
    // arrives from a client, and an unchecked page range would reach `paginate()` as anything at
    // all. Nothing here is trusted to be the shape it claims.
    const scope = parseScope(body.scope);
    if (body.scope && !scope) {
      return NextResponse.json({ error: 'Invalid review scope', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (scope) {
      const result = await requestAiReview({
        proposalId, tenantId, actorId: user.id, actorEmail: user.email ?? null,
        role, source: 'portal', scope,
      });
      if (result.enqueued === 0) {
        // Not an error the customer caused — but saying "queued 0" and nothing else is exactly the
        // silence this file's history is about. Name the reason.
        return NextResponse.json({
          error: 'Nothing in that selection has text to review.', code: 'EMPTY_SCOPE',
        }, { status: 409 });
      }
      return NextResponse.json({ data: { enqueued: result.enqueued, scope: result.scope ?? null } });
    }

    // Retry re-queues ONLY the failed reviews. A blanket re-run would post a second, possibly
    // contradictory review comment on everything that already succeeded, and would spend the
    // same hourly budget that caused the failure — turning one retry into the next outage.
    //
    // A scoped failure is retried AT ITS OWN SCOPE. Re-running a failed figure review as a
    // whole-section review would answer a different question and report success for it.
    let onlySectionIds: string[] | undefined;
    let scopedRetries = 0;
    if (body.retryFailed) {
      const failed = await failedReviewTargets(proposalId);
      if (failed.length === 0) {
        return NextResponse.json({
          error: 'No failed reviews to retry.', code: 'NOTHING_TO_RETRY',
        }, { status: 409 });
      }
      onlySectionIds = [...new Set(failed.filter((f) => f.scopeLevel === 'section').map((f) => f.sectionId))];
      for (const f of failed.filter((x) => x.scopeLevel !== 'section')) {
        const sel = selectionFromScopeRef(f);
        if (!sel) continue;
        const r = await requestAiReview({
          proposalId, tenantId, actorId: user.id, actorEmail: user.email ?? null,
          role, source: 'portal', scope: sel,
        });
        scopedRetries += r.enqueued;
      }
      // Every failure was scoped — the fan-out below has nothing left to do.
      if (onlySectionIds.length === 0) {
        return NextResponse.json({ data: { enqueued: scopedRetries, retried: true } });
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
    return NextResponse.json({
      data: {
        enqueued: enqueued + scopedRetries,
        retried: !!body.retryFailed,
        ...(visual ? { visual } : {}),
      },
    });
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
