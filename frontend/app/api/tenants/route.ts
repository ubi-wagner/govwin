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
import { emitCustomerEvent, userActor } from '@/lib/events'
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

  try {
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
  } catch (error) {
    console.error('[GET /api/tenants] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

// POST /api/tenants
export async function POST(request: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
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

    // Auto-create admin user from primaryEmail if provided
    let adminUser: { id: string; email: string; _tempPassword: string } | null = null
    if (primaryEmail) {
      const tempPassword = crypto.randomBytes(8).toString('base64url')
      const passwordHash = await bcrypt.hash(tempPassword, 12)
      try {
        const [user] = await sql`
          INSERT INTO users (name, email, role, tenant_id, password_hash, temp_password)
          VALUES (${name + ' Admin'}, ${primaryEmail}, 'tenant_admin', ${tenant.id}, ${passwordHash}, true)
          RETURNING id, name, email, role, tenant_id, created_at
        `
        adminUser = { id: user.id as string, email: user.email as string, _tempPassword: tempPassword }

        await emitCustomerEvent({
          tenantId: tenant.id,
          eventType: 'account.user_added',
          userId: session.user!.id,
          entityType: 'user',
          entityId: user.id,
          description: `Admin user "${primaryEmail}" auto-created for tenant "${name}"`,
          actor: userActor(session.user!.id, session.user!.email ?? undefined),
          payload: {
            new_user_id: user.id,
            new_user_email: primaryEmail,
            new_user_role: 'tenant_admin',
            auto_created: true,
          },
        })
      } catch (userErr: any) {
        // Email might already exist — log but don't fail tenant creation
        if (userErr?.code === '23505') {
          console.error('[POST /api/tenants] Admin user email already exists:', primaryEmail)
        } else {
          console.error('[POST /api/tenants] Failed to auto-create admin user:', userErr)
        }
      }
    }

    await auditLog({
      userId: session.user!.id,
      tenantId: tenant.id,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      newValue: { name, slug, plan, adminCreated: !!adminUser },
    })

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'account.tenant_created',
      userId: session.user!.id,
      entityType: 'tenant',
      entityId: tenant.id,
      description: `Tenant "${name}" created with plan: ${plan}`,
      actor: userActor(session.user!.id, session.user!.email ?? undefined),
      payload: { name, slug, plan, primaryEmail: primaryEmail ?? null, adminAutoCreated: !!adminUser },
    })

    return NextResponse.json({
      data: tenant,
      adminUser: adminUser ? { id: adminUser.id, email: adminUser.email, _tempPassword: adminUser._tempPassword } : null,
    }, { status: 201 })

  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
    }
    console.error('[POST /api/tenants] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
