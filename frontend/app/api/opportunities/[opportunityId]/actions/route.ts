/**
 * POST /api/opportunities/[opportunityId]/actions
 * Record a tenant action: thumbs_up, thumbs_down, comment, pin, status_change
 *
 * GET /api/opportunities/[opportunityId]/actions?tenantSlug=xxx
 * Get all actions for this opportunity for this tenant
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import type { ActionType, AppSession } from '@/types'

type Params = { params: Promise<{ opportunityId: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const session = (await auth()) as AppSession | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const { opportunityId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { tenantSlug, actionType, value, metadata } = body as {
    tenantSlug?: string
    actionType?: string
    value?: string
    metadata?: Record<string, unknown>
  }

  if (!tenantSlug || !actionType) {
    return NextResponse.json({ error: 'tenantSlug and actionType required' }, { status: 400 })
  }

  const validActions: ActionType[] = ['thumbs_up', 'thumbs_down', 'comment', 'note', 'status_change', 'pin']
  if (!validActions.includes(actionType as ActionType)) {
    return NextResponse.json({ error: 'Invalid actionType' }, { status: 400 })
  }

  let tenant: Record<string, unknown> | null
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[POST /api/opportunities/actions] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(userId, session.user.role, tenant.id as string)
  } catch (error) {
    console.error('[POST /api/opportunities/actions] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Get current score context for the action record
    const [tenantOpp] = await sql`
      SELECT total_score, o.agency_code, o.opportunity_type
      FROM tenant_opportunities to2
      JOIN opportunities o ON o.id = to2.opportunity_id
      WHERE to2.tenant_id = ${tenant.id as string}
        AND to2.opportunity_id = ${opportunityId}
    `

    // For thumbs: toggle (remove if already set, add if not)
    if (actionType === 'thumbs_up' || actionType === 'thumbs_down') {
      const opposite = actionType === 'thumbs_up' ? 'thumbs_down' : 'thumbs_up'

      // Remove opposite reaction if exists
      await sql`
        DELETE FROM tenant_actions
        WHERE tenant_id = ${tenant.id as string}
          AND opportunity_id = ${opportunityId}
          AND user_id = ${userId}
          AND action_type = ${opposite}
      `

      // Toggle this reaction
      const [existing] = await sql`
        SELECT id FROM tenant_actions
        WHERE tenant_id = ${tenant.id as string}
          AND opportunity_id = ${opportunityId}
          AND user_id = ${userId}
          AND action_type = ${actionType}
      `

      if (existing) {
        await sql`
          DELETE FROM tenant_actions WHERE id = ${existing.id}
        `
        return NextResponse.json({ action: 'removed', actionType })
      }
    }

    // For status_change: update pursuit_status on tenant_opportunities
    if (actionType === 'status_change' && value) {
      const valid = ['unreviewed', 'pursuing', 'monitoring', 'passed']
      if (!valid.includes(value)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }

      // Enforce active opp cap when moving to 'pursuing' or 'monitoring'
      if (value === 'pursuing' || value === 'monitoring') {
        const [cap] = await sql`
          SELECT * FROM check_opp_cap(${tenant.id as string}::uuid)
        `
        if (cap && !cap.can_attach) {
          return NextResponse.json({
            error: `Active opportunity limit reached (${cap.active_count}/${cap.max_allowed}). Upgrade your plan or dismiss existing opportunities.`,
            code: 'OPP_CAP_REACHED',
            activeCount: Number(cap.active_count),
            maxAllowed: cap.max_allowed,
          }, { status: 429 })
        }
      }

      const [prevStatus] = await sql`
        SELECT pursuit_status FROM tenant_opportunities
        WHERE tenant_id = ${tenant.id as string} AND opportunity_id = ${opportunityId}
      `

      await sql`
        UPDATE tenant_opportunities
        SET pursuit_status = ${value}
        WHERE tenant_id = ${tenant.id as string}
          AND opportunity_id = ${opportunityId}
      `

      // Emit customer event for status change
      const eventType = value === 'pursuing' || value === 'monitoring'
        ? 'finder.opp_attached'
        : value === 'passed'
          ? 'finder.opp_dismissed'
          : null

      if (eventType) {
        try {
          await sql`
            INSERT INTO customer_events
              (tenant_id, user_id, event_type, opportunity_id, description, metadata)
            VALUES (
              ${tenant.id as string},
              ${userId},
              ${eventType},
              ${opportunityId},
              ${'Status changed from ' + (prevStatus?.pursuitStatus ?? 'unreviewed') + ' to ' + value},
              ${JSON.stringify({
                old_status: prevStatus?.pursuitStatus ?? 'unreviewed',
                new_status: value,
                total_score: tenantOpp?.totalScore ?? null,
              })}::jsonb
            )
          `
        } catch (eventErr) {
          console.error('[POST /api/opportunities/actions] Event emission error:', eventErr)
        }
      }
    }

    // Insert action record
    const [action] = await sql`
      INSERT INTO tenant_actions (
        tenant_id, opportunity_id, user_id, action_type,
        value, metadata, score_at_action, agency_at_action, type_at_action
      ) VALUES (
        ${tenant.id as string}, ${opportunityId}, ${userId},
        ${actionType}, ${value ?? null},
        ${metadata ? JSON.stringify(metadata) : null},
        ${tenantOpp?.totalScore ?? null},
        ${tenantOpp?.agencyCode ?? null},
        ${tenantOpp?.opportunityType ?? null}
      )
      RETURNING *
    `

    return NextResponse.json({ action: 'created', data: action })

  } catch (error: unknown) {
    // Handle unique constraint violations
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
      return NextResponse.json({ error: 'Action already exists' }, { status: 409 })
    }
    console.error('[POST /api/opportunities/actions] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = (await auth()) as AppSession | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const { opportunityId } = await params
  const { searchParams } = new URL(request.url)
  const tenantSlug = searchParams.get('tenantSlug')
  if (!tenantSlug) return NextResponse.json({ error: 'tenantSlug required' }, { status: 400 })

  let tenant: Record<string, unknown> | null
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/opportunities/actions] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(userId, session.user.role, tenant.id as string)
  } catch (error) {
    console.error('[GET /api/opportunities/actions] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const actions = await sql`
      SELECT ta.*, u.name AS user_name
      FROM tenant_actions ta
      JOIN users u ON u.id = ta.user_id
      WHERE ta.tenant_id = ${tenant.id as string}
        AND ta.opportunity_id = ${opportunityId}
      ORDER BY ta.created_at DESC
    `

    return NextResponse.json({ data: actions })
  } catch (error) {
    console.error('[GET /api/opportunities/actions] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
