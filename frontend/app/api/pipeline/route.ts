import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'

// GET /api/pipeline — list jobs + schedules
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'jobs'

  if (view === 'schedules') {
    const schedules = await sql`
      SELECT * FROM pipeline_schedules ORDER BY priority ASC
    `
    return NextResponse.json({ data: schedules })
  }

  if (view === 'runs') {
    const runs = await sql`
      SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 50
    `
    return NextResponse.json({ data: runs })
  }

  // Default: recent jobs
  const jobs = await sql`
    SELECT * FROM pipeline_jobs
    ORDER BY triggered_at DESC
    LIMIT 50
  `
  return NextResponse.json({ data: jobs })
}

// POST /api/pipeline — trigger a new job
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { source, runType = 'full', priority = 5, parameters = {} } = body

  if (!source) {
    return NextResponse.json({ error: 'source required' }, { status: 400 })
  }

  const [job] = await sql`
    INSERT INTO pipeline_jobs (source, run_type, priority, triggered_by, parameters)
    VALUES (${source}, ${runType}, ${priority}, ${session.user.email ?? 'admin'}, ${JSON.stringify(parameters)})
    RETURNING *
  `

  await auditLog({
    userId: session.user.id,
    action: 'pipeline.job_triggered',
    entityType: 'pipeline_job',
    entityId: job.id,
    newValue: { source, runType, priority },
  })

  return NextResponse.json({ data: job }, { status: 201 })
}
