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
import { emitEventSingle, userActor } from '@/lib/events';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { offerStarterSet } from '@/lib/library/starter-offer';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import { backfillTenantTemplates } from '@/lib/template-bridge';
import { sendEmail } from '@/lib/email';
import { applicationAcceptedEmail } from '@/lib/email-templates';
import bcrypt from 'bcryptjs';

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
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

    const tempPw = crypto.randomUUID().slice(0, 12);
    const hash = await bcrypt.hash(tempPw, 12);

    let created: { tenantId: string; slug: string; adminUserId: string; isNewUser: boolean };
    try {
      created = await sql.begin(async (tx: any) => {
        // Race-free unique slug (bump suffix on conflict).
        const baseSlug = slugify(name) || 'company';
        let finalSlug = baseSlug;
        let tenantId: string | undefined;
        for (let suffix = 2; suffix < 1000; suffix++) {
          const inserted = await tx`
            INSERT INTO tenants (name, slug, legal_name, website, status, lifecycle_stage)
            VALUES (${name}, ${finalSlug}, ${legalName}, ${website}, 'active', 'customer')
            ON CONFLICT (slug) DO NOTHING
            RETURNING id`;
          if (inserted.length > 0) { tenantId = inserted[0].id; break; }
          finalSlug = `${baseSlug}-${suffix}`;
        }
        if (!tenantId) throw new Error('could not allocate a unique tenant slug');

        // Admin POC user. A brand-new email gets this as its HOME tenant; an existing
        // user (already at another company) keeps their home and gets a MANUAL admin
        // membership here (multi-membership). Never clobber an existing user's home.
        const [existing] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${adminEmail} LIMIT 1`;
        let adminUserId: string;
        let isNewUser = false;
        if (existing) {
          adminUserId = existing.id;
        } else {
          isNewUser = true;
          const [u] = await tx<{ id: string }[]>`
            INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
            VALUES (${adminEmail}, ${adminName}, 'tenant_admin', ${tenantId}, ${hash}, true, true)
            RETURNING id`;
          adminUserId = u.id;
        }
        await tx`
          INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
          VALUES (${adminUserId}, ${tenantId}, 'tenant_admin', 'active', ${existing ? 'manual' : 'home'}, ${sessionUser.id})
          ON CONFLICT (user_id, tenant_id) DO UPDATE
            SET status = 'active', role = 'tenant_admin'
            WHERE user_memberships.status <> 'active'`;
        return { tenantId, slug: finalSlug, adminUserId, isNewUser };
      });
    } catch (txErr) {
      console.error('[admin/tenants/create] tx failed', txErr);
      return NextResponse.json({ error: 'Company creation failed', code: 'DB_ERROR' }, { status: 500 });
    }

    // Seed the new company's spotlight + pipeline (best-effort — don't fail creation).
    try { await seedDefaultBuckets(created.tenantId, created.adminUserId); } catch (e) { console.error('[admin/tenants/create] seed buckets failed', e); }
    let cardsBackfilled = 0;
    try { cardsBackfilled = await backfillTenant(created.tenantId); } catch (e) { console.error('[admin/tenants/create] backfill failed', e); }

    // "Keep + copy": eager-materialize the shared system-starter library into the new tenant's OWN
    // space on creation — each foundation copied as a tenant-owned atom (derived_from lineage,
    // collection=my_library) so a fresh workspace lands with a populated library, not an empty one.
    // The shared masters stay shared (templates remain is_system; copy-on-use still works for the
    // rest); isolation is preserved (every copy carries this tenant's tenant_id). Idempotent,
    // best-effort — creation never fails on it.
    let starterCopied = 0;
    try { starterCopied = (await copyStarterSetToTenant(created.tenantId, { id: created.adminUserId })).added; }
    catch (e) { console.error('[admin/tenants/create] starter-set copy failed', e); }

    // Template stable: copy every pristine master (100% copy-on-create) into the tenant's OWN shelf
    // via the forward-only template bridge (mig 177). Skeleton-only, isolated per tenant — same
    // copy-on-create pattern as the starter set. Idempotent, best-effort — creation never fails on it.
    try { await backfillTenantTemplates(created.tenantId); }
    catch (e) { console.error('[admin/tenants/create] template backfill failed', e); }

    // Fallback OFFER (P5.3): only when the eager copy landed nothing (copy failed or the catalog is
    // empty) do we drop the dismissible one-click "add the starter set" ToDo, so the tenant is never
    // left with an empty library. On the happy path the copy already seeded it, so no redundant ToDo.
    if (starterCopied === 0) {
      try {
        await offerStarterSet({
          tenantId: created.tenantId, tenantSlug: created.slug, adminUserId: created.adminUserId,
          actor: { id: sessionUser.id ?? '', email: (session.user as { email?: string }).email ?? null, role: role ?? 'rfp_admin', tenantId: null },
        });
      } catch (e) { console.error('[admin/tenants/create] starter-set offer failed', e); }
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'tenant.created',
      actor: userActor(sessionUser.id ?? '', (session.user as { email?: string }).email ?? undefined),
      // Admin (finder) event: tenantId stays null; the new tenant's UUID rides in the payload.
      tenantId: null,
      payload: { tenantId: created.tenantId, slug: created.slug, name, adminEmail, source: 'admin_manual', cardsBackfilled },
    });

    // Onboard the POC the same way self-serve accept does (sweep gap: this path never
    // emailed). New user → temp-pw acceptance mail; existing user → an "added as admin"
    // notice. Best-effort; the tempPassword also returns below as an admin-relay backstop.
    let emailSent = false;
    try {
      const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      if (created.isNewUser) {
        const c = applicationAcceptedEmail({ contactName: adminName ?? adminEmail, contactEmail: adminEmail, companyName: name, tempPassword: tempPw, tenantSlug: created.slug, loginUrl: `${base}/login` });
        const r = await sendEmail({ to: adminEmail, subject: c.subject, html: c.html });
        emailSent = r.provider !== 'skipped' && !r.error;
      } else {
        const safe = (s: string | null) => String(s ?? '').replace(/[<>&"]/g, '');
        const r = await sendEmail({ to: adminEmail, subject: `You've been added as an administrator of ${safe(name)}`,
          html: `<p>Hi ${safe(adminName) || 'there'},</p><p>You now have <strong>administrator</strong> access to <strong>${safe(name)}</strong> on RFP Pipeline. Sign in with your existing account to manage the workspace.</p><p><a href="${base}/login">Sign in</a></p>` });
        emailSent = r.provider !== 'skipped' && !r.error;
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
