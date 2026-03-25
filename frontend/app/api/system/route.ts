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
    // After migration 018, source_health and api_keys contain rich objects
    const rawSourceHealth = raw.source_health ?? {}
    const sourceHealth: Record<string, any> = {}
    for (const [src, detail] of Object.entries(rawSourceHealth)) {
      const d = detail as Record<string, any> | string
      if (typeof d === 'string') {
        // Pre-018 format: plain status string
        sourceHealth[src] = {
          status: d,
          consecutiveFailures: 0,
          lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: null,
          avgDurationSeconds: null, successRate30d: null,
        }
      } else {
        sourceHealth[src] = {
          status: d.status ?? 'unknown',
          consecutiveFailures: d.consecutive_failures ?? 0,
          lastSuccessAt: d.last_success_at ?? null,
          lastErrorAt: d.last_error_at ?? null,
          lastErrorMessage: d.last_error_message ?? null,
          avgDurationSeconds: d.avg_duration_seconds ?? null,
          successRate30d: d.success_rate_30d ?? null,
        }
      }
    }

    const rawApiKeys = raw.api_keys ?? {}
    const apiKeys: Record<string, any> = {}
    for (const [src, detail] of Object.entries(rawApiKeys)) {
      const d = detail as Record<string, any> | string
      if (typeof d === 'string') {
        // Pre-018 format: plain expiry status string
        apiKeys[src] = {
          expiryStatus: d,
          hasStoredKey: false, keyHint: null, expiresDate: null,
          daysUntilExpiry: null, lastValidatedAt: null,
          lastValidationOk: null, lastValidationMsg: null, rotatedAt: null,
        }
      } else {
        apiKeys[src] = {
          expiryStatus: d.expiry_status ?? 'no_expiry',
          hasStoredKey: d.has_stored_key ?? false,
          keyHint: d.key_hint ?? null,
          expiresDate: d.expires_date ?? null,
          daysUntilExpiry: d.days_until_expiry ?? null,
          lastValidatedAt: d.last_validated_at ?? null,
          lastValidationOk: d.last_validation_ok ?? null,
          lastValidationMsg: d.last_validation_msg ?? null,
          rotatedAt: d.rotated_at ?? null,
        }
      }
    }

    const status: SystemStatus = {
      pipelineJobs: {
        pending: raw.pipeline_jobs?.pending ?? 0,
        running: raw.pipeline_jobs?.running ?? 0,
        failed24h: raw.pipeline_jobs?.failed_24h ?? 0,
        failedTotal: raw.pipeline_jobs?.failed_total ?? 0,
        completed24h: raw.pipeline_jobs?.completed_24h ?? 0,
        staleRunning: raw.pipeline_jobs?.stale_running ?? 0,
      },
      tenants: {
        total: raw.tenants?.total ?? 0,
        active: raw.tenants?.active ?? 0,
        trial: raw.tenants?.trial ?? 0,
      },
      sourceHealth,
      apiKeys,
      rateLimits: raw.rate_limits ?? {},
      checkedAt: raw.checked_at ?? new Date().toISOString(),
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('[/api/system] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
