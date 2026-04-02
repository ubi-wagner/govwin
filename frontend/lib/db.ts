/**
 * Database connection + tenant-scoped query helpers
 *
 * Two connection objects:
 *   sql  — postgres.js for Next.js API routes (tagged template literals)
 *   pool — pg Pool for Auth.js adapter (callback-style)
 *
 * Tenant helpers enforce row-level isolation in every query.
 * Every API route that touches tenant data should use these.
 */
import postgres from 'postgres'
import { Pool } from 'pg'

// ── Validate DATABASE_URL at runtime (skip during build) ─────
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl && process.env.NODE_ENV === 'production' && !process.env.NEXT_PHASE) {
  throw new Error(
    'DATABASE_URL environment variable is not set. ' +
    'The application cannot start without a database connection.'
  )
}

// ── postgres.js — primary query client ────────────────────────
export const sql = postgres(databaseUrl ?? '', {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: {
    // Auto-convert snake_case columns to camelCase
    column: postgres.toCamel,
  },
  onnotice: () => {}, // Suppress notice messages
})

// postgres.js handles connection errors per-query (no global .on('error')),
// but we hook into process-level unhandled rejections as a safety net.
if (typeof process !== 'undefined' && !process.env.NEXT_PHASE) {
  process.once('unhandledRejection', (err) => {
    console.error('[db] Unhandled postgres.js rejection:', err)
  })
}

// ── pg Pool — Auth.js adapter ──────────────────────────────────
export const pool = new Pool({
  connectionString: databaseUrl ?? '',
  max: 5,
})

pool.on('error', (err) => {
  console.error('[db] Unexpected pg Pool error:', err)
})

// ── Tenant context helpers ────────────────────────────────────

/**
 * Resolve a tenant slug to its UUID.
 * Used in portal API routes to get tenant_id from URL slug.
 * Returns null if slug not found or tenant is not active.
 */
export async function getTenantBySlug(slug: string) {
  const [tenant] = await sql`
    SELECT id, slug, name, status, plan, features
    FROM tenants
    WHERE slug = ${slug} AND status IN ('active', 'trial')
  `
  return tenant ?? null
}

/**
 * Verify a user belongs to a tenant.
 * Master admins pass automatically.
 * Used in portal API routes to prevent cross-tenant access.
 */
export async function verifyTenantAccess(
  userId: string,
  role: string,
  tenantId: string
): Promise<boolean> {
  if (role === 'master_admin') return true

  const [user] = await sql`
    SELECT id FROM users
    WHERE id = ${userId}
      AND tenant_id = ${tenantId}
      AND is_active = true
  `
  return !!user
}

/**
 * Verify a user has access to a specific proposal.
 * Master admins: always allowed with full permissions.
 * Tenant users/admins: must belong to tenant, proposal must belong to tenant.
 * Partner users: must have active grant for this specific proposal.
 * Returns { hasAccess, permissions } where null permissions = full access.
 */
export async function verifyProposalAccess(
  userId: string,
  role: string,
  tenantId: string,
  proposalId: string
): Promise<{ hasAccess: boolean; permissions: Record<string, unknown> | null }> {
  // Master admin always allowed with full permissions
  if (role === 'master_admin') return { hasAccess: true, permissions: null }

  // Regular tenant users — check tenant membership + proposal belongs to tenant
  if (role === 'tenant_admin' || role === 'tenant_user') {
    const [user] = await sql`
      SELECT id FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} AND is_active = true
    `
    if (!user) return { hasAccess: false, permissions: null }
    const [proposal] = await sql`
      SELECT id FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `
    return { hasAccess: !!proposal, permissions: null } // null = full access
  }

  // Partner users — must have active grant for this specific proposal
  if (role === 'partner_user') {
    const [grant] = await sql`
      SELECT pag.permissions
      FROM partner_access_grants pag
      WHERE pag.user_id = ${userId}
        AND pag.proposal_id = ${proposalId}
        AND pag.tenant_id = ${tenantId}
        AND pag.status = 'active'
        AND (pag.expires_at IS NULL OR pag.expires_at > NOW())
    `
    if (!grant) return { hasAccess: false, permissions: null }
    return { hasAccess: true, permissions: grant.permissions }
  }

  return { hasAccess: false, permissions: null }
}

/**
 * Get tenant profile (scoring config) for the pipeline worker.
 * Returns null if no profile exists yet.
 */
export async function getTenantProfile(tenantId: string) {
  const [profile] = await sql`
    SELECT * FROM tenant_profiles WHERE tenant_id = ${tenantId}
  `
  return profile ?? null
}

/**
 * Log an audit event.
 * Call this from API routes on significant actions.
 */
export async function auditLog(params: {
  userId?: string
  tenantId?: string
  action: string
  entityType?: string
  entityId?: string
  oldValue?: unknown
  newValue?: unknown
}) {
  try {
    await sql`
      INSERT INTO audit_log (user_id, tenant_id, action, entity_type, entity_id, old_value, new_value)
      VALUES (
        ${params.userId ?? null},
        ${params.tenantId ?? null},
        ${params.action},
        ${params.entityType ?? null},
        ${params.entityId ?? null},
        ${params.oldValue ? JSON.stringify(params.oldValue) : null},
        ${params.newValue ? JSON.stringify(params.newValue) : null}
      )
    `
  } catch (e) {
    console.error('[auditLog] Failed to write audit entry:', e)
  }
}
