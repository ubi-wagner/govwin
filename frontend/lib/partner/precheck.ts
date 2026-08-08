/**
 * Add-company precheck (docs/PARTNER_MANAGER_DESIGN.md §4). Three independent signals decide the
 * branch the partner takes:
 *   • emailInUseAsAdmin (D5) — hard block: the admin email is already a company owner/admin.
 *   • exactExistingTenant  — hard route to the manager-request branch (can't duplicate a tenant).
 *   • similar[]            — soft review: near-duplicate names the partner must vet before creating.
 */
import { findSimilarTenants, findExactTenant, type TenantNameMatch } from '@/lib/tenants/name-match';
import { emailActiveAsTenantAdmin } from '@/lib/partner/scope';

export type PrecheckVerdict = 'ok_new' | 'review_similar' | 'must_request_manager' | 'email_taken';

export interface PrecheckResult {
  verdict: PrecheckVerdict;
  exactExistingTenant: TenantNameMatch | null;
  similar: TenantNameMatch[];
  emailInUseAsAdmin: boolean;
}

/**
 * Pure decision: map the three signals to the recommended branch. email-taken and exact-match are
 * hard gates (checked first); similar is a soft review; otherwise clear to create a new company.
 */
export function classifyPrecheck(input: {
  exactExistingTenant: TenantNameMatch | null;
  similar: TenantNameMatch[];
  emailInUseAsAdmin: boolean;
}): PrecheckVerdict {
  if (input.emailInUseAsAdmin) return 'email_taken';
  if (input.exactExistingTenant) return 'must_request_manager';
  if (input.similar.length > 0) return 'review_similar';
  return 'ok_new';
}

/**
 * Run the full precheck (DB reads on the bypass pool). The exact match is removed from `similar`
 * so it isn't shown twice. An empty adminEmail skips the D5 email check (returns not-in-use).
 */
export async function runPrecheck(name: string, adminEmail: string): Promise<PrecheckResult> {
  const [exact, similarAll, emailInUseAsAdmin] = await Promise.all([
    findExactTenant(name),
    findSimilarTenants(name),
    adminEmail ? emailActiveAsTenantAdmin(adminEmail) : Promise.resolve(false),
  ]);
  const similar = exact ? similarAll.filter((t) => t.id !== exact.id) : similarAll;
  return {
    verdict: classifyPrecheck({ exactExistingTenant: exact, similar, emailInUseAsAdmin }),
    exactExistingTenant: exact,
    similar,
    emailInUseAsAdmin,
  };
}
