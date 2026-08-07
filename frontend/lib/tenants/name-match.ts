/**
 * Company-name matching for the partner add-company dedup precheck
 * (docs/PARTNER_MANAGER_DESIGN.md §4, D6).
 *
 * Two independent signals:
 *   • SIMILAR — pg_trgm similarity(name) ≥ threshold → the partner must review before creating a
 *     new tenant (a near-duplicate company name may already be a tenant).
 *   • EXACT   — same alphanumerics (case/punctuation-insensitive) → force the existing-tenant
 *     branch (request-manager), not a new registration.
 *
 * Reads run on the BYPASS (owner) pool: this is a cross-tenant scan of the global `tenants`
 * table (RLS-off), the same tables verifyTenantAccess reads. No tenant context needed.
 */
import { sqlBypass } from '@/lib/db';

/**
 * Resolve the similarity threshold from an env string, clamped to (0,1]; default 0.45.
 * Pure — exported so the fallback/clamp logic is unit-testable without env plumbing.
 */
export function resolveNameMatchThreshold(raw: string | undefined): number {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.45;
}

export const PARTNER_NAME_MATCH_THRESHOLD = resolveNameMatchThreshold(
  process.env.PARTNER_NAME_MATCH_THRESHOLD,
);

/**
 * Normalize a company name for exact-ish comparison: lowercase, drop common legal suffixes
 * and the leading article, collapse to single spaces. Pure. Used for display/test parity with
 * the SQL alnum-normalization the DB exact match uses.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|inc|llc|llp|lp|corp|corporation|co|ltd|company|group|holdings)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TenantNameMatch {
  id: string;
  slug: string;
  name: string;
  similarity: number;
  ownerId: string | null;
}

/** pg_trgm matches at or above `threshold`, most-similar first. Empty input → [] (no query). */
export async function findSimilarTenants(
  name: string,
  threshold: number = PARTNER_NAME_MATCH_THRESHOLD,
  limit = 8,
): Promise<TenantNameMatch[]> {
  const q = name.trim();
  if (!q) return [];
  return sqlBypass<TenantNameMatch[]>`
    SELECT id, slug, name, similarity(name, ${q})::float AS similarity, owner_id AS "ownerId"
    FROM tenants
    WHERE archived_at IS NULL AND similarity(name, ${q}) >= ${threshold}
    ORDER BY similarity(name, ${q}) DESC, name ASC
    LIMIT ${limit}`;
}

/**
 * Case/punctuation-insensitive exact match (same alphanumerics). Forces the existing-tenant
 * branch. Empty input → null (no query). Legal-suffix fuzz is handled by findSimilarTenants.
 */
export async function findExactTenant(name: string): Promise<TenantNameMatch | null> {
  const q = name.trim();
  if (!q) return null;
  const [hit] = await sqlBypass<TenantNameMatch[]>`
    SELECT id, slug, name, 1::float AS similarity, owner_id AS "ownerId"
    FROM tenants
    WHERE archived_at IS NULL
      AND lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))
        = lower(regexp_replace(${q},  '[^a-zA-Z0-9]+', '', 'g'))
    LIMIT 1`;
  return hit ?? null;
}
