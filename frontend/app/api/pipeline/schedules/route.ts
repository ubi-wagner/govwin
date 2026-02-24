import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

// PATCH /api/pipeline/schedules — toggle schedule enabled/disabled
export async function PATCH(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { id, enabled } = body

  if (!id || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'id and enabled required' }, { status: 400 })
  }

  const [schedule] = await sql`
    UPDATE pipeline_schedules SET enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `

  return NextResponse.json({ data: schedule })
}
