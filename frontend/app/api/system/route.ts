import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import type { SystemStatus } from '@/types'

/**
 * GET /api/system — master admin system status
 *
 * get_system_status() returns JSONB with snake_case keys.
 * postgres.js toCamel only transforms column names, not JSONB internals.
 * We transform the keys here so the React components get camelCase.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [{ getSystemStatus: raw }] = await sql`SELECT get_system_status()`

    // Transform snake_case JSONB keys to camelCase for frontend
    const status: SystemStatus = {
      pipelineJobs: {
        pending: raw.pipeline_jobs?.pending ?? 0,
        running: raw.pipeline_jobs?.running ?? 0,
        failed24h: raw.pipeline_jobs?.failed_24h ?? 0,
      },
      tenants: {
        total: raw.tenants?.total ?? 0,
        active: raw.tenants?.active ?? 0,
        trial: raw.tenants?.trial ?? 0,
      },
      sourceHealth: raw.source_health ?? {},
      apiKeys: raw.api_keys ?? {},
      rateLimits: raw.rate_limits ?? {},
      checkedAt: raw.checked_at ?? new Date().toISOString(),
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('[/api/system] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
