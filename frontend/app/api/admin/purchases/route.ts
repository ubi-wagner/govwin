/**
 * GET /api/admin/purchases — Cross-tenant purchase management
 *
 * Returns all purchases across tenants with tenant name, product_type,
 * amount, status. Supports date range filter.
 *
 * Auth: master_admin or rfp_admin.
 *
 * V1 TODO (P2-22): Implement purchase management query.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET(request: Request) {
  try {
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

    // ── Parse query params ───────────────────────────────────────
    const url = new URL(request.url);
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);

    // Build query based on optional date filters
    type PurchaseRow = {
      id: string;
      productType: string;
      amountCents: number;
      status: string;
      stripeSessionId: string | null;
      createdAt: string;
      tenantName: string;
      tenantSlug: string;
      proposalTitle: string | null;
      opportunityTitle: string | null;
    };

    let purchases: PurchaseRow[];

    try {
      if (startDate && endDate) {
        purchases = await sql<PurchaseRow[]>`
          SELECT pu.id, pu.product_type, pu.amount_cents, pu.status,
                 pu.stripe_session_id, pu.created_at,
                 t.name AS tenant_name, t.slug AS tenant_slug,
                 p.title AS proposal_title,
                 o.title AS opportunity_title
          FROM purchases pu
          JOIN tenants t ON t.id = pu.tenant_id
          LEFT JOIN proposals p ON p.id = pu.proposal_id
          LEFT JOIN opportunities o ON o.id = pu.opportunity_id
          WHERE pu.created_at >= ${startDate}::timestamptz
            AND pu.created_at <= ${endDate}::timestamptz
          ORDER BY pu.created_at DESC
          LIMIT ${limit}
        `;
      } else if (startDate) {
        purchases = await sql<PurchaseRow[]>`
          SELECT pu.id, pu.product_type, pu.amount_cents, pu.status,
                 pu.stripe_session_id, pu.created_at,
                 t.name AS tenant_name, t.slug AS tenant_slug,
                 p.title AS proposal_title,
                 o.title AS opportunity_title
          FROM purchases pu
          JOIN tenants t ON t.id = pu.tenant_id
          LEFT JOIN proposals p ON p.id = pu.proposal_id
          LEFT JOIN opportunities o ON o.id = pu.opportunity_id
          WHERE pu.created_at >= ${startDate}::timestamptz
          ORDER BY pu.created_at DESC
          LIMIT ${limit}
        `;
      } else if (endDate) {
        purchases = await sql<PurchaseRow[]>`
          SELECT pu.id, pu.product_type, pu.amount_cents, pu.status,
                 pu.stripe_session_id, pu.created_at,
                 t.name AS tenant_name, t.slug AS tenant_slug,
                 p.title AS proposal_title,
                 o.title AS opportunity_title
          FROM purchases pu
          JOIN tenants t ON t.id = pu.tenant_id
          LEFT JOIN proposals p ON p.id = pu.proposal_id
          LEFT JOIN opportunities o ON o.id = pu.opportunity_id
          WHERE pu.created_at <= ${endDate}::timestamptz
          ORDER BY pu.created_at DESC
          LIMIT ${limit}
        `;
      } else {
        purchases = await sql<PurchaseRow[]>`
          SELECT pu.id, pu.product_type, pu.amount_cents, pu.status,
                 pu.stripe_session_id, pu.created_at,
                 t.name AS tenant_name, t.slug AS tenant_slug,
                 p.title AS proposal_title,
                 o.title AS opportunity_title
          FROM purchases pu
          JOIN tenants t ON t.id = pu.tenant_id
          LEFT JOIN proposals p ON p.id = pu.proposal_id
          LEFT JOIN opportunities o ON o.id = pu.opportunity_id
          ORDER BY pu.created_at DESC
          LIMIT ${limit}
        `;
      }
    } catch (err) {
      console.error('[PURCHASES] DB query failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }

    // Summary stats
    let summary: { totalCents: string; purchaseCount: number }[];
    try {
      summary = await sql<{ totalCents: string; purchaseCount: number }[]>`
        SELECT COALESCE(sum(amount_cents), 0)::bigint AS total_cents,
               count(*)::int AS purchase_count
        FROM purchases
        WHERE status = 'completed'
      `;
    } catch (err) {
      console.error('[PURCHASES] Summary query failed:', err);
      return NextResponse.json({ error: 'Database query failed', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        purchases,
        summary: summary[0] ?? { totalCents: '0', purchaseCount: 0 },
      },
    });
  } catch (err) {
    console.error('[admin/purchases] error:', err);
    return NextResponse.json(
      { error: 'Purchase query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
