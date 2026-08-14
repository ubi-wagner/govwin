/**
 * Create a new partner-manager (EconDev org) — the RFP-admin onboarding path
 * (docs/PARTNER_MANAGER_DESIGN.md D4). Creates the partner_admin user + their own-org
 * (kind='partner_org') tenant + home membership + home pointer, and provisions buckets/cards/
 * library. Returns a temp password the admin relays out-of-band (temp_password forces a reset).
 * Owner-pool writes (cross-tenant provisioning). Admin-gated at the route.
 */
import { sqlBypass } from '@/lib/db';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { scoreTenantCards } from '@/lib/cards/score-tenant';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import { backfillTenantTemplates } from '@/lib/template-bridge';
import { emitEventSingle, userActor } from '@/lib/events';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface CreatePartnerOrgInput {
  orgName: string;
  legalName?: string | null;
  website?: string | null;
  adminName: string;
  adminEmail: string;
  createdBy: { id: string; email: string | null };
}

export type CreatePartnerOrgResult =
  | { ok: true; userId: string; tenantId: string; slug: string; tempPassword: string }
  | { ok: false; status: number; error: string; code: string };

export async function createPartnerOrg(input: CreatePartnerOrgInput): Promise<CreatePartnerOrgResult> {
  const orgName = input.orgName?.trim();
  const adminName = input.adminName?.trim();
  const adminEmail = input.adminEmail?.trim().toLowerCase();
  const legalName = input.legalName?.trim() || null;
  const website = input.website?.trim() || null;
  if (!orgName || !adminName || !adminEmail) {
    return { ok: false, status: 400, error: 'Org name, admin name, and admin email are required', code: 'VALIDATION_ERROR' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return { ok: false, status: 422, error: 'Admin email is invalid', code: 'VALIDATION_ERROR' };
  }

  // A partner admin is a new person — the email must be free (avoid clobbering an existing account).
  const [existing] = await sqlBypass<{ id: string }[]>`SELECT id FROM users WHERE email = ${adminEmail} LIMIT 1`;
  if (existing) {
    return { ok: false, status: 409, error: 'That email already has an account. Use a different email for the partner admin.', code: 'EMAIL_EXISTS' };
  }

  const tempPassword = crypto.randomUUID().slice(0, 12);
  const hash = await bcrypt.hash(tempPassword, 12);

  let created: { userId: string; tenantId: string; slug: string };
  try {
    created = await sqlBypass.begin(async (tx: any) => {
      const [u] = await tx`
        INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
        VALUES (${adminEmail}, ${adminName}, 'partner_admin', NULL, ${hash}, true, true)
        RETURNING id`;
      const userId = u.id as string;

      const baseSlug = slugify(orgName) || 'partner-org';
      let finalSlug = baseSlug;
      let tenantId: string | undefined;
      for (let s = 2; s < 1000; s++) {
        const ins = await tx`
          INSERT INTO tenants (name, slug, legal_name, website, status, lifecycle_stage, kind, owner_id)
          VALUES (${orgName}, ${finalSlug}, ${legalName}, ${website}, 'active', 'customer', 'partner_org', ${userId})
          ON CONFLICT (slug) DO NOTHING
          RETURNING id`;
        if (ins.length > 0) { tenantId = ins[0].id; break; }
        finalSlug = `${baseSlug}-${s}`;
      }
      if (!tenantId) throw new Error('could not allocate a slug for the partner org');

      await tx`
        INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
        VALUES (${userId}, ${tenantId}, 'tenant_admin', 'active', 'home', ${input.createdBy.id})
        ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active', role = 'tenant_admin'`;
      await tx`UPDATE users SET tenant_id = ${tenantId} WHERE id = ${userId} AND tenant_id IS NULL`;
      return { userId, tenantId, slug: finalSlug };
    });
  } catch (e) {
    console.error('[admin/create-partner-org] tx failed:', e);
    return { ok: false, status: 500, error: 'Partner org creation failed', code: 'DB_ERROR' };
  }

  // Provision the own org (best-effort — creation already committed).
  try { await seedDefaultBuckets(created.tenantId, created.userId); } catch (e) { console.error('[create-partner-org] seed buckets failed:', e); }
  try { await backfillTenant(created.tenantId); } catch (e) { console.error('[create-partner-org] backfill failed:', e); }
  try { await scoreTenantCards(created.tenantId); } catch (e) { console.error('[create-partner-org] scoring failed:', e); }
  try { await copyStarterSetToTenant(created.tenantId, { id: created.userId }); } catch (e) { console.error('[create-partner-org] starter copy failed:', e); }
  try { await backfillTenantTemplates(created.tenantId); } catch (e) { console.error('[create-partner-org] template backfill failed:', e); }
  try {
    await emitEventSingle({
      namespace: 'finder', type: 'tenant.created',
      actor: userActor(input.createdBy.id, input.createdBy.email ?? undefined),
      tenantId: null,
      payload: { tenantId: created.tenantId, slug: created.slug, ownerId: created.userId, kind: 'partner_org', via: 'admin_partner_create', orgName },
    });
  } catch (e) { console.error('[create-partner-org] event emit failed:', e); }

  return { ok: true, userId: created.userId, tenantId: created.tenantId, slug: created.slug, tempPassword };
}
