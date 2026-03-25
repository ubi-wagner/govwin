import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import { PAGE_DEFAULTS } from '@/lib/content-defaults'
import { emitContentEvent, userActor, diffSections } from '@/lib/events'

/** Map page_key to the public URL path so we can revalidate the route cache */
function pageKeyToPath(pageKey: string): string {
  if (pageKey === 'home') return '/'
  return '/' + pageKey.replace('_', '-')
}

/**
 * GET /api/content — List all site content pages
 * Master admin: returns all pages with draft + published state
 * Public (no auth): returns only published content for a specific page via ?page=key
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pageKey = searchParams.get('page')

  // Public access: return published content for a specific page
  if (pageKey) {
    try {
      const rows = await sql`
        SELECT page_key, published_content, published_metadata
        FROM site_content
        WHERE page_key = ${pageKey} AND published_content IS NOT NULL
      `
      if (rows.length === 0) {
        return NextResponse.json({ data: null })
      }
      return NextResponse.json({
        data: {
          pageKey: rows[0].pageKey,
          content: rows[0].publishedContent,
          metadata: rows[0].publishedMetadata,
        }
      })
    } catch (error) {
      console.error('[GET /api/content] Public fetch error:', error)
      return NextResponse.json({ data: null })
    }
  }

  // Admin access: return all pages
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const rows = await sql`
      SELECT
        id, page_key, display_name,
        draft_content, draft_metadata, draft_updated_at, draft_updated_by,
        published_content, published_metadata, published_at, published_by,
        previous_content IS NOT NULL AS has_previous,
        previous_published_at,
        auto_publish, content_source,
        created_at, updated_at
      FROM site_content
      ORDER BY display_name
    `

    // Auto-seed draft_content from PAGE_DEFAULTS when:
    //   - draft_content is empty ({}) or null (never edited), OR
    //   - draft_content is missing expected top-level keys (stale format from old migration)
    // This ensures the CMS editor always shows current-format content.
    for (const row of rows) {
      const key = row.pageKey as string
      const defaults = PAGE_DEFAULTS[key]
      if (!defaults) continue

      const draft = row.draftContent as Record<string, unknown> | null
      const isEmpty = !draft || Object.keys(draft).length === 0
      const expectedKeys = Object.keys(defaults.content)
      const isStale = !isEmpty && expectedKeys.some(k => !(draft as Record<string, unknown>)[k])

      if (!isEmpty && !isStale) continue

      try {
        // Merge: keep any existing fields from draft, fill in missing ones from defaults
        const merged = { ...defaults.content, ...(draft ?? {}) }
        // For each section, deep-merge default fields into existing section objects
        for (const sectionKey of expectedKeys) {
          const defaultSection = defaults.content[sectionKey as keyof typeof defaults.content]
          const draftSection = merged[sectionKey]
          if (
            defaultSection && draftSection &&
            typeof defaultSection === 'object' && typeof draftSection === 'object' &&
            !Array.isArray(defaultSection) && !Array.isArray(draftSection)
          ) {
            merged[sectionKey] = { ...defaultSection, ...(draftSection as Record<string, unknown>) }
          } else if (draftSection === undefined) {
            merged[sectionKey] = defaultSection
          }
        }

        await sql`
          UPDATE site_content
          SET
            draft_content = ${JSON.stringify(merged)}::jsonb,
            draft_metadata = CASE
              WHEN draft_metadata IS NULL OR draft_metadata = '{}'::jsonb
              THEN ${JSON.stringify(defaults.metadata)}::jsonb
              ELSE draft_metadata
            END,
            draft_updated_at = NOW(),
            updated_at = NOW()
          WHERE page_key = ${key}
        `
        // Patch in-memory row so we return seeded content immediately
        row.draftContent = merged
        if (!row.draftMetadata || Object.keys(row.draftMetadata as Record<string, unknown>).length === 0) {
          row.draftMetadata = defaults.metadata
        }
      } catch (seedErr) {
        console.error(`[GET /api/content] Failed to seed defaults for ${key}:`, seedErr)
      }
    }

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[GET /api/content] Admin list error:', error)
    return NextResponse.json({ error: 'Failed to load content' }, { status: 500 })
  }
}

/**
 * PATCH /api/content — Save draft content for a page
 * Body: { pageKey, content, metadata }
 */
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { pageKey?: string; content?: Record<string, unknown>; metadata?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { pageKey, content, metadata } = body
  if (!pageKey) {
    return NextResponse.json({ error: 'pageKey is required' }, { status: 400 })
  }

  try {
    const rows = await sql`
      UPDATE site_content
      SET
        draft_content = COALESCE(${content ? JSON.stringify(content) : null}::jsonb, draft_content),
        draft_metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, draft_metadata),
        draft_updated_at = NOW(),
        draft_updated_by = ${session.user.id},
        updated_at = NOW()
      WHERE page_key = ${pageKey}
      RETURNING id, page_key, draft_content, draft_metadata, draft_updated_at
    `

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    // Log event with actual diff
    const prevDraft = rows[0].draftContent as Record<string, unknown> | null
    const changedSections = content ? diffSections(prevDraft, content) : []
    const diffDesc = changedSections.length > 0
      ? `Draft saved: updated ${changedSections.join(', ')}`
      : 'Draft saved (no content changes)'

    await emitContentEvent({
      pageKey,
      eventType: 'content.draft_saved',
      userId: session.user.id,
      source: 'admin',
      contentSnapshot: content ?? null,
      metadataSnapshot: metadata ?? null,
      diffSummary: diffDesc,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: {
        changedSections,
        displayName: rows[0].pageKey,
      },
    })

    return NextResponse.json({ data: rows[0] })
  } catch (error) {
    console.error('[PATCH /api/content] Error:', error)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }
}

/**
 * POST /api/content — Publish, rollback, or configure auto-publish
 * Body: { pageKey, action: 'publish' | 'rollback' | 'unpublish' | 'configure', autoPublish?: boolean, contentSource?: string }
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { pageKey?: string; action?: string; autoPublish?: boolean; contentSource?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { pageKey, action } = body
  if (!pageKey || !action) {
    return NextResponse.json({ error: 'pageKey and action are required' }, { status: 400 })
  }

  try {
    if (action === 'publish') {
      // Move current published → previous, draft → published
      const rows = await sql`
        UPDATE site_content
        SET
          previous_content = published_content,
          previous_metadata = published_metadata,
          previous_published_at = published_at,
          published_content = draft_content,
          published_metadata = draft_metadata,
          published_at = NOW(),
          published_by = ${session.user.id},
          updated_at = NOW()
        WHERE page_key = ${pageKey}
        RETURNING id, page_key, published_content, published_metadata, published_at
      `

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 })
      }

      const pubContent = rows[0].publishedContent as Record<string, unknown>
      const pubSections = Object.keys(pubContent ?? {})
      await emitContentEvent({
        pageKey,
        eventType: 'content.published',
        userId: session.user.id,
        source: 'admin',
        contentSnapshot: pubContent,
        metadataSnapshot: rows[0].publishedMetadata as Record<string, unknown> | null,
        diffSummary: `Published ${pubSections.length} sections: ${pubSections.join(', ')}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: {
          sectionsPublished: pubSections,
          publishedAt: rows[0].publishedAt,
          path: pageKeyToPath(pageKey),
        },
      })

      // Bust the Next.js route cache so the public page shows updated content
      revalidatePath(pageKeyToPath(pageKey))

      return NextResponse.json({ data: rows[0], message: 'Content published' })

    } else if (action === 'rollback') {
      // Restore previous → published, clear previous
      const rows = await sql`
        UPDATE site_content
        SET
          published_content = previous_content,
          published_metadata = previous_metadata,
          published_at = NOW(),
          published_by = ${session.user.id},
          previous_content = NULL,
          previous_metadata = NULL,
          previous_published_at = NULL,
          updated_at = NOW()
        WHERE page_key = ${pageKey} AND previous_content IS NOT NULL
        RETURNING id, page_key, published_content, published_metadata
      `

      if (rows.length === 0) {
        return NextResponse.json({ error: 'No previous version to roll back to' }, { status: 404 })
      }

      await emitContentEvent({
        pageKey,
        eventType: 'content.rolled_back',
        userId: session.user.id,
        source: 'admin',
        contentSnapshot: rows[0].publishedContent as Record<string, unknown> | null,
        metadataSnapshot: rows[0].publishedMetadata as Record<string, unknown> | null,
        diffSummary: 'Rolled back to previous version',
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: {
          restoredSections: Object.keys((rows[0].publishedContent as Record<string, unknown>) ?? {}),
          path: pageKeyToPath(pageKey),
        },
      })

      revalidatePath(pageKeyToPath(pageKey))

      return NextResponse.json({ data: rows[0], message: 'Rolled back to previous version' })

    } else if (action === 'unpublish') {
      // Fetch current published content BEFORE clearing it (for the event snapshot)
      const [current] = await sql`
        SELECT published_content, published_metadata, published_at
        FROM site_content
        WHERE page_key = ${pageKey} AND published_content IS NOT NULL
      `
      if (!current) {
        return NextResponse.json({ error: 'Page is not published' }, { status: 404 })
      }

      const rows = await sql`
        UPDATE site_content
        SET
          previous_content = published_content,
          previous_metadata = published_metadata,
          previous_published_at = published_at,
          published_content = NULL,
          published_metadata = NULL,
          published_at = NULL,
          published_by = NULL,
          updated_at = NOW()
        WHERE page_key = ${pageKey} AND published_content IS NOT NULL
        RETURNING id, page_key
      `

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Page is not published' }, { status: 404 })
      }

      const unpubContent = current.publishedContent as Record<string, unknown> | null
      await emitContentEvent({
        pageKey,
        eventType: 'content.unpublished',
        userId: session.user.id,
        source: 'admin',
        contentSnapshot: unpubContent,
        metadataSnapshot: current.publishedMetadata as Record<string, unknown> | null,
        diffSummary: `Unpublished ${Object.keys(unpubContent ?? {}).length} sections — site reverted to static content`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: {
          unpublishedSections: Object.keys(unpubContent ?? {}),
          previouslyPublishedAt: current.publishedAt,
          path: pageKeyToPath(pageKey),
        },
      })

      revalidatePath(pageKeyToPath(pageKey))

      return NextResponse.json({ data: rows[0], message: 'Content unpublished' })

    } else if (action === 'configure') {
      const rows = await sql`
        UPDATE site_content
        SET
          auto_publish = COALESCE(${body.autoPublish ?? null}, auto_publish),
          content_source = COALESCE(${body.contentSource ?? null}, content_source),
          updated_at = NOW()
        WHERE page_key = ${pageKey}
        RETURNING id, page_key, auto_publish, content_source
      `

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 })
      }

      const changes: string[] = []
      if (body.autoPublish !== undefined) changes.push(`auto_publish=${body.autoPublish}`)
      if (body.contentSource !== undefined) changes.push(`content_source=${body.contentSource}`)

      await emitContentEvent({
        pageKey,
        eventType: 'content.configured',
        userId: session.user.id,
        source: 'admin',
        diffSummary: `Configuration updated: ${changes.join(', ')}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: {
          autoPublish: body.autoPublish,
          contentSource: body.contentSource,
          changes,
        },
      })

      return NextResponse.json({ data: rows[0], message: 'Configuration updated' })

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error(`[POST /api/content] ${action} error:`, error)
    return NextResponse.json({ error: `Failed to ${action} content` }, { status: 500 })
  }
}
