/**
 * GET    /api/portal/[tenantSlug]/drive/[gid] — Get file metadata
 * PATCH  /api/portal/[tenantSlug]/drive/[gid] — Share file with a user
 * DELETE /api/portal/[tenantSlug]/drive/[gid] — Trash file
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { getServiceAccountDrive, shareDriveFolder, trashDriveFile } from '@/lib/google-drive'
import type { AppSession } from '@/types'

type Params = { params: Promise<{ tenantSlug: string; gid: string }> }

async function resolveContext(params: Promise<{ tenantSlug: string; gid: string }>) {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { tenantSlug, gid } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[/api/portal/drive/[gid]] Tenant resolution error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[/api/portal/drive/[gid]] Access check error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!hasAccess) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { session, tenant, gid }
}

// ── GET: File metadata from Drive API ──────────────────────────
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { tenant, gid } = ctx

  try {
    const drive = getServiceAccountDrive(process.env.GOOGLE_DELEGATED_ADMIN)
    const file = await drive.files.get({
      fileId: gid,
      fields: 'id, name, mimeType, webViewLink, exportLinks, size, createdTime, modifiedTime, permissions, parents',
    })

    // Verify this file belongs to the tenant (check DB index)
    const [dbFile] = await sql`
      SELECT id FROM drive_files WHERE gid = ${gid} AND tenant_id = ${tenant.id}
    `
    if (!dbFile) {
      return NextResponse.json({ error: 'File not found for this tenant' }, { status: 404 })
    }

    return NextResponse.json({ data: file.data })
  } catch (error: any) {
    if (error?.code === 404) {
      return NextResponse.json({ error: 'File not found in Drive' }, { status: 404 })
    }
    console.error('[GET /api/portal/drive/[gid]] Error:', error)
    return NextResponse.json({ error: 'Failed to get file metadata' }, { status: 500 })
  }
}

// ── PATCH: Share file with an email ────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant, gid } = ctx

  // Only admins can share
  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: { email?: string; role?: 'reader' | 'writer' | 'commenter' }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  try {
    await shareDriveFolder(gid, body.email, body.role ?? 'reader')
    return NextResponse.json({ data: { shared: true, email: body.email, role: body.role ?? 'reader' } })
  } catch (error) {
    console.error('[PATCH /api/portal/drive/[gid]] Share error:', error)
    return NextResponse.json({ error: 'Failed to share file' }, { status: 500 })
  }
}

// ── DELETE: Trash file ─────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant, gid } = ctx

  // Only admins can delete
  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Verify the file belongs to this tenant
  const [dbFile] = await sql`
    SELECT id FROM drive_files WHERE gid = ${gid} AND tenant_id = ${tenant.id}
  `
  if (!dbFile) {
    return NextResponse.json({ error: 'File not found for this tenant' }, { status: 404 })
  }

  try {
    await trashDriveFile(gid)

    // Remove from our index
    await sql`
      DELETE FROM drive_files WHERE gid = ${gid} AND tenant_id = ${tenant.id}
    `

    return NextResponse.json({ data: { trashed: true } })
  } catch (error) {
    console.error('[DELETE /api/portal/drive/[gid]] Trash error:', error)
    return NextResponse.json({ error: 'Failed to trash file' }, { status: 500 })
  }
}
