/**
 * GET    /api/portal/[tenantSlug]/drive/[gid] — Get file metadata or download
 * PATCH  /api/portal/[tenantSlug]/drive/[gid] — Update file metadata
 * DELETE /api/portal/[tenantSlug]/drive/[gid] — Delete file
 *
 * [gid] is the stored_files.id (UUID). For backwards compat, also checks gid column.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { readStoredFile, deleteFile, getFileStats } from '@/lib/storage'
import type { AppSession } from '@/types'

type Params = { params: Promise<{ tenantSlug: string; gid: string }> }

async function resolveContext(params: Promise<{ tenantSlug: string; gid: string }>) {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { tenantSlug, gid } = await params

  let tenant: Record<string, unknown> | null
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[/api/portal/drive/[gid]] Tenant resolution error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id as string)
  } catch (error) {
    console.error('[/api/portal/drive/[gid]] Access check error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!hasAccess) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { session, tenant, fileId: gid }
}

// ── GET: File metadata from DB + optional download ──────────────
export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { tenant, fileId } = ctx

  try {
    // Look up by id or gid
    const [dbFile] = await sql`
      SELECT * FROM stored_files
      WHERE (id = ${fileId} OR gid = ${fileId})
        AND tenant_id = ${tenant.id as string}
    `
    if (!dbFile) {
      return NextResponse.json({ error: 'File not found for this tenant' }, { status: 404 })
    }

    // If ?download=true, stream the actual file
    const download = request.nextUrl.searchParams.get('download')
    if (download === 'true' && dbFile.storagePath) {
      const content = await readStoredFile(dbFile.storagePath as string)
      if (!content) {
        return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
      }
      return new NextResponse(new Uint8Array(content), {
        headers: {
          'Content-Type': (dbFile.mimeType as string) ?? 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${dbFile.name}"`,
          'Content-Length': String(content.length),
        },
      })
    }

    // Otherwise return metadata
    const stats = dbFile.storagePath ? await getFileStats(dbFile.storagePath as string) : null

    return NextResponse.json({
      data: {
        id: dbFile.id,
        name: dbFile.name,
        type: dbFile.type,
        mimeType: dbFile.mimeType,
        storagePath: dbFile.storagePath,
        artifactType: dbFile.artifactType,
        size: stats?.size ?? dbFile.fileSizeBytes,
        createdAt: dbFile.createdAt,
        modifiedAt: stats?.modifiedAt ?? dbFile.updatedAt,
      },
    })
  } catch (error) {
    console.error('[GET /api/portal/drive/[gid]] Error:', error)
    return NextResponse.json({ error: 'Failed to get file metadata' }, { status: 500 })
  }
}

// ── PATCH: Update file metadata ─────────────────────────────────
export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant, fileId } = ctx

  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: { name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const [updated] = await sql`
      UPDATE stored_files SET
        name = COALESCE(${body.name ?? null}, name),
        updated_at = now()
      WHERE (id = ${fileId} OR gid = ${fileId})
        AND tenant_id = ${tenant.id as string}
      RETURNING id, name
    `
    if (!updated) {
      return NextResponse.json({ error: 'File not found for this tenant' }, { status: 404 })
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[PATCH /api/portal/drive/[gid]] Error:', error)
    return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
  }
}

// ── DELETE: Delete file ─────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant, fileId } = ctx

  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const [dbFile] = await sql`
      SELECT id, storage_path FROM stored_files
      WHERE (id = ${fileId} OR gid = ${fileId})
        AND tenant_id = ${tenant.id as string}
    `
    if (!dbFile) {
      return NextResponse.json({ error: 'File not found for this tenant' }, { status: 404 })
    }

    // Delete from filesystem
    if (dbFile.storagePath) {
      await deleteFile(dbFile.storagePath as string)
    }

    // Remove from index
    await sql`
      DELETE FROM stored_files WHERE id = ${dbFile.id}
    `

    return NextResponse.json({ data: { deleted: true } })
  } catch (error) {
    console.error('[DELETE /api/portal/drive/[gid]] Error:', error)
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
