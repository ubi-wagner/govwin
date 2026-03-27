/**
 * DELETE /api/portal/[tenantSlug]/uploads/[uploadId] — Soft-delete an upload
 * PATCH  /api/portal/[tenantSlug]/uploads/[uploadId] — Update upload metadata
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; uploadId: string }> }

async function resolveContext(session: any, slug: string, uploadId: string, routeTag: string) {
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

  let upload: any
  try {
    const [row] = await sql`
      SELECT * FROM tenant_uploads WHERE id = ${uploadId} AND tenant_id = ${tenant.id}
    `
    upload = row
  } catch (error) {
    console.error(`[${routeTag}] Upload fetch error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!upload) return { error: NextResponse.json({ error: 'Upload not found' }, { status: 404 }) }

  return { tenant, upload }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, uploadId } = await params
  const result = await resolveContext(session, tenantSlug, uploadId, 'PATCH /api/portal/uploads/[id]')
  if (result.error) return result.error
  const { tenant } = result

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { description, uploadCategory, spotlightId } = body

  try {
    const [updated] = await sql`
      UPDATE tenant_uploads SET
        description = COALESCE(${description ?? null}, description),
        upload_category = COALESCE(${uploadCategory ?? null}, upload_category),
        spotlight_id = COALESCE(${spotlightId ?? null}, spotlight_id)
      WHERE id = ${uploadId} AND tenant_id = ${tenant.id}
      RETURNING id, filename, original_filename, file_size_bytes, mime_type,
                upload_type, upload_category, description, spotlight_id,
                library_status, is_active, created_at
    `

    // Emit event for downstream automation
    const changedFields = [
      description !== undefined && 'description',
      uploadCategory !== undefined && 'category',
      spotlightId !== undefined && 'spotlight',
    ].filter(Boolean)

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'library.upload_ingested',
      userId: session.user.id,
      entityType: 'upload',
      entityId: uploadId,
      description: `Upload "${updated.originalFilename ?? updated.filename}" metadata updated: ${changedFields.join(', ')}`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: { uploadId, changedFields, description, uploadCategory, spotlightId },
    }).catch(e => console.error('[PATCH /api/portal/uploads/[id]] Event error (non-critical):', e))

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[PATCH /api/portal/uploads/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to update upload' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, uploadId } = await params
  const result = await resolveContext(session, tenantSlug, uploadId, 'DELETE /api/portal/uploads/[id]')
  if (result.error) return result.error
  const { tenant } = result

  try {
    await sql`
      UPDATE tenant_uploads SET is_active = FALSE
      WHERE id = ${uploadId} AND tenant_id = ${tenant.id}
    `

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'library.upload_ingested',
      userId: session.user.id,
      entityType: 'upload',
      entityId: uploadId,
      description: `Upload "${result.upload?.originalFilename ?? uploadId}" deleted`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: { uploadId, action: 'deleted' },
    }).catch(e => console.error('[DELETE /api/portal/uploads/[id]] Event error (non-critical):', e))

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[DELETE /api/portal/uploads/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to delete upload' }, { status: 500 })
  }
}
