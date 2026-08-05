/**
 * GET  /api/partner/tenants — list the EconDev partner's OWN stable (tenants.owner_id = me).
 * POST /api/partner/tenants — create a company OWNED by the partner. Sets owner_id = me, grants
 *      the partner a tenant_admin membership (so they build inside it via the tested portal), and
 *      auto-provisions spotlight buckets + the opportunity pipeline + the starter library — no
 *      Stripe (the comp/bypass model for EconDev clients). Optional adminEmail seeds a founder POC.
 *
 * Auth: partner_admin (owner-scoped) or rfp_admin+ (platform operators). partner_admin is denied
 * the global /admin routes by rank — this is the ONLY surface it can create/see tenants through,
 * and it is scoped to owner_id = self, so an EconDev partner never sees another partner's stable.
 * See docs/ECONDEV_PARTNER_ADMIN.md.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Owner-scoped but cross-tenant at the row level (provisioning helpers use global sql) → owner pool.
import { sqlBypass as sql, enterBypass } from '@/lib/db';
import { isRole, canManagePartnerTenants, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function actor(session: any): { id: string; email: string | null; role: Role } | null {
  const u = session?.user as { id?: string; email?: string; role?: unknown } | undefined;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id || !role || !canManagePartnerTenants(role)) return null;
  return { id: u.id, email: u.email ?? null, role };
}

export async function GET() {
  try {
    const me = actor(await auth());
    if (!me) return NextResponse.json({ error: 'EconDev partner access required', code: 'FORBIDDEN' }, { status: 403 });
    enterBypass();
    let tenants;
    try {
      // Owner-scoped: a partner sees ONLY the tenants they own. (rfp_admin+ hitting this route
      // likewise see only tenants they personally own — the global view lives at /admin.)
      tenants = await sql`
        SELECT t.id, t.slug, t.name, t.status, t.created_at,
               (SELECT count(*)::int FROM users WHERE tenant_id = t.id) AS user_count,
               (SELECT count(*)::int FROM proposals WHERE tenant_id = t.id) AS proposal_count
        FROM tenants t
        WHERE t.owner_id = ${me.id}::uuid
        ORDER BY t.created_at DESC`;
    } catch (e) {
      console.error('[partner/tenants/list] error:', e);
      return NextResponse.json({ error: 'Query failed', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { tenants } });
  } catch (e) {
    console.error('[partner/tenants] GET error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = actor(await auth());
    if (!me) return NextResponse.json({ error: 'EconDev partner access required', code: 'FORBIDDEN' }, { status: 403 });
    enterBypass();

    let body: { name?: unknown; adminEmail?: unknown; adminName?: unknown; legalName?: unknown; website?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const adminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
    const adminName = typeof body.adminName === 'string' ? body.adminName.trim() : null;
    const legalName = typeof body.legalName === 'string' && body.legalName.trim() ? body.legalName.trim() : null;
    const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null;
    if (!name) return NextResponse.json({ error: 'Company name is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    if (adminEmail && !validEmail(adminEmail)) return NextResponse.json({ error: 'adminEmail must be a valid email', code: 'VALIDATION_ERROR' }, { status: 422 });

    const tempPw = crypto.randomUUID().slice(0, 12);
    const hash = await bcrypt.hash(tempPw, 12);

    let created: { tenantId: string; slug: string; provisionUserId: string };
    try {
      created = await sql.begin(async (tx: any) => {
        const baseSlug = slugify(name) || 'company';
        let finalSlug = baseSlug;
        let tenantId: string | undefined;
        for (let suffix = 2; suffix < 1000; suffix++) {
          const inserted = await tx`
            INSERT INTO tenants (name, slug, legal_name, website, status, lifecycle_stage, owner_id)
            VALUES (${name}, ${finalSlug}, ${legalName}, ${website}, 'active', 'customer', ${me.id}::uuid)
            ON CONFLICT (slug) DO NOTHING
            RETURNING id`;
          if (inserted.length > 0) { tenantId = inserted[0].id; break; }
          finalSlug = `${baseSlug}-${suffix}`;
        }
        if (!tenantId) throw new Error('could not allocate a unique tenant slug');

        // The partner gets a tenant_admin MEMBERSHIP on their own new company, so they enter +
        // build through the normal (tested, tenant-scoped) portal — not via any global power.
        await tx`
          INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
          VALUES (${me.id}::uuid, ${tenantId}, 'tenant_admin', 'active', 'collaborator', ${me.id}::uuid)
          ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active', role = 'tenant_admin'`;

        // Optional founder POC (staffing the company). Never clobber an existing user's home tenant.
        let provisionUserId = me.id;
        if (adminEmail) {
          const [existing] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${adminEmail} LIMIT 1`;
          if (existing) {
            provisionUserId = existing.id;
          } else {
            const [u] = await tx<{ id: string }[]>`
              INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
              VALUES (${adminEmail}, ${adminName}, 'tenant_admin', ${tenantId}, ${hash}, true, true)
              RETURNING id`;
            provisionUserId = u.id;
          }
          await tx`
            INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
            VALUES (${provisionUserId}::uuid, ${tenantId}, 'tenant_admin', 'active', ${existing ? 'manual' : 'home'}, ${me.id}::uuid)
            ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active', role = 'tenant_admin'
              WHERE user_memberships.status <> 'active'`;
        }
        return { tenantId, slug: finalSlug, provisionUserId };
      });
    } catch (txErr) {
      console.error('[partner/tenants/create] tx failed', txErr);
      return NextResponse.json({ error: 'Company creation failed', code: 'DB_ERROR' }, { status: 500 });
    }

    // Auto-provision — spotlight buckets + opportunity pipeline + starter library (no Stripe).
    try { await seedDefaultBuckets(created.tenantId, created.provisionUserId); } catch (e) { console.error('[partner/tenants/create] seed buckets failed', e); }
    let cardsBackfilled = 0;
    try { cardsBackfilled = await backfillTenant(created.tenantId); } catch (e) { console.error('[partner/tenants/create] backfill failed', e); }
    let starterCopied = 0;
    try { starterCopied = (await copyStarterSetToTenant(created.tenantId, { id: created.provisionUserId })).added; }
    catch (e) { console.error('[partner/tenants/create] starter-set copy failed', e); }

    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'tenant.created',
        actor: userActor(me.id, me.email ?? undefined),
        tenantId: null,
        payload: { tenantId: created.tenantId, slug: created.slug, ownerId: me.id, via: 'econdev_partner', cardsBackfilled, starterCopied },
      });
    } catch (e) { console.error('[partner/tenants/create] event emit failed', e); }

    return NextResponse.json({ data: { tenantId: created.tenantId, slug: created.slug, cardsBackfilled, starterCopied } }, { status: 201 });
  } catch (e) {
    console.error('[partner/tenants] POST error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
