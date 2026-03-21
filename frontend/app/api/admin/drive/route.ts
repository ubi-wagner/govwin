/**
 * POST /api/admin/drive — Provision the global RFPPIPELINE Drive structure
 * GET  /api/admin/drive — Get current global Drive folder IDs from system_config
 *
 * Admin-only. Creates:
 *   /RFPPIPELINE/
 *     /Opportunities/
 *     /Customers/
 *     /System/
 *       /templates/
 *       /logs/
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import { provisionGlobalDrive, getOrCreateMasterIndex } from '@/lib/google-drive'
import type { AppSession } from '@/types'

export async function GET(_request: NextRequest) {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const configs = await sql`
      SELECT key, value FROM system_config
      WHERE key LIKE 'drive.%'
    `

    const driveConfig: Record<string, string | null> = {}
    for (const row of configs) {
      const val = row.value
      driveConfig[row.key as string] = val === 'null' || val === '"null"' ? null : String(val).replace(/^"|"$/g, '')
    }

    return NextResponse.json({ data: driveConfig })
  } catch (error) {
    console.error('[GET /api/admin/drive] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(_request: NextRequest) {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Check if already provisioned
  try {
    const [existing] = await sql`
      SELECT value FROM system_config WHERE key = 'drive.root_folder_id'
    `
    const val = existing?.value
    if (val && val !== 'null' && val !== '"null"') {
      return NextResponse.json({
        error: 'Global Drive structure already provisioned',
        rootFolderId: String(val).replace(/^"|"$/g, ''),
      }, { status: 409 })
    }
  } catch (error) {
    console.error('[POST /api/admin/drive] Config check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  try {
    const structure = await provisionGlobalDrive()

    // Create the master_index.gsheet in /Opportunities/
    const masterIndexGid = await getOrCreateMasterIndex(structure.opportunitiesFolderId)

    // Save all folder IDs to system_config
    const updates: Array<[string, string]> = [
      ['drive.root_folder_id', structure.rootFolderId],
      ['drive.opportunities_folder_id', structure.opportunitiesFolderId],
      ['drive.customers_folder_id', structure.customersFolderId],
      ['drive.templates_folder_id', structure.templatesFolderId],
    ]

    for (const [key, value] of updates) {
      await sql`
        UPDATE system_config SET value = ${JSON.stringify(value)}::jsonb, updated_at = now()
        WHERE key = ${key}
      `
    }

    // Index folders in drive_files (global scope, no tenant)
    const globalFolders = [
      { gid: structure.rootFolderId, name: 'RFPPIPELINE', parentGid: null },
      { gid: structure.opportunitiesFolderId, name: 'Opportunities', parentGid: structure.rootFolderId },
      { gid: structure.customersFolderId, name: 'Customers', parentGid: structure.rootFolderId },
      { gid: structure.systemFolderId, name: 'System', parentGid: structure.rootFolderId },
      { gid: structure.templatesFolderId, name: 'templates', parentGid: structure.systemFolderId },
    ]

    for (const folder of globalFolders) {
      try {
        await sql`
          INSERT INTO drive_files (gid, name, type, mime_type, parent_gid, auto_created, artifact_scope, artifact_type)
          VALUES (
            ${folder.gid}, ${folder.name}, 'FOLDER', 'application/vnd.google-apps.folder',
            ${folder.parentGid}, true, 'global', 'opp_folder'
          )
          ON CONFLICT (gid) DO NOTHING
        `
      } catch (indexErr) {
        console.error('[POST /api/admin/drive] Index error:', indexErr)
      }
    }

    // Index master_index
    try {
      await sql`
        INSERT INTO drive_files (gid, name, type, mime_type, parent_gid, auto_created, artifact_scope, artifact_type)
        VALUES (
          ${masterIndexGid}, 'master_index', 'SPREADSHEET', 'application/vnd.google-apps.spreadsheet',
          ${structure.opportunitiesFolderId}, true, 'global', 'master_index'
        )
        ON CONFLICT (gid) DO NOTHING
      `
    } catch (indexErr) {
      console.error('[POST /api/admin/drive] Master index error:', indexErr)
    }

    // Log execution
    await sql`
      INSERT INTO integration_executions (function_name, status, completed_at, success, result)
      VALUES (
        'drive.provisionGlobal',
        'COMPLETED',
        now(),
        true,
        ${JSON.stringify({ ...structure, masterIndexGid })}::jsonb
      )
    `

    return NextResponse.json({
      data: { ...structure, masterIndexGid },
    }, { status: 201 })
  } catch (error) {
    // Log failed execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, status, completed_at, success, error_message)
        VALUES ('drive.provisionGlobal', 'FAILED', now(), false, ${error instanceof Error ? error.message : 'Unknown error'})
      `
    } catch (logError) {
      console.error('[POST /api/admin/drive] Failed to log execution:', logError)
    }

    console.error('[POST /api/admin/drive] Global provisioning error:', error)
    return NextResponse.json({ error: 'Failed to provision global Drive structure' }, { status: 500 })
  }
}
