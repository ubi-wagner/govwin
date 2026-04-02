/**
 * GET   /api/portal/[tenantSlug]/purchases/[purchaseId] — Purchase detail
 * PATCH /api/portal/[tenantSlug]/purchases/[purchaseId] — Cancel purchase
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; purchaseId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, purchaseId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/purchases/[id]] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/purchases/[id]] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [purchase] = await sql`
      SELECT
        pp.id, pp.tenant_id, pp.proposal_id, pp.opportunity_id,
        pp.purchase_type, pp.price_cents, pp.status,
        pp.purchased_at, pp.cancellation_deadline,
        pp.template_delivered_at, pp.cancelled_at, pp.refund_reason,
        p.title AS proposal_title,
        mt.template_name
      FROM proposal_purchases pp
      LEFT JOIN proposals p ON pp.proposal_id = p.id
      LEFT JOIN master_templates mt ON pp.master_template_id = mt.id
      WHERE pp.id = ${purchaseId} AND pp.tenant_id = ${tenant.id}
    `

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    return NextResponse.json({ data: purchase })
  } catch (error) {
    console.error('[GET /api/portal/purchases/[id]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, purchaseId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[PATCH /api/portal/purchases/[id]] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[PATCH /api/portal/purchases/[id]] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only tenant_admin or master_admin can cancel
  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can cancel purchases' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, reason } = body

  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Only "cancel" action is supported' }, { status: 400 })
  }

  try {
    // Fetch current purchase
    const [purchase] = await sql`
      SELECT id, status, cancellation_deadline, template_delivered_at, proposal_id
      FROM proposal_purchases
      WHERE id = ${purchaseId} AND tenant_id = ${tenant.id}
    `

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    if (purchase.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending purchases can be cancelled' }, { status: 409 })
    }

    if (purchase.templateDeliveredAt) {
      return NextResponse.json({ error: 'Cannot cancel after template has been delivered' }, { status: 409 })
    }

    const now = new Date()
    const deadline = new Date(purchase.cancellationDeadline)
    if (now >= deadline) {
      return NextResponse.json({ error: 'Cancellation deadline has passed' }, { status: 409 })
    }

    const [updated] = await sql`
      UPDATE proposal_purchases
      SET status = 'cancelled', cancelled_at = NOW(), refund_reason = ${reason ?? null}
      WHERE id = ${purchaseId}
      RETURNING *
    `

    // Clear purchase reference on proposal if linked
    if (purchase.proposalId) {
      await sql`
        UPDATE proposals SET purchase_id = NULL WHERE id = ${purchase.proposalId} AND purchase_id = ${purchaseId}
      `
    }

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'purchase.cancelled',
      userId: session.user.id,
      entityType: 'purchase',
      entityId: purchaseId,
      description: `Purchase cancelled${reason ? `: ${reason}` : ''}`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: {
        purchaseId,
        reason: reason ?? null,
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[PATCH /api/portal/purchases/[id]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
