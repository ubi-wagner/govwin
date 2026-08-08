/**
 * Partner-manager OWN-org provisioning (docs/PARTNER_MANAGER_DESIGN.md D4).
 *
 * The structural rows (tenant + home membership + home pointer) are seeded durably by a migration
 * (mig 159 for Paul). This fills in the *runtime* provisioning — spotlight buckets + the opportunity
 * pipeline (cards) + the starter library — exactly like the client-company create/accept paths, so
 * the partner's own org lands with a ranked pipeline + a populated library to run grants against.
 *
 * Idempotent + gated: the whole block runs only when the org has zero buckets (i.e. first visit),
 * so it is safe to call on every /partner render. Best-effort — the console must render even if
 * provisioning fails.
 */
import { sqlBypass } from '@/lib/db';
import { seedDefaultBuckets } from '@/lib/spotlight/default-buckets';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { scoreTenantCards } from '@/lib/cards/score-tenant';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import { emitEventSingle, userActor } from '@/lib/events';

/**
 * Provision buckets + cards + starter library for a partner's own org, once. Returns true if it
 * provisioned this call, false if it was already provisioned (or on any handled failure).
 */
export async function ensurePartnerOwnOrgProvisioned(
  tenantId: string,
  userId: string,
  email?: string | null,
): Promise<boolean> {
  if (!tenantId || !userId) return false;
  try {
    const [b] = await sqlBypass<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tenant_spotlight_buckets WHERE tenant_id = ${tenantId}::uuid`;
    if (b && b.n > 0) return false; // already provisioned
  } catch (e) {
    console.error('[partner/own-org] bucket-count probe failed:', e);
    return false;
  }

  try { await seedDefaultBuckets(tenantId, userId); } catch (e) { console.error('[partner/own-org] seed buckets failed:', e); }
  try { await backfillTenant(tenantId); } catch (e) { console.error('[partner/own-org] backfill failed:', e); }
  try { await scoreTenantCards(tenantId); } catch (e) { console.error('[partner/own-org] scoring failed:', e); }
  try { await copyStarterSetToTenant(tenantId, { id: userId }); } catch (e) { console.error('[partner/own-org] starter-set copy failed:', e); }
  try {
    await emitEventSingle({
      namespace: 'finder',
      type: 'tenant.provisioned',
      actor: userActor(userId, email ?? undefined),
      tenantId: null,
      payload: { tenantId, kind: 'partner_org', via: 'partner_own_org' },
    });
  } catch (e) { console.error('[partner/own-org] event emit failed:', e); }
  return true;
}
