/**
 * GET  /api/portal/[tenantSlug]/drive — List Drive files for tenant
 * POST /api/portal/[tenantSlug]/drive — Provision tenant Drive folder (tier-aware)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import {
  provisionTenantDrive,
  shareDriveFolder,
  listDriveFiles,
  driveFileType,
  createPipelineSnapshot,
  createDeadlineTracker,
  createAmendmentLog,
} from '@/lib/google-drive'
import type { AppSession, ProductTier } from '@/types'

type Params = { params: Promise<{ tenantSlug: string }> }

// ── Shared auth + tenant resolution ────────────────────────────
async function resolveContext(params: Promise<{ tenantSlug: string }>) {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { tenantSlug } = await params

  let tenant: Record<string, unknown> | null
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[/api/portal/drive] Tenant resolution error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id as string)
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
  const { tenant } = ctx

  const driveFolderId = (tenant.driveFolderId as string | null) ?? null
  if (!driveFolderId) {
    return NextResponse.json({ data: [], driveFolderId: null })
  }

  const folderId = request.nextUrl.searchParams.get('folderId') ?? driveFolderId
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
            ${tenant.id as string},
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
      driveFolderId,
      nextPageToken,
    })
  } catch (error) {
    console.error('[GET /api/portal/drive] Drive API error:', error)
    return NextResponse.json({ error: 'Failed to list Drive files' }, { status: 500 })
  }
}

// ── Helper: index a Drive folder in the DB ─────────────────────
async function indexDriveFolder(opts: {
  gid: string
  name: string
  tenantId: string | null
  parentGid: string | null
  artifactType: string
  artifactScope: string
  productTier: string | null
  opportunityId?: string | null
}) {
  await sql`
    INSERT INTO drive_files (
      gid, name, type, mime_type, tenant_id, parent_gid,
      auto_created, artifact_type, artifact_scope, product_tier, opportunity_id
    ) VALUES (
      ${opts.gid},
      ${opts.name},
      'FOLDER',
      'application/vnd.google-apps.folder',
      ${opts.tenantId},
      ${opts.parentGid},
      true,
      ${opts.artifactType},
      ${opts.artifactScope},
      ${opts.productTier},
      ${opts.opportunityId ?? null}
    )
    ON CONFLICT (gid) DO UPDATE SET
      name = EXCLUDED.name,
      artifact_type = EXCLUDED.artifact_type,
      artifact_scope = EXCLUDED.artifact_scope,
      product_tier = EXCLUDED.product_tier,
      updated_at = now()
  `
}

// ── Helper: index a Drive file (doc/sheet) in the DB ───────────
async function indexDriveFile(opts: {
  gid: string
  name: string
  type: string
  mimeType: string
  tenantId: string | null
  parentGid: string
  artifactType: string
  artifactScope: string
  productTier: string | null
}) {
  await sql`
    INSERT INTO drive_files (
      gid, name, type, mime_type, tenant_id, parent_gid,
      auto_created, artifact_type, artifact_scope, product_tier
    ) VALUES (
      ${opts.gid},
      ${opts.name},
      ${opts.type},
      ${opts.mimeType},
      ${opts.tenantId},
      ${opts.parentGid},
      true,
      ${opts.artifactType},
      ${opts.artifactScope},
      ${opts.productTier}
    )
    ON CONFLICT (gid) DO UPDATE SET
      name = EXCLUDED.name,
      artifact_type = EXCLUDED.artifact_type,
      updated_at = now()
  `
}

// ── POST: Provision tenant Drive folder (tier-aware) ───────────
export async function POST(_request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant } = ctx

  // Only admins can provision
  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const driveFolderId = (tenant.driveFolderId as string | null) ?? null
  // Don't re-provision
  if (driveFolderId) {
    return NextResponse.json({ error: 'Drive folder already provisioned', driveFolderId }, { status: 409 })
  }

  const tenantId = tenant.id as string
  const tenantName = tenant.name as string
  const tier = (tenant.productTier as ProductTier | null) ?? 'finder'

  // Get the customers folder from system config
  let customersFolderId: string | undefined
  try {
    const [config] = await sql`
      SELECT value FROM system_config WHERE key = 'drive.customers_folder_id'
    `
    const val = config?.value
    if (val && val !== 'null' && val !== '"null"') {
      customersFolderId = typeof val === 'string' ? val : JSON.stringify(val).replace(/"/g, '')
    }
  } catch (e) {
    console.error('[POST /api/portal/drive] Config lookup error:', e)
  }

  try {
    const structure = await provisionTenantDrive(tenantName, tier, customersFolderId)

    // Save folder IDs to tenant
    await sql`
      UPDATE tenants SET
        drive_folder_id = ${structure.rootFolderId},
        drive_finder_folder_id = ${structure.finderFolderId},
        drive_reminders_folder_id = ${structure.remindersFolderId},
        drive_binder_folder_id = ${structure.binderFolderId},
        drive_grinder_folder_id = ${structure.grinderFolderId},
        drive_uploads_folder_id = ${structure.uploadsFolderId},
        updated_at = now()
      WHERE id = ${tenantId}
    `

    // Index all created folders in drive_files
    const folderEntries: Array<{ gid: string; name: string; parentGid: string | null; artifactType: string; productTier: string | null }> = [
      { gid: structure.rootFolderId, name: tenantName, parentGid: customersFolderId ?? null, artifactType: 'opp_folder', productTier: null },
      { gid: structure.finderFolderId, name: 'Finder', parentGid: structure.rootFolderId, artifactType: 'opp_folder', productTier: 'finder' },
      { gid: structure.finderCuratedFolderId, name: 'Curated', parentGid: structure.finderFolderId, artifactType: 'opp_folder', productTier: 'finder' },
      { gid: structure.finderSavedFolderId, name: 'Saved', parentGid: structure.finderFolderId, artifactType: 'opp_folder', productTier: 'finder' },
      { gid: structure.uploadsFolderId, name: 'Uploads', parentGid: structure.rootFolderId, artifactType: 'tenant_upload', productTier: null },
    ]

    if (structure.remindersFolderId) {
      folderEntries.push({ gid: structure.remindersFolderId, name: 'Reminders', parentGid: structure.rootFolderId, artifactType: 'opp_folder', productTier: 'reminder' })
    }
    if (structure.binderFolderId) {
      folderEntries.push({ gid: structure.binderFolderId, name: 'Binder', parentGid: structure.rootFolderId, artifactType: 'opp_folder', productTier: 'binder' })
    }
    if (structure.binderProjectsFolderId && structure.binderFolderId) {
      folderEntries.push({ gid: structure.binderProjectsFolderId, name: 'Active Projects', parentGid: structure.binderFolderId, artifactType: 'project_folder', productTier: 'binder' })
    }
    if (structure.binderProfileFolderId && structure.binderFolderId) {
      folderEntries.push({ gid: structure.binderProfileFolderId, name: 'Company Profile', parentGid: structure.binderFolderId, artifactType: 'opp_folder', productTier: 'binder' })
    }
    if (structure.binderTeamingFolderId && structure.binderFolderId) {
      folderEntries.push({ gid: structure.binderTeamingFolderId, name: 'Teaming', parentGid: structure.binderFolderId, artifactType: 'opp_folder', productTier: 'binder' })
    }
    if (structure.grinderFolderId) {
      folderEntries.push({ gid: structure.grinderFolderId, name: 'Grinder', parentGid: structure.rootFolderId, artifactType: 'opp_folder', productTier: 'grinder' })
    }
    if (structure.grinderProposalsFolderId && structure.grinderFolderId) {
      folderEntries.push({ gid: structure.grinderProposalsFolderId, name: 'Proposals', parentGid: structure.grinderFolderId, artifactType: 'proposal_draft', productTier: 'grinder' })
    }

    for (const entry of folderEntries) {
      try {
        await indexDriveFolder({
          gid: entry.gid,
          name: entry.name,
          tenantId: tenantId,
          parentGid: entry.parentGid,
          artifactType: entry.artifactType,
          artifactScope: 'tenant',
          productTier: entry.productTier,
        })
      } catch (indexErr) {
        console.error('[POST /api/portal/drive] Index error:', indexErr)
      }
    }

    // Create initial artifacts: pipeline_snapshot for Finder
    try {
      const snapshotGid = await createPipelineSnapshot(structure.finderFolderId, tenantName)
      await indexDriveFile({
        gid: snapshotGid,
        name: `${tenantName} - Pipeline Snapshot`,
        type: 'SPREADSHEET',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        tenantId: tenantId,
        parentGid: structure.finderFolderId,
        artifactType: 'pipeline_snapshot',
        artifactScope: 'tenant',
        productTier: 'finder',
      })
    } catch (artErr) {
      console.error('[POST /api/portal/drive] Pipeline snapshot creation error:', artErr)
    }

    // Create Reminder artifacts if applicable
    if (structure.remindersFolderId) {
      try {
        const trackerGid = await createDeadlineTracker(structure.remindersFolderId, tenantName)
        await indexDriveFile({
          gid: trackerGid,
          name: `${tenantName} - Deadline Tracker`,
          type: 'SPREADSHEET',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          tenantId: tenantId,
          parentGid: structure.remindersFolderId,
          artifactType: 'deadline_tracker',
          artifactScope: 'tenant',
          productTier: 'reminder',
        })

        const amendGid = await createAmendmentLog(structure.remindersFolderId, tenantName)
        await indexDriveFile({
          gid: amendGid,
          name: `${tenantName} - Amendment Log`,
          type: 'SPREADSHEET',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          tenantId: tenantId,
          parentGid: structure.remindersFolderId,
          artifactType: 'amendment_log',
          artifactScope: 'tenant',
          productTier: 'reminder',
        })
      } catch (artErr) {
        console.error('[POST /api/portal/drive] Reminder artifact creation error:', artErr)
      }
    }

    // Log the execution (non-critical — don't let logging failures mask success)
    try {
      await sql`
        INSERT INTO integration_executions (function_name, tenant_id, status, completed_at, success, parameters, result)
        VALUES (
          'drive.provisionTenant',
          ${tenantId},
          'COMPLETED',
          now(),
          true,
          ${sql.json({ tenantName, tier })}::jsonb,
          ${JSON.stringify(structure)}::jsonb
        )
      `
    } catch (logErr) {
      console.error('[POST /api/portal/drive] Failed to log execution:', logErr)
    }

    // Emit customer event
    try {
      await sql`
        INSERT INTO customer_events (tenant_id, user_id, event_type, description, metadata)
        VALUES (
          ${tenantId},
          ${session.user.id},
          'account.drive_provisioned',
          ${'Drive folder provisioned for tier: ' + tier},
          ${JSON.stringify({ tier, structure })}::jsonb
        )
      `
    } catch (eventErr) {
      console.error('[POST /api/portal/drive] Event emission error:', eventErr)
    }

    // Share with the requesting user if they have a Google email
    if (session.user.email) {
      try {
        await shareDriveFolder(structure.rootFolderId, session.user.email, 'writer')
      } catch (shareError) {
        console.error('[POST /api/portal/drive] Share error (non-fatal):', shareError)
      }
    }

    return NextResponse.json({
      data: { driveFolderId: structure.rootFolderId, structure },
    }, { status: 201 })
  } catch (error) {
    // Log failed execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, tenant_id, status, completed_at, success, error_message)
        VALUES (
          'drive.provisionTenant',
          ${tenantId},
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
