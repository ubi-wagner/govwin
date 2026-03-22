/**
 * GET  /api/portal/[tenantSlug]/drive — List files for tenant from local storage
 * POST /api/portal/[tenantSlug]/drive — Provision tenant storage folder (tier-aware)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { provisionTenantStorage, listDirectory, fileType } from '@/lib/storage'
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

// ── GET: List files from tenant's local storage folder ──────────
export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { tenant } = ctx

  const storagePath = (tenant.storageRootPath as string | null) ?? null
  if (!storagePath) {
    return NextResponse.json({ data: [], storagePath: null })
  }

  // Allow browsing subfolders via ?folder= param
  const folder = request.nextUrl.searchParams.get('folder') ?? storagePath

  // Ensure the requested folder is within the tenant's root (security)
  if (!folder.startsWith(storagePath)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const entries = await listDirectory(folder)

    return NextResponse.json({
      data: entries.map((e) => ({
        name: e.name,
        path: e.path,
        type: e.isDirectory ? 'FOLDER' : fileType(e.name),
        isDirectory: e.isDirectory,
        size: e.size,
        modifiedAt: e.modifiedAt,
      })),
      storagePath,
      currentFolder: folder,
    })
  } catch (error) {
    console.error('[GET /api/portal/drive] Storage error:', error)
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 })
  }
}

// ── Helper: index a stored folder in the DB ─────────────────────
async function indexStoredFolder(opts: {
  name: string
  storagePath: string
  tenantId: string | null
  parentPath: string | null
  artifactType: string
  artifactScope: string
  productTier: string | null
}) {
  await sql`
    INSERT INTO stored_files (
      name, type, storage_path, tenant_id, parent_gid,
      auto_created, artifact_type, artifact_scope, product_tier, storage_backend
    ) VALUES (
      ${opts.name},
      'FOLDER',
      ${opts.storagePath},
      ${opts.tenantId},
      ${opts.parentPath},
      true,
      ${opts.artifactType},
      ${opts.artifactScope},
      ${opts.productTier},
      'local'
    )
    ON CONFLICT DO NOTHING
  `
}

// ── POST: Provision tenant storage folder (tier-aware) ──────────
export async function POST(_request: NextRequest, { params }: Params) {
  const ctx = await resolveContext(params)
  if ('error' in ctx) return ctx.error
  const { session, tenant } = ctx

  // Only admins can provision
  if (session.user.role !== 'master_admin' && session.user.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const existingPath = (tenant.storageRootPath as string | null) ?? null
  if (existingPath) {
    return NextResponse.json({ error: 'Storage already provisioned', storagePath: existingPath }, { status: 409 })
  }

  const tenantId = tenant.id as string
  const tenantSlug = tenant.slug as string
  const tier = (tenant.productTier as ProductTier | null) ?? 'finder'

  try {
    const structure = await provisionTenantStorage(tenantSlug, tier)

    // Save paths to tenant record
    await sql`
      UPDATE tenants SET
        storage_root_path = ${structure.rootPath},
        storage_finder_path = ${structure.finderPath},
        storage_reminders_path = ${structure.remindersPath},
        storage_binder_path = ${structure.binderPath},
        storage_grinder_path = ${structure.grinderPath},
        storage_uploads_path = ${structure.uploadsPath},
        updated_at = now()
      WHERE id = ${tenantId}
    `

    // Index all created folders in stored_files
    const folderEntries: Array<{ name: string; path: string; parentPath: string | null; artifactType: string; productTier: string | null }> = [
      { name: tenantSlug, path: structure.rootPath, parentPath: 'customers', artifactType: 'opp_folder', productTier: null },
      { name: 'finder', path: structure.finderPath, parentPath: structure.rootPath, artifactType: 'opp_folder', productTier: 'finder' },
      { name: 'curated', path: structure.finderCuratedPath, parentPath: structure.finderPath, artifactType: 'curated_summary', productTier: 'finder' },
      { name: 'saved', path: structure.finderSavedPath, parentPath: structure.finderPath, artifactType: 'saved_shortcut', productTier: 'finder' },
      { name: 'uploads', path: structure.uploadsPath, parentPath: structure.rootPath, artifactType: 'tenant_upload', productTier: null },
    ]

    if (structure.remindersPath) {
      folderEntries.push({ name: 'reminders', path: structure.remindersPath, parentPath: structure.rootPath, artifactType: 'deadline_tracker', productTier: 'reminder' })
    }
    if (structure.binderPath) {
      folderEntries.push({ name: 'binder', path: structure.binderPath, parentPath: structure.rootPath, artifactType: 'project_folder', productTier: 'binder' })
    }
    if (structure.binderProjectsPath) {
      folderEntries.push({ name: 'active-projects', path: structure.binderProjectsPath, parentPath: structure.binderPath!, artifactType: 'project_folder', productTier: 'binder' })
    }
    if (structure.binderProfilePath) {
      folderEntries.push({ name: 'company-profile', path: structure.binderProfilePath, parentPath: structure.binderPath!, artifactType: 'opp_folder', productTier: 'binder' })
    }
    if (structure.binderTeamingPath) {
      folderEntries.push({ name: 'teaming', path: structure.binderTeamingPath, parentPath: structure.binderPath!, artifactType: 'opp_folder', productTier: 'binder' })
    }
    if (structure.grinderPath) {
      folderEntries.push({ name: 'grinder', path: structure.grinderPath, parentPath: structure.rootPath, artifactType: 'proposal_draft', productTier: 'grinder' })
    }
    if (structure.grinderProposalsPath) {
      folderEntries.push({ name: 'proposals', path: structure.grinderProposalsPath, parentPath: structure.grinderPath!, artifactType: 'proposal_draft', productTier: 'grinder' })
    }

    for (const entry of folderEntries) {
      try {
        await indexStoredFolder({
          name: entry.name,
          storagePath: entry.path,
          tenantId: tenantId,
          parentPath: entry.parentPath,
          artifactType: entry.artifactType,
          artifactScope: 'tenant',
          productTier: entry.productTier,
        })
      } catch (indexErr) {
        console.error('[POST /api/portal/drive] Index error:', indexErr)
      }
    }

    // Log execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, tenant_id, status, completed_at, success, parameters, result)
        VALUES (
          'storage.provisionTenant',
          ${tenantId},
          'COMPLETED',
          now(),
          true,
          ${sql.json({ tenantSlug, tier })}::jsonb,
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
          ${'Storage provisioned for tier: ' + tier},
          ${JSON.stringify({ tier, structure })}::jsonb
        )
      `
    } catch (eventErr) {
      console.error('[POST /api/portal/drive] Event emission error:', eventErr)
    }

    return NextResponse.json({
      data: { storagePath: structure.rootPath, structure },
    }, { status: 201 })
  } catch (error) {
    // Log failed execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, tenant_id, status, completed_at, success, error_message)
        VALUES (
          'storage.provisionTenant',
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
    return NextResponse.json({ error: 'Failed to provision storage' }, { status: 500 })
  }
}
