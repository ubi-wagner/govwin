/**
 * GET  /api/admin/tenants — List all tenants with stats
 * POST /api/admin/tenants — Create tenant manually (bypass application flow)
 *
 * Auth: master_admin or rfp_admin.
 *
 * V1 TODO (P2-23): Implement tenant CRUD.
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

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') ?? '';
    const status = searchParams.get('status') ?? '';

    let tenants;
    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      const pattern = `%${escaped}%`;
      if (status) {
        tenants = await sql<{
          id: string;
          slug: string;
          name: string;
          status: string;
          productTier: string | null;
          subscriptionStatus: string | null;
          billingEmail: string | null;
          trialEndsAt: string | null;
          createdAt: string;
          userCount: number;
          proposalCount: number;
        }[]>`
          SELECT t.id, t.slug, t.name, t.status, t.product_tier,
                 t.subscription_status, t.billing_email,
                 t.trial_ends_at, t.created_at,
                 (SELECT count(*)::int FROM users WHERE tenant_id = t.id) AS user_count,
                 (SELECT count(*)::int FROM proposals WHERE tenant_id = t.id) AS proposal_count
          FROM tenants t
          WHERE (t.name ILIKE ${pattern} OR t.slug ILIKE ${pattern})
            AND t.status = ${status}
          ORDER BY t.created_at DESC
        `;
      } else {
        tenants = await sql<{
          id: string;
          slug: string;
          name: string;
          status: string;
          productTier: string | null;
          subscriptionStatus: string | null;
          billingEmail: string | null;
          trialEndsAt: string | null;
          createdAt: string;
          userCount: number;
          proposalCount: number;
        }[]>`
          SELECT t.id, t.slug, t.name, t.status, t.product_tier,
                 t.subscription_status, t.billing_email,
                 t.trial_ends_at, t.created_at,
                 (SELECT count(*)::int FROM users WHERE tenant_id = t.id) AS user_count,
                 (SELECT count(*)::int FROM proposals WHERE tenant_id = t.id) AS proposal_count
          FROM tenants t
          WHERE t.name ILIKE ${pattern} OR t.slug ILIKE ${pattern}
          ORDER BY t.created_at DESC
        `;
      }
    } else if (status) {
      tenants = await sql<{
        id: string;
        slug: string;
        name: string;
        status: string;
        productTier: string | null;
        subscriptionStatus: string | null;
        billingEmail: string | null;
        trialEndsAt: string | null;
        createdAt: string;
        userCount: number;
        proposalCount: number;
      }[]>`
        SELECT t.id, t.slug, t.name, t.status, t.product_tier,
               t.subscription_status, t.billing_email,
               t.trial_ends_at, t.created_at,
               (SELECT count(*)::int FROM users WHERE tenant_id = t.id) AS user_count,
               (SELECT count(*)::int FROM proposals WHERE tenant_id = t.id) AS proposal_count
        FROM tenants t
        WHERE t.status = ${status}
        ORDER BY t.created_at DESC
      `;
    } else {
      tenants = await sql<{
        id: string;
        slug: string;
        name: string;
        status: string;
        productTier: string | null;
        subscriptionStatus: string | null;
        billingEmail: string | null;
        trialEndsAt: string | null;
        createdAt: string;
        userCount: number;
        proposalCount: number;
      }[]>`
        SELECT t.id, t.slug, t.name, t.status, t.product_tier,
               t.subscription_status, t.billing_email,
               t.trial_ends_at, t.created_at,
               (SELECT count(*)::int FROM users WHERE tenant_id = t.id) AS user_count,
               (SELECT count(*)::int FROM proposals WHERE tenant_id = t.id) AS proposal_count
        FROM tenants t
        ORDER BY t.created_at DESC
      `;
    }

    return NextResponse.json({ data: { tenants } });
  } catch (err) {
    console.error('[admin/tenants/list] error:', err);
    return NextResponse.json(
      { error: 'Tenant query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

    // TODO: Implement manual tenant creation
    //
    // Body: { name, slug, legalName, website, billingEmail, productTier }
    // 1. Validate required fields
    // 2. Check slug uniqueness
    // 3. INSERT INTO tenants (...)
    // 4. Optionally create admin user for this tenant
    // 5. Emit finder:tenant.created event

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-23',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[admin/tenants/create] error:', err);
    return NextResponse.json(
      { error: 'Tenant creation failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
