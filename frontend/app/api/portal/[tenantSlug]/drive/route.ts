/**
 * GET  /api/portal/[tenantSlug]/drive — List Drive files for tenant
 * POST /api/portal/[tenantSlug]/drive — Provision tenant Drive folder (service account)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import {
  provisionTenantDrive,
  shareDriveFolder,
  listDriveFiles,
  driveFileType,
} from '@/lib/google-drive'
import type { AppSession } from '@/types'

type Params = { params: Promise<{ tenantSlug: string }> }

// ── Shared auth + tenant resolution ────────────────────────────
async function resolveContext(params: Promise<{ tenantSlug: string }>) {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[/api/portal/drive] Tenant resolution error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[/api/portal/drive] Access check error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!hasAccess) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { session, tenant }
}

// ── GET: List files from tenant's Drive folder ─────────────────
export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant } = ctx

  if (!tenant.driveFolderId) {
    return NextResponse.json({ data: [], driveFolderId: null })
  }

  const folderId = request.nextUrl.searchParams.get('folderId') ?? tenant.driveFolderId
  const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined

  try {
    const { files, nextPageToken } = await listDriveFiles(folderId, pageToken)

    // Sync file index to DB
    for (const file of files) {
      if (!file.id) continue
      try {
        await sql`
          INSERT INTO drive_files (gid, name, type, mime_type, tenant_id, parent_gid, web_view_link, auto_created)
          VALUES (
            ${file.id},
            ${file.name ?? 'Untitled'},
            ${driveFileType(file.mimeType)},
            ${file.mimeType ?? null},
            ${tenant.id},
            ${folderId},
            ${file.webViewLink ?? null},
            false
          )
          ON CONFLICT (gid) DO UPDATE SET
            name = EXCLUDED.name,
            mime_type = EXCLUDED.mime_type,
            web_view_link = EXCLUDED.web_view_link,
            updated_at = now()
        `
      } catch (syncError) {
        console.error('[GET /api/portal/drive] File sync error:', syncError)
      }
    }

    return NextResponse.json({
      data: files.map((f) => ({
        gid: f.id,
        name: f.name,
        mimeType: f.mimeType,
        type: driveFileType(f.mimeType),
        webViewLink: f.webViewLink,
        size: f.size,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
      })),
      driveFolderId: tenant.driveFolderId,
      nextPageToken,
    })
  } catch (error) {
    console.error('[GET /api/portal/drive] Drive API error:', error)
    return NextResponse.json({ error: 'Failed to list Drive files' }, { status: 500 })
  }
}

// ── POST: Provision tenant Drive folder ────────────────────────
export async function POST(_request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant } = ctx

  // Only admins can provision
  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Don't re-provision
  if (tenant.driveFolderId) {
    return NextResponse.json({ error: 'Drive folder already provisioned', driveFolderId: tenant.driveFolderId }, { status: 409 })
  }

  try {
    const { rootFolderId, subFolderIds } = await provisionTenantDrive(tenant.name)

    // Save root folder ID to tenant
    await sql`
      UPDATE tenants
      SET drive_folder_id = ${rootFolderId}, updated_at = now()
      WHERE id = ${tenant.id}
    `

    // Index the created folders in drive_files
    await sql`
      INSERT INTO drive_files (gid, name, type, mime_type, tenant_id, parent_gid, auto_created)
      VALUES (
        ${rootFolderId},
        ${tenant.name},
        'FOLDER',
        'application/vnd.google-apps.folder',
        ${tenant.id},
        ${null},
        true
      )
    `
    for (const [name, gid] of Object.entries(subFolderIds)) {
      await sql`
        INSERT INTO drive_files (gid, name, type, mime_type, tenant_id, parent_gid, auto_created)
        VALUES (
          ${gid},
          ${name},
          'FOLDER',
          'application/vnd.google-apps.folder',
          ${tenant.id},
          ${rootFolderId},
          true
        )
      `
    }

    // Log the execution
    await sql`
      INSERT INTO integration_executions (function_name, tenant_id, status, completed_at, success, parameters, result)
      VALUES (
        'drive.provisionTenant',
        ${tenant.id},
        'COMPLETED',
        now(),
        true,
        ${sql.json({ tenantName: tenant.name })}::jsonb,
        ${sql.json({ rootFolderId, subFolderIds })}::jsonb
      )
    `

    // Share with the requesting user if they have a Google email
    if (session.user.email) {
      try {
        await shareDriveFolder(rootFolderId, session.user.email, 'writer')
      } catch (shareError) {
        console.error('[POST /api/portal/drive] Share error (non-fatal):', shareError)
      }
    }

    return NextResponse.json({
      data: { driveFolderId: rootFolderId, subFolderIds },
    }, { status: 201 })
  } catch (error) {
    // Log failed execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, tenant_id, status, completed_at, success, error_message)
        VALUES (
          'drive.provisionTenant',
          ${tenant.id},
          'FAILED',
          now(),
          false,
          ${error instanceof Error ? error.message : 'Unknown error'}
        )
      `
    } catch (logError) {
      console.error('[POST /api/portal/drive] Failed to log execution:', logError)
    }

    console.error('[POST /api/portal/drive] Provisioning error:', error)
    return NextResponse.json({ error: 'Failed to provision Drive folder' }, { status: 500 })
  }
}
