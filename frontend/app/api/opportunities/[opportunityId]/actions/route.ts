/**
 * POST /api/opportunities/[opportunityId]/actions
 * Record a tenant action: thumbs_up, thumbs_down, comment, pin, status_change
 *
 * GET /api/opportunities/[opportunityId]/actions?tenantSlug=xxx
 * Get all actions for this opportunity for this tenant
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess, auditLog } from '@/lib/db'
import type { ActionType } from '@/types'

type Params = { params: { opportunityId: string } }

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { tenantSlug, actionType, value, metadata } = body

  if (!tenantSlug || !actionType) {
    return NextResponse.json({ error: 'tenantSlug and actionType required' }, { status: 400 })
  }

  const validActions: ActionType[] = ['thumbs_up', 'thumbs_down', 'comment', 'note', 'status_change', 'pin']
  if (!validActions.includes(actionType)) {
    return NextResponse.json({ error: 'Invalid actionType' }, { status: 400 })
  }

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const userId = session.user.id

  const hasAccess = await verifyTenantAccess(userId, session.user.role, tenant.id)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Get current score context for the action record
    const [tenantOpp] = await sql`
      SELECT total_score, o.agency_code, o.opportunity_type
      FROM tenant_opportunities to2
      JOIN opportunities o ON o.id = to2.opportunity_id
      WHERE to2.tenant_id = ${tenant.id}
        AND to2.opportunity_id = ${params.opportunityId}
    `

    if (!tenantOpp) {
      return NextResponse.json({ error: 'Opportunity not found for this tenant' }, { status: 404 })
    }

    // For thumbs: toggle (remove if already set, add if not)
    if (actionType === 'thumbs_up' || actionType === 'thumbs_down') {
      const opposite = actionType === 'thumbs_up' ? 'thumbs_down' : 'thumbs_up'

      // Remove opposite reaction if exists
      await sql`
        DELETE FROM tenant_actions
        WHERE tenant_id = ${tenant.id}
          AND opportunity_id = ${params.opportunityId}
          AND user_id = ${userId}
          AND action_type = ${opposite}
      `

      // Toggle this reaction
      const [existing] = await sql`
        SELECT id FROM tenant_actions
        WHERE tenant_id = ${tenant.id}
          AND opportunity_id = ${params.opportunityId}
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

      await sql`
        UPDATE tenant_opportunities
        SET pursuit_status = ${value}
        WHERE tenant_id = ${tenant.id}
          AND opportunity_id = ${params.opportunityId}
      `
    }

    // Insert action record
    const [action] = await sql`
      INSERT INTO tenant_actions (
        tenant_id, opportunity_id, user_id, action_type,
        value, metadata, score_at_action, agency_at_action, type_at_action
      ) VALUES (
        ${tenant.id}, ${params.opportunityId}, ${userId},
        ${actionType}, ${value ?? null},
        ${metadata ? JSON.stringify(metadata) : null},
        ${tenantOpp.totalScore ?? null},
        ${tenantOpp.agencyCode ?? null},
        ${tenantOpp.opportunityType ?? null}
      )
      RETURNING *
    `

    return NextResponse.json({ action: 'created', data: action })

  } catch (error) {
    console.error('[/api/opportunities/actions] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tenantSlug = searchParams.get('tenantSlug')
  if (!tenantSlug) return NextResponse.json({ error: 'tenantSlug required' }, { status: 400 })

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const actions = await sql`
    SELECT ta.*, u.name AS user_name
    FROM tenant_actions ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.tenant_id = ${tenant.id}
      AND ta.opportunity_id = ${params.opportunityId}
    ORDER BY ta.created_at DESC
  `

  return NextResponse.json({ data: actions })
}
