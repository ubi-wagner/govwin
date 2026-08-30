/**
 * GET /api/portal/[tenantSlug]/cards
 *
 * The tenant's opportunity pipeline — its denormalized thin cards (mig 094),
 * read RLS-scoped via withTenant() (SET LOCAL app.tenant_id). Every card is a
 * self-contained snapshot from the bridge; no JOIN to global opportunities.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { reconcileTenant } from '@/lib/opportunity-bridge';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Read-repair: catch this tenant's mirror up to the bridge head before serving. The forward-only
    // fan-out only reaches tenants that existed at push time, so a tenant created after a push (or
    // whose creation-time backfill failed) would otherwise show a permanently empty feed. Idempotent
    // + cheap (usually zero missed heads); best-effort so it never blocks the feed.
    try { await reconcileTenant(tenantId); } catch (e) { console.error('[portal/cards] reconcile (non-fatal)', e); }

    const url = new URL(request.url);
    const includeClosed = url.searchParams.get('includeClosed') === 'true';
    const includePassed = url.searchParams.get('includePassed') === 'true';
    const pinnedOnly = url.searchParams.get('pinned') === 'true';

    try {
      const { cards, buckets } = await withTenant(tenantId, async (tx) => {
        // Explicit tenant predicate (belt) + RLS (suspenders — the app runs as govtech_app, so
        // RLS scopes it too).
        // top_score = the card's best score across the tenant's buckets (mig 096),
        // so the pipeline is actually ranked (pinned first, then score, then recency)
        // — not just recency with a "ranked by your buckets" label.
        const cards = await tx`
          SELECT c.id, c.opportunity_id, c.card, c.bridge_version, c.lifecycle_status, c.submission_stage, c.pursuit_status,
                 c.docs_copied, c.docs_update_available, c.docs_copied_at, c.created_at, c.updated_at,
                 bs.top_score, bs.top_bucket_id,
                 COALESCE(rk.rankings, '[]'::json) AS rankings,
                 fit.fit_output AS "fitOutput"
          FROM tenant_opportunity_cards c
          LEFT JOIN LATERAL (
            SELECT s.score AS top_score, s.bucket_id AS top_bucket_id
            FROM tenant_bucket_scores s
            WHERE s.tenant_id = c.tenant_id AND s.opportunity_id = c.opportunity_id
            ORDER BY s.score DESC
            LIMIT 1
          ) bs ON true
          LEFT JOIN LATERAL (
            -- The per-bucket ranking array: one card, N lenses (bucket id · name · summary · score).
            SELECT json_agg(json_build_object(
                     'bucketId', b.id, 'name', b.name, 'summary', b.description, 'score', s.score
                   ) ORDER BY s.score DESC) AS rankings
            FROM tenant_bucket_scores s
            JOIN tenant_spotlight_buckets b ON b.id = s.bucket_id AND b.is_active
            WHERE s.tenant_id = c.tenant_id AND s.opportunity_id = c.opportunity_id
          ) rk ON true
          LEFT JOIN LATERAL (
            -- The latest opportunity_analyst "why it fits" assessment for this card (its output.text
            -- is a match analysis). Null until the pipeline runs the agent on deploy — the card
            -- degrades gracefully. Tenant-scoped via q.tenant_id + the withTenant RLS context.
            SELECT r.output AS fit_output
            FROM agent_task_queue q JOIN agent_task_results r ON r.task_id = q.id
            WHERE q.tenant_id = c.tenant_id AND q.agent_role = 'opportunity_analyst' AND q.status = 'completed'
              AND q.input->>'opportunityId' = c.opportunity_id::text
            ORDER BY r.created_at DESC LIMIT 1
          ) fit ON true
          WHERE c.tenant_id = ${tenantId}::uuid
            ${/* "Include closed" means closed, not archived. lifecycle_status is exactly
                  ('open','closed','archived'), so unchecked = open only. This used to read
                  <> 'archived', which let every admin-closed card through a filter whose label
                  promised to hide them — and since cards are not an archive target, it excluded
                  a state nothing produces. The date-derived closure (closeDate in the past on a
                  still-'open' card) is filtered client-side, where the badge computes it. */
              includeClosed ? tx`` : tx`AND c.lifecycle_status = 'open'`}
            ${includePassed ? tx`` : tx`AND c.pursuit_status <> 'passed'`}
            ${pinnedOnly ? tx`AND c.docs_copied = true` : tx``}
          ORDER BY c.docs_copied DESC, bs.top_score DESC NULLS LAST, c.updated_at DESC
          LIMIT 1000
        `;
        // The tenant's active buckets — the single mirror-OPP list carries a per-card `rankings`
        // array keyed by bucketId, and this catalog lets the client offer "rank by bucket N"
        // (re-sort the one list by a chosen lens; default stays best-across-buckets).
        const buckets = await tx`
          SELECT id, name FROM tenant_spotlight_buckets
          WHERE tenant_id = ${tenantId}::uuid AND is_active ORDER BY created_at ASC`;
        return { cards, buckets };
      });
      return NextResponse.json({ data: { cards, buckets } });
    } catch (dbErr) {
      console.error('[portal/cards] query failed', dbErr);
      return NextResponse.json({ error: 'Failed to load cards', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[portal/cards] error', err);
    return NextResponse.json({ error: 'Failed to load cards', code: 'DB_ERROR' }, { status: 500 });
  }
}
