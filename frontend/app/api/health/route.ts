/**
 * GET /api/health
 * Railway health check endpoint.
 * Returns 200 when the app is up and can reach the database.
 */
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function GET() {
  try {
    // Quick DB connectivity check
    await sql`SELECT 1`
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Database unreachable' },
      { status: 503 }
    )
  }
}
