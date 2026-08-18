/**
 * Tenant onboarding core — ONE system path for creating (or completing) a company.
 *
 * Extracted from POST /api/admin/tenants so every creator flows through the SAME spine
 * (the route, the accept-application flow's future consolidation, and the deploy/demo
 * seeds — nothing provisions a tenant with raw SQL again): tenant + admin POC user +
 * membership (multi-membership aware) → default spotlight buckets → mirror-card backfill
 * → starter-library copy → template-stable backfill → starter OFFER fallback.
 *
 * EVENTS (docs/EVENT_CONTRACT.md — the full start/end pattern, intrasteps included):
 *   finder:tenant.created:start   — committed to create (name, adminEmail, source)
 *   finder:tenant.library_seeded  — intrastep audit single (starter + template copy counts)
 *   finder:tenant.created:end     — the payload processors match (tenantId, slug,
 *                                   cardsBackfilled, starterCopied, existingTenant)
 *   …:end{error}                  — on failure, so the bracket never dangles.
 *
 * Idempotent completion: with `fixedSlug`, an EXISTING tenant is adopted (status→active)
 * and the run completes whatever is missing — membership, buckets, cards, starter copy —
 * all sub-steps being idempotent. That is how a seed "heals" a hand-made tenant onto the
 * product spine. RLS: callers run in bypass context (admin route `enterBypass()`) or on
 * the owner connection (scripts); every write here is cross-tenant provisioning.
 */
import { sqlBypass as sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { offerStarterSet } from '@/lib/library/starter-offer';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import { backfillTenantTemplates } from '@/lib/template-bridge';
import type { Role } from '@/lib/rbac';
import bcrypt from 'bcryptjs';

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface CreateTenantInput {
  name: string;
  adminEmail: string;
  adminName?: string | null;
  legalName?: string | null;
  website?: string | null;
  /** Adopt-or-create THIS slug (idempotent seeds) instead of the race-free suffix loop. */
  fixedSlug?: string;
  /** Known password (demo/deploy seeds). Absent → a temp password is generated. */
  password?: string;
}
export interface CreateTenantActor { id: string; email: string | null; role: Role }
export interface CreateTenantResult {
  tenantId: string;
  slug: string;
  adminUserId: string;
  isNewUser: boolean;
  existingTenant: boolean;
  /** Set only when generated here (new user, no explicit password) — the route relays it. */
  tempPassword: string | null;
  cardsBackfilled: number;
  starterCopied: number;
}

export async function createTenantWithAdmin(
  input: CreateTenantInput,
  actor: CreateTenantActor,
): Promise<CreateTenantResult> {
  const name = input.name.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const explicitPw = input.password ?? null;
  const tempPw = explicitPw ?? crypto.randomUUID().slice(0, 12);
  const hash = await bcrypt.hash(tempPw, 12);

  const startId = await emitEventStart({
    namespace: 'finder', type: 'tenant.created',
    actor: userActor(actor.id, actor.email ?? undefined), tenantId: null,
    payload: { name, adminEmail, source: input.fixedSlug ? 'seed' : 'admin_manual' },
  });

  try {
    const created = await sql.begin(async (tx: any) => {
      let tenantId: string | undefined;
      let finalSlug: string;
      let existingTenant = false;
      if (input.fixedSlug) {
        finalSlug = input.fixedSlug;
        const [row] = await tx<{ id: string; created: boolean }[]>`
          INSERT INTO tenants (name, slug, legal_name, website, status, lifecycle_stage)
          VALUES (${name}, ${finalSlug}, ${input.legalName ?? null}, ${input.website ?? null}, 'active', 'customer')
          ON CONFLICT (slug) DO UPDATE SET status = 'active'
          RETURNING id, (xmax = 0) AS created`;
        tenantId = row.id;
        existingTenant = !row.created;
      } else {
        // Race-free unique slug (bump suffix on conflict).
        const baseSlug = slugify(name) || 'company';
        finalSlug = baseSlug;
        for (let suffix = 2; suffix < 1000; suffix++) {
          const inserted = await tx`
            INSERT INTO tenants (name, slug, legal_name, website, status, lifecycle_stage)
            VALUES (${name}, ${finalSlug}, ${input.legalName ?? null}, ${input.website ?? null}, 'active', 'customer')
            ON CONFLICT (slug) DO NOTHING
            RETURNING id`;
          if (inserted.length > 0) { tenantId = inserted[0].id; break; }
          finalSlug = `${baseSlug}-${suffix}`;
        }
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
          VALUES (${adminEmail}, ${input.adminName ?? null}, 'tenant_admin', ${tenantId}, ${hash}, ${explicitPw ? false : true}, true)
          RETURNING id`;
        adminUserId = u.id;
      }
      await tx`
        INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
        VALUES (${adminUserId}, ${tenantId}, 'tenant_admin', 'active', ${existing ? 'manual' : 'home'}, ${actor.id})
        ON CONFLICT (user_id, tenant_id) DO UPDATE
          SET status = 'active', role = 'tenant_admin'
          WHERE user_memberships.status <> 'active'`;
      return { tenantId, slug: finalSlug, adminUserId, isNewUser, existingTenant };
    });

    // Spotlight + mirror cards (idempotent — buckets skip when any exist; applies are forward-only).
    try { await seedDefaultBuckets(created.tenantId, created.adminUserId); } catch (e) { console.error('[create-tenant] seed buckets failed', e); }
    let cardsBackfilled = 0;
    try { cardsBackfilled = await backfillTenant(created.tenantId); } catch (e) { console.error('[create-tenant] backfill failed', e); }

    // "Keep + copy": eager-materialize the shared system-starter library + the pristine
    // template stable into the tenant's OWN space (both idempotent, best-effort).
    let starterCopied = 0;
    try { starterCopied = (await copyStarterSetToTenant(created.tenantId, { id: created.adminUserId })).added; }
    catch (e) { console.error('[create-tenant] starter-set copy failed', e); }
    let templatesCopied = 0;
    try { templatesCopied = await backfillTenantTemplates(created.tenantId); }
    catch (e) { console.error('[create-tenant] template backfill failed', e); }

    // Intrastep audit: the library seeding that used to be invisible between the tx and the
    // terminal event.
    try {
      await emitEventSingle({
        namespace: 'finder', type: 'tenant.library_seeded',
        actor: userActor(actor.id, actor.email ?? undefined), tenantId: null,
        payload: { tenantId: created.tenantId, starterCopied, templatesCopied },
      });
    } catch (e) { console.error('[create-tenant] library_seeded emit failed (non-fatal)', e); }

    // Fallback OFFER: only when the eager copy landed nothing does the dismissible
    // one-click "add the starter set" ToDo drop, so the tenant never starts empty-handed.
    if (starterCopied === 0 && !created.existingTenant) {
      try {
        await offerStarterSet({
          tenantId: created.tenantId, tenantSlug: created.slug, adminUserId: created.adminUserId,
          actor: { id: actor.id, email: actor.email, role: actor.role, tenantId: null },
        });
      } catch (e) { console.error('[create-tenant] starter-set offer failed', e); }
    }

    await emitEventEnd(startId, {
      result: {
        tenantId: created.tenantId, slug: created.slug, name, adminEmail,
        source: input.fixedSlug ? 'seed' : 'admin_manual',
        cardsBackfilled, starterCopied, existingTenant: created.existingTenant,
      },
    });

    return {
      ...created,
      tempPassword: created.isNewUser && !explicitPw ? tempPw : null,
      cardsBackfilled, starterCopied,
    };
  } catch (err) {
    try { await emitEventEnd(startId, { error: { message: err instanceof Error ? err.message : String(err), code: 'TENANT_CREATE_FAILED' } }); } catch { /* never dangle silently */ }
    throw err;
  }
}
