/**
 * Partner-manager OWN-org provisioning (docs/PARTNER_MANAGER_DESIGN.md D4).
 *
 * The structural rows (tenant + home membership + home pointer) are seeded durably by a migration
 * (mig 159 for Paul). This fills in the *runtime* provisioning — spotlight buckets + the opportunity
 * pipeline (cards) + the starter library — exactly like the client-company create/accept paths, so
 * the partner's own org lands with a ranked pipeline + a populated library to run grants against.
 *
 * Idempotent + gated. **The gate is the `finder:tenant.provisioned` event this function itself
 * writes**, and that is a deliberate correction: it used to be "zero spotlight buckets", which was
 * a fair proxy while a new org was seeded with buckets — and #189 removed seeded buckets, because a
 * bucket is the customer's own ranking lens and the product imposes none.
 *
 * So the condition became permanently true. Every single `/partner` render re-ran the whole block:
 * `backfillTenant` + `scoreTenantCards` + `copyStarterSetToTenant` + `backfillTenantTemplates`,
 * four write-heavy operations, plus a `tenant.provisioned` event asserting a first-time act that
 * had already happened. A 153-page atlas sweep left **12 of those events in two hours** against an
 * org with 0 buckets. It is also the most plausible cause of the intermittent React #418 on
 * `/partner`: a server component whose render MUTATES shared state can produce different output on
 * the HTML pass and the RSC pass.
 *
 * The lesson generalises past this file: a gate that infers "have we done X" from a side effect
 * someone else owns is a gate that another team can switch off without touching this code. Gate on
 * the RECORD OF THE ACT.
 *
 * Best-effort — the console must render even if provisioning fails.
 */
import { sqlBypass } from '@/lib/db';
import { backfillTenant } from '@/lib/opportunity-bridge';
import { scoreTenantCards } from '@/lib/cards/score-tenant';
import { copyStarterSetToTenant } from '@/lib/library/foundation';
import { backfillTenantTemplates } from '@/lib/template-bridge';
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
    const [done] = await sqlBypass<{ n: number }[]>`
      SELECT count(*)::int AS n FROM system_events
       WHERE namespace = 'finder' AND type = 'tenant.provisioned'
         AND payload->>'tenantId' = ${tenantId}
       LIMIT 1`;
    if (done && done.n > 0) return false; // already provisioned — see the header
  } catch (e) {
    // Fail CLOSED on the probe: a provisioning run we cannot prove is needed is one we do not do.
    // The alternative — running it "just in case" on every render — is the defect this replaced.
    console.error('[partner/own-org] provisioned-probe failed:', e);
    return false;
  }

  // No spotlight buckets are seeded. A bucket is the CUSTOMER's own ranking lens — a 1:n
  // they open empty and fill — so the product imposes none, and the cap is a pure authoring
  // budget rather than `seeded + headroom` (the entanglement behind B62). Until they author
  // one, /cards falls back to docs_copied then updated_at DESC: recency-ordered, not blank.
  try { await backfillTenant(tenantId); } catch (e) { console.error('[partner/own-org] backfill failed:', e); }
  try { await scoreTenantCards(tenantId); } catch (e) { console.error('[partner/own-org] scoring failed:', e); }
  try { await copyStarterSetToTenant(tenantId, { id: userId }); } catch (e) { console.error('[partner/own-org] starter-set copy failed:', e); }
  try { await backfillTenantTemplates(tenantId); } catch (e) { console.error('[partner/own-org] template backfill failed:', e); }
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
