/**
 * GET   /api/admin/tenants/[tenantId] — Full tenant details
 * PATCH /api/admin/tenants/[tenantId] — Update tenant fields
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantId } = await ctx.params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json(
        { error: 'Invalid tenant ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

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
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    try {
      // Fetch tenant details
      const [tenant] = await sql`
        SELECT
          id, slug, name, legal_name, website, status, product_tier,
          billing_email, trial_ends_at, storage_root,
          stripe_customer_id, subscription_status, lifecycle_stage,
          created_at, updated_at
        FROM tenants
        WHERE id = ${tenantId}::uuid
      `;

      if (!tenant) {
        return NextResponse.json(
          { error: 'Tenant not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      // User count
      const [userCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM users
        WHERE tenant_id = ${tenantId}::uuid AND is_active = true
      `;

      // Proposal count
      const [proposalCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM proposals
        WHERE tenant_id = ${tenantId}::uuid
      `;

      // Opportunity-card count — the canonical per-tenant opportunity surface
      // (tenant_opportunity_cards). Was tenant_pipeline_items, the RETIRED legacy
      // Spotlight/Pipeline table; the response key stays `pipeline_items` for API
      // stability but the number is now the tenant's live card count.
      const [pipelineCount] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM tenant_opportunity_cards
        WHERE tenant_id = ${tenantId}::uuid
      `;

      // Purchase stats
      const [purchaseStats] = await sql<{ count: string; totalCents: string | null }[]>`
        SELECT count(*)::text AS count, sum(amount_cents)::text AS total_cents
        FROM purchases
        WHERE tenant_id = ${tenantId}::uuid AND status = 'completed'
      `;

      return NextResponse.json({
        data: {
          tenant,
          stats: {
            users: parseInt(userCount.count, 10),
            proposals: parseInt(proposalCount.count, 10),
            pipeline_items: parseInt(pipelineCount.count, 10),
            purchases: parseInt(purchaseStats.count, 10),
            revenue_cents: parseInt(purchaseStats.totalCents ?? '0', 10),
          },
        },
      });
    } catch (dbErr) {
      console.error('[admin/tenants] GET DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to fetch tenant', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[admin/tenants] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch tenant', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { tenantId } = await ctx.params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json(
        { error: 'Invalid tenant ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

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
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse body ───────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // ── Input validation ─────────────────────────────────────────
    const allowedFields = [
      'name', 'product_tier', 'subscription_status', 'lifecycle_stage',
      'status', 'billing_email', 'legal_name', 'website',
    ];
    const updates: Array<{ field: string; value: unknown }> = [];

    for (const field of allowedFields) {
      if (field in body) {
        updates.push({ field, value: body[field] });
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate specific field values
    if ('product_tier' in body && body.product_tier !== null) {
      const validTiers = ['finder', 'reminder', 'binder', 'grinder'];
      if (!validTiers.includes(body.product_tier as string)) {
        return NextResponse.json(
          { error: `Invalid product_tier. Must be one of: ${validTiers.join(', ')}`, code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
    }

    if ('lifecycle_stage' in body && body.lifecycle_stage !== null) {
      const validStages = ['lead', 'target', 'customer', 'at_risk', 'churned'];
      if (!validStages.includes(body.lifecycle_stage as string)) {
        return NextResponse.json(
          { error: `Invalid lifecycle_stage. Must be one of: ${validStages.join(', ')}`, code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
    }

    // ── Update tenant ────────────────────────────────────────────
    try {
      // Verify tenant exists
      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM tenants WHERE id = ${tenantId}::uuid
      `;
      if (!existing) {
        return NextResponse.json(
          { error: 'Tenant not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      // ── Start event ────────────────────────────────────────────────
      const startId = await emitEventStart({
        namespace: 'finder',
        type: 'tenant.updated',
        actor: userActor(sessionUser.id as string),
        tenantId: null,
        payload: { tenantId, fields: Object.keys(body) },
      });

      // Build dynamic update — use individual SET clauses for each provided field
      // to avoid SQL injection while supporting partial updates
      const setClauses = [];
      if ('name' in body) setClauses.push(sql`name = ${body.name as string}`);
      if ('product_tier' in body) setClauses.push(sql`product_tier = ${body.product_tier as string | null}`);
      if ('subscription_status' in body) setClauses.push(sql`subscription_status = ${body.subscription_status as string | null}`);
      if ('lifecycle_stage' in body) setClauses.push(sql`lifecycle_stage = ${body.lifecycle_stage as string | null}`);
      if ('status' in body) setClauses.push(sql`status = ${body.status as string}`);
      if ('billing_email' in body) setClauses.push(sql`billing_email = ${body.billing_email as string | null}`);
      if ('legal_name' in body) setClauses.push(sql`legal_name = ${body.legal_name as string | null}`);
      if ('website' in body) setClauses.push(sql`website = ${body.website as string | null}`);
      setClauses.push(sql`updated_at = now()`);

      const setFragment = setClauses.reduce(
        (acc, fragment, i) => (i === 0 ? fragment : sql`${acc}, ${fragment}`),
      );

      const [updated] = await sql`
        UPDATE tenants
        SET ${setFragment}
        WHERE id = ${tenantId}::uuid
        RETURNING id, name, slug, status, product_tier, subscription_status, lifecycle_stage, updated_at
      `;

      await emitEventEnd(startId, {
        result: { tenantId, updatedFields: Object.keys(body) },
      });

      return NextResponse.json({ data: { tenant: updated } });
    } catch (dbErr) {
      console.error('[admin/tenants] PATCH DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to update tenant', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[admin/tenants] PATCH error:', err);
    return NextResponse.json(
      { error: 'Failed to update tenant', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
