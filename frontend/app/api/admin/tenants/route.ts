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
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql, enterBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { createTenantWithAdmin } from '@/lib/tenants/create-tenant';
import { send } from '@/lib/email';
import { applicationAcceptedEmail } from '@/lib/email-templates';

function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

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
          LIMIT 200
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
          LIMIT 200
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
        LIMIT 200
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
        LIMIT 200
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
    // Cross-tenant helper (offerStarterSet) uses global sql — route it to the owner pool. (docs/RLS_CUTOVER.md)
    enterBypass();

    // Body: create a company + its admin POC directly (the "we/expert add them" path,
    // vs. the customer self-serve /apply → accept flow). See MULTI_MEMBERSHIP_IDENTITY_DESIGN.
    let body: { name?: unknown; adminEmail?: unknown; adminName?: unknown; legalName?: unknown; website?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const adminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
    const adminName = typeof body.adminName === 'string' ? body.adminName.trim() : null;
    const legalName = typeof body.legalName === 'string' && body.legalName.trim() ? body.legalName.trim() : null;
    const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null;
    if (!name) return NextResponse.json({ error: 'Company name is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    if (!adminEmail || !validEmail(adminEmail)) return NextResponse.json({ error: 'A valid admin POC email is required', code: 'VALIDATION_ERROR' }, { status: 400 });

    // ONE system path (lib/tenants/create-tenant): tenant + admin + membership + buckets +
    // card backfill + starter/template copy + offer fallback, bracketed finder:tenant.created
    // start/end with the library_seeded intrastep.
    let created: Awaited<ReturnType<typeof createTenantWithAdmin>>;
    try {
      created = await createTenantWithAdmin(
        { name, adminEmail, adminName, legalName, website },
        { id: sessionUser.id ?? '', email: (session.user as { email?: string }).email ?? null, role },
      );
    } catch (txErr) {
      console.error('[admin/tenants/create] creation failed', txErr);
      return NextResponse.json({ error: 'Company creation failed', code: 'DB_ERROR' }, { status: 500 });
    }
    const tempPw = created.tempPassword ?? '';
    const cardsBackfilled = created.cardsBackfilled;

    // Onboard the POC the same way self-serve accept does (sweep gap: this path never
    // emailed). New user → temp-pw acceptance mail; existing user → an "added as admin"
    // notice. Best-effort; the tempPassword also returns below as an admin-relay backstop.
    let emailSent = false;
    try {
      const base = (process.env.NEXTAUTH_URL || process.env.AUTH_URL) || process.env.NEXT_PUBLIC_APP_URL || '';
      if (created.isNewUser && tempPw) {
        const c = applicationAcceptedEmail({ contactName: adminName ?? adminEmail, contactEmail: adminEmail, companyName: name, tempPassword: tempPw, tenantSlug: created.slug, loginUrl: `${base}/login` });
        const r = await send({
          to: adminEmail, subject: c.subject, html: c.html,
          kind: 'transactional', tenantId: created.tenantId, template: 'application_accepted',
          idempotencyKey: `tenant_admin_welcome:${created.tenantId}:${adminEmail.toLowerCase()}`,
          tags: ['onboarding'],
        });
        emailSent = r.accepted;
      } else {
        const safe = (s: string | null) => String(s ?? '').replace(/[<>&"]/g, '');
        const r = await send({ to: adminEmail, subject: `You've been added as an administrator of ${safe(name)}`,
          html: `<p>Hi ${safe(adminName) || 'there'},</p><p>You now have <strong>administrator</strong> access to <strong>${safe(name)}</strong> on RFP Pipeline. Sign in with your existing account to manage the workspace.</p><p><a href="${base}/login">Sign in</a></p>`,
          kind: 'transactional', tenantId: created.tenantId, template: 'tenant_admin_added',
          idempotencyKey: `tenant_admin_added:${created.tenantId}:${adminEmail.toLowerCase()}`,
          tags: ['onboarding'],
        });
        emailSent = r.accepted;
      }
    } catch (e) { console.error('[admin/tenants/create] acceptance email failed', e); }

    return NextResponse.json({
      data: {
        tenantId: created.tenantId,
        slug: created.slug,
        name,
        adminPoc: { email: adminEmail, isNewUser: created.isNewUser, tempPassword: created.isNewUser ? tempPw : null, emailSent },
        cardsBackfilled,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[admin/tenants/create] error:', err);
    return NextResponse.json(
      { error: 'Tenant creation failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
