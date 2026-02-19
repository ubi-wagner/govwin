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

// ── postgres.js — primary query client ────────────────────────
export const sql = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: {
    // Auto-convert snake_case columns to camelCase
    column: postgres.toCamel,
  },
})

// ── pg Pool — Auth.js adapter ──────────────────────────────────
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
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
    WHERE slug = ${slug} AND status = 'active'
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
}
