/**
 * GET /api/admin/purchases — List proposal purchases (admin only)
 *
 * Query params:
 *   status — filter by status (pending, active, template_delivered, cancelled, all)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status') ?? 'pending'

  try {
    let purchases
    if (statusFilter === 'all') {
      purchases = await sql`
        SELECT
          pp.id, pp.tenant_id, pp.proposal_id, pp.purchase_type,
          pp.price_cents, pp.status, pp.purchased_at,
          pp.cancellation_deadline, pp.template_delivered_at,
          t.name AS tenant_name, t.slug AS tenant_slug,
          p.title AS proposal_title
        FROM proposal_purchases pp
        JOIN tenants t ON t.id = pp.tenant_id
        LEFT JOIN proposals p ON p.id = pp.proposal_id
        ORDER BY pp.purchased_at DESC
        LIMIT 100
      `
    } else {
      purchases = await sql`
        SELECT
          pp.id, pp.tenant_id, pp.proposal_id, pp.purchase_type,
          pp.price_cents, pp.status, pp.purchased_at,
          pp.cancellation_deadline, pp.template_delivered_at,
          t.name AS tenant_name, t.slug AS tenant_slug,
          p.title AS proposal_title
        FROM proposal_purchases pp
        JOIN tenants t ON t.id = pp.tenant_id
        LEFT JOIN proposals p ON p.id = pp.proposal_id
        WHERE pp.status = ${statusFilter}
        ORDER BY pp.purchased_at DESC
        LIMIT 100
      `
    }

    return NextResponse.json({ data: purchases })
  } catch (error) {
    console.error('[GET /api/admin/purchases] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch purchases' }, { status: 500 })
  }
}
