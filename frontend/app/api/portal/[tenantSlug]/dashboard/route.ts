/**
 * GET /api/portal/[tenantSlug]/dashboard
 *
 * Returns tenant dashboard stats: proposal counts, matched opportunities,
 * library unit count, team members, recent proposals, and recent activity.
 *
 * Auth: tenant_user or above with tenant access.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Tenant lookup + access ───────────────────────────────────
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    enterTenant(tenantId); // RLS choke point

    // ── Business logic ───────────────────────────────────────────
    try {
      // Fetch full tenant row for dashboard header
      const [tenantRow] = await sql<{
        name: string;
        slug: string;
        productTier: string | null;
        subscriptionStatus: string | null;
        lifecycleStage: string | null;
      }[]>`
        SELECT name, slug, product_tier, subscription_status, lifecycle_stage
        FROM tenants WHERE id = ${tenantId}::uuid
      `;

      // Active proposals count (stage != 'archived')
      const [proposalCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM proposals
        WHERE tenant_id = ${tenantId}::uuid AND stage != 'archived'
      `;

      // Matched opportunities count (greenfield card pipeline; exclude passed/dismissed/archived)
      const [opportunityCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM tenant_opportunity_cards
        WHERE tenant_id = ${tenantId}::uuid
          AND lifecycle_status <> 'archived'
          AND archived_at IS NULL
          AND (pursuit_status IS NULL OR pursuit_status NOT IN ('passed', 'dismissed'))
      `;

      // Library units count
      const [libraryCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM library_atoms
        WHERE tenant_id = ${tenantId}::uuid AND vault_id IS NULL AND archived_at IS NULL
      `;

      // Team members count
      const [teamCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM users
        WHERE tenant_id = ${tenantId}::uuid AND is_active = true
      `;

      // Recent proposals (top 5)
      const recentProposals = await sql<{
        id: string;
        title: string;
        stage: string;
        updatedAt: string;
      }[]>`
        SELECT id, title, stage, updated_at
        FROM proposals
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY updated_at DESC
        LIMIT 5
      `;

      // Recent activity (top 10 system_events)
      const recentActivity = await sql<{
        type: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }[]>`
        SELECT type, payload, created_at
        FROM system_events
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY created_at DESC
        LIMIT 10
      `;

      const activityItems = recentActivity.map((e) => ({
        type: e.type,
        description: (e.payload as Record<string, unknown>)?.title
          ?? (e.payload as Record<string, unknown>)?.summary
          ?? e.type,
        created_at: e.createdAt,
      }));

      return NextResponse.json({
        data: {
          tenant: {
            name: tenantRow?.name ?? null,
            slug: tenantRow?.slug ?? tenantSlug,
            tier: tenantRow?.productTier ?? null,
            subscription_status: tenantRow?.subscriptionStatus ?? null,
            lifecycle_stage: tenantRow?.lifecycleStage ?? null,
          },
          stats: {
            active_proposals: parseInt(proposalCount.count, 10),
            matched_opportunities: parseInt(opportunityCount.count, 10),
            library_units: parseInt(libraryCount.count, 10),
            team_members: parseInt(teamCount.count, 10),
          },
          recent_proposals: recentProposals.map((p) => ({
            id: p.id,
            title: p.title,
            stage: p.stage,
            updated_at: p.updatedAt,
          })),
          recent_activity: activityItems,
        },
      });
    } catch (dbErr) {
      console.error('[portal/dashboard] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Dashboard query failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/dashboard] error:', err);
    return NextResponse.json(
      { error: 'Dashboard query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
