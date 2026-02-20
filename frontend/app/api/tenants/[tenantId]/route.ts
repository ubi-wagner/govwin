/**
 * GET  /api/tenants/[tenantId]        — tenant detail + profile + users
 * PATCH /api/tenants/[tenantId]       — update tenant fields
 * POST /api/tenants/[tenantId]/users  — create user for this tenant (sends magic link or temp password)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'
import bcrypt from 'bcryptjs'

type Params = { params: { tenantId: string } }

async function requireAdmin() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') return null
  return session
}

// GET /api/tenants/[tenantId]
export async function GET(request: NextRequest, { params }: Params) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [tenant, profile, users, recentActions] = await Promise.all([
    sql`SELECT * FROM tenants WHERE id = ${params.tenantId}`,
    sql`SELECT * FROM tenant_profiles WHERE tenant_id = ${params.tenantId}`,
    sql`
      SELECT id, name, email, role, is_active, last_login_at, created_at
      FROM users WHERE tenant_id = ${params.tenantId}
      ORDER BY created_at DESC
    `,
    sql`
      SELECT ta.action_type, ta.created_at, u.name AS user_name, o.title AS opp_title
      FROM tenant_actions ta
      JOIN users u ON u.id = ta.user_id
      JOIN opportunities o ON o.id = ta.opportunity_id
      WHERE ta.tenant_id = ${params.tenantId}
      ORDER BY ta.created_at DESC
      LIMIT 20
    `,
  ])

  if (!tenant[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    tenant: tenant[0],
    profile: profile[0] ?? null,
    users,
    recentActions,
  })
}

// PATCH /api/tenants/[tenantId]
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  // Only allow updating safe fields
  const allowed = ['name', 'plan', 'status', 'primary_email', 'primary_phone',
                   'website', 'uei_number', 'cage_code', 'sam_registered',
                   'internal_notes', 'billing_email']

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const [updated] = await sql`
    UPDATE tenants
    SET ${sql(updates)}, updated_at = NOW()
    WHERE id = ${params.tenantId}
    RETURNING *
  `

  if (!updated) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  await auditLog({
    userId: session.user.id,
    tenantId: params.tenantId,
    action: 'tenant.updated',
    entityType: 'tenant',
    entityId: params.tenantId,
    newValue: updates,
  })

  return NextResponse.json({ data: updated })
}
