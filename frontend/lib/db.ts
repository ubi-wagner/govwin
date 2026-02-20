/**
 * Database connection + tenant-scoped query helpers
 *
 * Two connection objects:
 *   sql  — postgres.js for Next.js API routes (tagged template literals)
 *   pool — pg Pool for Auth.js adapter (callback-style)
 *
 * Connections are lazily initialized so Next.js build doesn't fail
 * when DATABASE_URL isn't set (Railway injects it at runtime).
 *
 * Tenant helpers enforce row-level isolation in every query.
 * Every API route that touches tenant data should use these.
 */
import postgres from 'postgres'
import { Pool } from 'pg'

// ── Lazy connection singletons ────────────────────────────────
let _sql: ReturnType<typeof postgres> | null = null
let _pool: Pool | null = null

function getDbUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is required')
  return url
}

/** postgres.js — primary query client for API routes */
export function getSql() {
  if (!_sql) {
    _sql = postgres(getDbUrl(), {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      transform: {
        column: postgres.toCamel,
      },
    })
  }
  return _sql
}

/** pg Pool — for Auth.js adapter (callback-style) */
export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDbUrl(),
      max: 5,
    })
  }
  return _pool
}

// Re-export as `sql` and `pool` via getters for ergonomic usage
// These resolve lazily on first property access at runtime, not at import time
export const sql = new Proxy({} as ReturnType<typeof postgres>, {
  get(_, prop) { return (getSql() as any)[prop] },
  apply(_, thisArg, args) { return (getSql() as any)(...args) },
})

export const pool = new Proxy({} as Pool, {
  get(_, prop) { return (getPool() as any)[prop] },
})

// ── Tenant context helpers ────────────────────────────────────

/**
 * Resolve a tenant slug to its UUID.
 * Used in portal API routes to get tenant_id from URL slug.
 * Returns null if slug not found or tenant is not active.
 */
export async function getTenantBySlug(slug: string) {
  const s = getSql()
  const [tenant] = await s`
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

  const s = getSql()
  const [user] = await s`
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
  const s = getSql()
  const [profile] = await s`
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
  const s = getSql()
  await s`
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
