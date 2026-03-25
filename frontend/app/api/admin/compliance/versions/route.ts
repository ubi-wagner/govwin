/**
 * GET /api/admin/compliance/versions — List all legal document versions
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
    const versions = await sql`
      SELECT
        document_type AS "documentType",
        version,
        effective_date AS "effectiveDate",
        summary_of_changes AS "summaryOfChanges",
        is_current AS "isCurrent",
        created_at AS "createdAt"
      FROM legal_document_versions
      ORDER BY document_type, created_at DESC
    `

    return NextResponse.json({ data: versions })
  } catch (error) {
    console.error('[GET /api/admin/compliance/versions] Error:', error)
    return NextResponse.json({ error: 'Failed to load versions' }, { status: 500 })
  }
}
