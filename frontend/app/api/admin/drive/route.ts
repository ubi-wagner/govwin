/**
 * POST /api/admin/drive — Provision the global storage structure (local filesystem)
 * GET  /api/admin/drive — Get current storage config from system_config
 *
 * Admin-only. Creates on Railway volume:
 *   /data/
 *     /opportunities/
 *     /customers/
 *     /system/
 *       /templates/
 *       /logs/
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import { provisionGlobalStorage } from '@/lib/storage'
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
      WHERE key LIKE 'storage.%' OR key LIKE 'drive.%'
    `

    const storageConfig: Record<string, string | null> = {}
    for (const row of configs) {
      const val = row.value
      storageConfig[row.key as string] = val === 'null' || val === '"null"' ? null : String(val).replace(/^"|"$/g, '')
    }

    return NextResponse.json({ data: storageConfig })
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
      SELECT value FROM system_config WHERE key = 'storage.provisioned'
    `
    const val = existing?.value
    if (val === true || val === 'true') {
      return NextResponse.json({
        error: 'Global storage structure already provisioned',
      }, { status: 409 })
    }
  } catch (error) {
    console.error('[POST /api/admin/drive] Config check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  try {
    const structure = await provisionGlobalStorage()

    // Save paths to system_config
    const updates: Array<[string, string]> = [
      ['storage.root_path', structure.rootPath || '/'],
      ['storage.opportunities_path', structure.opportunitiesPath],
      ['storage.customers_path', structure.customersPath],
      ['storage.templates_path', structure.templatesPath],
      ['storage.provisioned', 'true'],
    ]

    for (const [key, value] of updates) {
      await sql`
        UPDATE system_config SET value = ${JSON.stringify(value)}::jsonb, updated_at = now()
        WHERE key = ${key}
      `
    }

    // Index root folders in stored_files
    const globalFolders = [
      { name: 'opportunities', path: structure.opportunitiesPath, artifactType: 'opp_folder' },
      { name: 'customers', path: structure.customersPath, artifactType: 'opp_folder' },
      { name: 'system', path: structure.systemPath, artifactType: 'template' },
      { name: 'templates', path: structure.templatesPath, artifactType: 'template' },
    ]

    for (const folder of globalFolders) {
      try {
        await sql`
          INSERT INTO stored_files (name, type, storage_path, auto_created, artifact_scope, artifact_type, storage_backend)
          VALUES (
            ${folder.name}, 'FOLDER', ${folder.path},
            true, 'global', ${folder.artifactType}, 'local'
          )
          ON CONFLICT DO NOTHING
        `
      } catch (indexErr) {
        console.error('[POST /api/admin/drive] Index error:', indexErr)
      }
    }

    // Log execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, status, completed_at, success, result)
        VALUES (
          'storage.provisionGlobal',
          'COMPLETED',
          now(),
          true,
          ${JSON.stringify(structure)}::jsonb
        )
      `
    } catch (logErr) {
      console.error('[POST /api/admin/drive] Failed to log execution:', logErr)
    }

    return NextResponse.json({
      data: structure,
    }, { status: 201 })
  } catch (error) {
    // Log failed execution
    try {
      await sql`
        INSERT INTO integration_executions (function_name, status, completed_at, success, error_message)
        VALUES ('storage.provisionGlobal', 'FAILED', now(), false, ${error instanceof Error ? error.message : 'Unknown error'})
      `
    } catch (logError) {
      console.error('[POST /api/admin/drive] Failed to log execution:', logError)
    }

    console.error('[POST /api/admin/drive] Global provisioning error:', error)
    return NextResponse.json({ error: 'Failed to provision global storage structure' }, { status: 500 })
  }
}
