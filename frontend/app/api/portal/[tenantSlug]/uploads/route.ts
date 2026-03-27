/**
 * GET  /api/portal/[tenantSlug]/uploads — List tenant uploads (optional ?spotlightId= filter)
 * POST /api/portal/[tenantSlug]/uploads — Upload a file to tenant storage (multipart form-data)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { storeFile, ensureDir } from '@/lib/storage'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt',
  'txt', 'csv', 'jpg', 'jpeg', 'png',
])

async function resolveTenant(session: any, slug: string, routeTag: string) {
  let tenant: any
  try {
    tenant = await getTenantBySlug(slug)
  } catch (error) {
    console.error(`[${routeTag}] Tenant resolution error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error(`[${routeTag}] Access check error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!hasAccess) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { tenant }
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'GET /api/portal/uploads')
  if (result.error) return result.error
  const tenant = result.tenant

  const spotlightId = request.nextUrl.searchParams.get('spotlightId')
  const category = request.nextUrl.searchParams.get('category')

  try {
    let uploads
    if (spotlightId) {
      uploads = await sql`
        SELECT tu.id, tu.filename, tu.original_filename, tu.file_size_bytes,
               tu.mime_type, tu.upload_type, tu.upload_category, tu.description,
               tu.spotlight_id, tu.library_status, tu.atom_count,
               tu.is_active, tu.created_at,
               u.name AS uploaded_by_name
        FROM tenant_uploads tu
        LEFT JOIN users u ON tu.uploaded_by = u.id
        WHERE tu.tenant_id = ${tenant.id}
          AND tu.is_active = TRUE
          AND tu.spotlight_id = ${spotlightId}
        ORDER BY tu.created_at DESC
      `
    } else if (category) {
      uploads = await sql`
        SELECT tu.id, tu.filename, tu.original_filename, tu.file_size_bytes,
               tu.mime_type, tu.upload_type, tu.upload_category, tu.description,
               tu.spotlight_id, tu.library_status, tu.atom_count,
               tu.is_active, tu.created_at,
               u.name AS uploaded_by_name,
               fa.name AS spotlight_name
        FROM tenant_uploads tu
        LEFT JOIN users u ON tu.uploaded_by = u.id
        LEFT JOIN focus_areas fa ON tu.spotlight_id = fa.id
        WHERE tu.tenant_id = ${tenant.id}
          AND tu.is_active = TRUE
          AND tu.upload_category = ${category}
        ORDER BY tu.created_at DESC
      `
    } else {
      uploads = await sql`
        SELECT tu.id, tu.filename, tu.original_filename, tu.file_size_bytes,
               tu.mime_type, tu.upload_type, tu.upload_category, tu.description,
               tu.spotlight_id, tu.library_status, tu.atom_count,
               tu.is_active, tu.created_at,
               u.name AS uploaded_by_name,
               fa.name AS spotlight_name
        FROM tenant_uploads tu
        LEFT JOIN users u ON tu.uploaded_by = u.id
        LEFT JOIN focus_areas fa ON tu.spotlight_id = fa.id
        WHERE tu.tenant_id = ${tenant.id}
          AND tu.is_active = TRUE
        ORDER BY tu.created_at DESC
      `
    }

    return NextResponse.json({ data: uploads })
  } catch (error) {
    console.error('[GET /api/portal/uploads] Error:', error)
    return NextResponse.json({ error: 'Failed to load uploads' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'POST /api/portal/uploads')
  if (result.error) return result.error
  const tenant = result.tenant

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 })
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
    }, { status: 413 })
  }

  // Validate extension
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({
      error: `File type .${ext} is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
    }, { status: 400 })
  }

  const spotlightId = formData.get('spotlightId') as string | null
  const uploadCategory = formData.get('category') as string | null
  const description = formData.get('description') as string | null

  // Validate spotlight belongs to tenant if provided
  if (spotlightId) {
    try {
      const [spotlight] = await sql`
        SELECT id FROM focus_areas WHERE id = ${spotlightId} AND tenant_id = ${tenant.id}
      `
      if (!spotlight) {
        return NextResponse.json({ error: 'SpotLight not found' }, { status: 404 })
      }
    } catch (error) {
      console.error('[POST /api/portal/uploads] Spotlight check error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
  }

  // Store file to filesystem
  const timestamp = Date.now()
  const safeFilename = file.name.replace(/[/\\:*?"<>|]/g, '-').trim()
  const storageName = `${timestamp}-${safeFilename}`
  const relativePath = `customers/${tenantSlug}/uploads/${storageName}`

  try {
    await ensureDir(`customers/${tenantSlug}/uploads`)
    const buffer = Buffer.from(await file.arrayBuffer())
    const stored = await storeFile(relativePath, buffer)

    // Insert DB record
    const [upload] = await sql`
      INSERT INTO tenant_uploads (
        tenant_id, uploaded_by, filename, original_filename,
        file_path, file_size_bytes, mime_type, upload_type,
        upload_category, description, spotlight_id, is_active
      ) VALUES (
        ${tenant.id}, ${session.user.id}, ${storageName}, ${file.name},
        ${stored.path}, ${stored.size}, ${file.type || null},
        ${mapExtToUploadType(ext)},
        ${uploadCategory ?? 'general'}, ${description ?? null},
        ${spotlightId ?? null}, TRUE
      )
      RETURNING id, filename, original_filename, file_size_bytes, mime_type,
                upload_type, upload_category, description, spotlight_id,
                library_status, is_active, created_at
    `

    // Emit event (non-critical)
    try {
      await emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'library.upload_ingested' as any,
        userId: session.user.id,
        entityType: 'upload',
        entityId: upload.id,
        description: `File uploaded: ${file.name} (${uploadCategory ?? 'general'})`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        refs: { tenant_id: tenant.id, spotlight_id: spotlightId },
        payload: {
          filename: file.name,
          size: stored.size,
          category: uploadCategory ?? 'general',
          spotlight_id: spotlightId,
        },
      })
    } catch (e) {
      console.error('[POST /api/portal/uploads] Event emit error (non-critical):', e)
    }

    return NextResponse.json({ data: upload }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/portal/uploads] Error:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}

function mapExtToUploadType(ext: string): string {
  switch (ext) {
    case 'pdf':
    case 'doc':
    case 'docx':
      return 'capability_doc'
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'cut_sheet'
    default:
      return 'general'
  }
}
