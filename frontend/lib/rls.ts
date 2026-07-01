import { sql } from '@/lib/db';

/**
 * Run `fn` inside a transaction with the `app.tenant_id` GUC set, so the RLS
 * policies on the greenfield tenant tables (mig 094+) scope every statement to this
 * tenant. `set_config(..., true)` = SET LOCAL, so it's confined to the transaction.
 *
 * The customer-facing path calls this with the authenticated tenant. The system
 * bridge consumer calls it per TARGET tenant as it fans a card out (so even the
 * cross-tenant fan-out writes pass the per-tenant policy, tenant by tenant).
 *
 * Enforcement is live once the app connects as the non-owner `govtech_app` role;
 * under the current owner/superuser connection the GUC is still set (harmless) and
 * the SQL tenant predicates remain the belt — so this is safe to adopt now.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return sql.begin(async (tx: any) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
