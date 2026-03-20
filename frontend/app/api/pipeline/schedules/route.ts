import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

// PATCH /api/pipeline/schedules — toggle schedule enabled/disabled
export async function PATCH(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id, enabled } = body

  if (!id || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'id and enabled required' }, { status: 400 })
  }

  try {
    const [schedule] = await sql`
      UPDATE pipeline_schedules SET enabled = ${enabled}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    return NextResponse.json({ data: schedule })
  } catch (error) {
    console.error('[PATCH /api/pipeline/schedules] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
