import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * GET /api/automation — Automation rules and execution log
 *
 * Query params:
 *   view:     'rules' | 'log' (default 'rules')
 *   limit:    number (default 100, max 500)
 *   rule_id:  UUID — filter log by rule (only for view=log)
 *   fired:    'true' | 'false' — filter log by fired status (only for view=log)
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'rules'
  const limitParam = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 1), 500)

  try {
    if (view === 'rules') {
      const rows = await sql`
        SELECT
          r.id, r.name, r.description,
          r.trigger_bus, r.trigger_events,
          r.conditions, r.action_type, r.action_config,
          r.enabled, r.priority, r.cooldown_seconds, r.max_fires_per_hour,
          r.created_at, r.updated_at,
          (SELECT COUNT(*) FROM automation_log al WHERE al.rule_id = r.id AND al.fired = TRUE) AS total_fires,
          (SELECT COUNT(*) FROM automation_log al WHERE al.rule_id = r.id AND al.fired = FALSE) AS total_skips,
          (SELECT MAX(al.created_at) FROM automation_log al WHERE al.rule_id = r.id AND al.fired = TRUE) AS last_fired_at
        FROM automation_rules r
        ORDER BY r.priority ASC, r.name ASC
      `
      return NextResponse.json({ data: rows })

    } else if (view === 'log') {
      const ruleIdFilter = searchParams.get('rule_id')
      const firedFilter = searchParams.get('fired')

      const rows = await sql`
        SELECT
          al.id, al.rule_id, al.rule_name,
          al.trigger_event_id, al.trigger_event_type, al.trigger_bus,
          al.fired, al.skip_reason,
          al.action_type, al.action_result,
          al.event_metadata, al.correlation_id,
          al.created_at
        FROM automation_log al
        WHERE TRUE
          ${ruleIdFilter ? sql`AND al.rule_id = ${ruleIdFilter}` : sql``}
          ${firedFilter === 'true' ? sql`AND al.fired = TRUE` : firedFilter === 'false' ? sql`AND al.fired = FALSE` : sql``}
        ORDER BY al.created_at DESC
        LIMIT ${limitParam}
      `
      return NextResponse.json({ data: rows })

    } else {
      return NextResponse.json({ error: 'view must be "rules" or "log"' }, { status: 400 })
    }
  } catch (error) {
    console.error('[GET /api/automation] error:', error)
    return NextResponse.json({ error: 'Failed to load automation data' }, { status: 500 })
  }
}

/**
 * PATCH /api/automation — Toggle automation rule enabled/disabled
 *
 * Body: { ruleId: string, enabled: boolean }
 */
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { ruleId?: string; enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.ruleId || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'ruleId and enabled are required' }, { status: 400 })
  }

  try {
    const result = await sql`
      UPDATE automation_rules
      SET enabled = ${body.enabled}, updated_at = NOW()
      WHERE id = ${body.ruleId}
      RETURNING id, name, enabled
    `
    if (result.length === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }
    return NextResponse.json({ data: result[0] })
  } catch (error) {
    console.error('[PATCH /api/automation] error:', error)
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 })
  }
}
