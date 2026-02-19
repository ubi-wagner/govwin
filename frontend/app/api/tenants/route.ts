/**
 * Admin-only tenant management API
 *
 * GET  /api/tenants           — list all tenants with stats
 * POST /api/tenants           — create new tenant
 * GET  /api/tenants/[id]      — tenant detail + profile + users
 * PATCH /api/tenants/[id]     — update tenant
 * POST /api/tenants/[id]/users — create user for tenant
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

// ── Guard: master_admin only ──────────────────────────────────
async function requireAdmin() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return null
  }
  return session
}

// GET /api/tenants
export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenants = await sql`
    SELECT
      t.*,
      COUNT(DISTINCT u.id)::INT              AS user_count,
      COUNT(DISTINCT to2.opportunity_id)::INT AS opportunity_count,
      COUNT(DISTINCT to2.opportunity_id)
        FILTER (WHERE to2.pursuit_status = 'pursuing')::INT AS pursuing_count,
      ROUND(AVG(to2.total_score), 1)         AS avg_score,
      MAX(ta.created_at)                     AS last_activity_at
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id AND u.is_active = true
    LEFT JOIN tenant_opportunities to2 ON to2.tenant_id = t.id
    LEFT JOIN tenant_actions ta ON ta.tenant_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `

  return NextResponse.json({ data: tenants })
}

// POST /api/tenants
export async function POST(request: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, slug, plan = 'starter', primaryEmail, internalNotes } = body

  if (!name || !slug) {
    return NextResponse.json({ error: 'name and slug required' }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase alphanumeric with hyphens' }, { status: 400 })
  }

  try {
    const [tenant] = await sql`
      INSERT INTO tenants (name, slug, plan, primary_email, internal_notes, onboarded_at)
      VALUES (${name}, ${slug}, ${plan}, ${primaryEmail ?? null}, ${internalNotes ?? null}, NOW())
      RETURNING *
    `

    // Create empty profile for this tenant
    await sql`
      INSERT INTO tenant_profiles (tenant_id)
      VALUES (${tenant.id})
    `

    await auditLog({
      userId: session.user.id,
      tenantId: tenant.id,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      newValue: { name, slug, plan },
    })

    return NextResponse.json({ data: tenant }, { status: 201 })

  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
    }
    console.error('[POST /api/tenants] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
