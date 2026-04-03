/**
 * GET /api/admin/waitlist — List all waitlist signups for admin review
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const rows = await sql`
      SELECT
        id, email, full_name, phone, company, company_size, technology, notes,
        plan, billing_period, ip_address, user_agent, referer, country, region, city,
        created_at
      FROM waitlist
      ORDER BY created_at DESC
    `
    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[GET /api/admin/waitlist] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch waitlist.' }, { status: 500 })
  }
}
