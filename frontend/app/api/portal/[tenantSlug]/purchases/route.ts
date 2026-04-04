/**
 * GET  /api/portal/[tenantSlug]/purchases — List purchases for tenant
 * POST /api/portal/[tenantSlug]/purchases — Create new purchase
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/purchases] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/purchases] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const purchases = await sql`
      SELECT
        pp.id, pp.tenant_id, pp.proposal_id, pp.opportunity_id,
        pp.purchase_type, pp.price_cents, pp.status,
        pp.purchased_at, pp.cancellation_deadline,
        pp.template_delivered_at, pp.cancelled_at, pp.refund_reason,
        p.title AS proposal_title,
        mt.template_name
      FROM proposal_purchases pp
      LEFT JOIN proposals p ON pp.proposal_id = p.id
      LEFT JOIN master_templates mt ON pp.template_id = mt.id
      WHERE pp.tenant_id = ${tenant.id}
      ORDER BY pp.purchased_at DESC
    `

    return NextResponse.json({ data: purchases })
  } catch (error) {
    console.error('[GET /api/portal/purchases] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[POST /api/portal/purchases] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[POST /api/portal/purchases] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only tenant_admin or master_admin can create purchases
  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can create purchases' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { proposalId, opportunityId, purchaseType } = body

  if (!purchaseType || !['phase_1', 'phase_2'].includes(purchaseType)) {
    return NextResponse.json({ error: 'purchaseType must be phase_1 or phase_2' }, { status: 400 })
  }
  if (!opportunityId) {
    return NextResponse.json({ error: 'opportunityId is required' }, { status: 400 })
  }

  const priceCents = purchaseType === 'phase_1' ? 49900 : 99900

  try {
    // Verify opportunity exists
    const oppRows = await sql`
      SELECT id, title FROM opportunities WHERE id = ${opportunityId}
    `
    if (oppRows.length === 0) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // If proposalId given, verify it belongs to tenant
    if (proposalId) {
      const proposalRows = await sql`
        SELECT id FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
      `
      if (proposalRows.length === 0) {
        return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
      }
    }

    const [purchase] = await sql`
      INSERT INTO proposal_purchases (
        tenant_id, proposal_id, opportunity_id, purchase_type,
        price_cents, status,
        cancellation_deadline
      ) VALUES (
        ${tenant.id},
        ${proposalId ?? null},
        ${opportunityId},
        ${purchaseType},
        ${priceCents},
        'pending',
        NOW() + interval '72 hours'
      )
      RETURNING *
    `

    // If proposal exists, update it with the purchase reference
    if (proposalId) {
      await sql`
        UPDATE proposals SET purchase_id = ${purchase.id} WHERE id = ${proposalId}
      `
    }

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'purchase.created',
      userId: session.user.id,
      entityType: 'purchase',
      entityId: purchase.id,
      description: `Purchase created: ${purchaseType} for "${oppRows[0].title}"`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: {
        purchaseId: purchase.id,
        purchaseType,
        priceCents,
        opportunityId,
        proposalId: proposalId ?? null,
      },
    })

    return NextResponse.json({ data: purchase }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/portal/purchases] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
