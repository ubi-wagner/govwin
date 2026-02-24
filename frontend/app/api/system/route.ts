import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [{ getSystemStatus: status }] = await sql`SELECT get_system_status()`
    return NextResponse.json(status)
  } catch (error) {
    console.error('[/api/system] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
