import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import { emitContentEvent, userActor } from '@/lib/events'
import type { ContentEventType } from '@/types'
// ── Helpers ─────────────────────────────────────────────────────

/** Generate a URL-safe slug from a title, with random suffix for uniqueness */
function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base}-${suffix}`
}

/** Emit a content pipeline event (non-blocking, logs on failure) */
async function emitPipelineEvent(
  eventType: ContentEventType,
  userId: string,
  email: string | undefined,
  diffSummary: string,
  payload?: Record<string, unknown>,
) {
  await emitContentEvent({
    pageKey: 'content_pipeline',
    eventType,
    userId,
    source: 'admin',
    diffSummary,
    actor: userActor(userId, email),
    payload,
  })
}

/** Create a content_reviews record — accepts transaction or top-level sql */
async function createReviewRecord(
  // postgres.js TransactionSql type omits call signatures; use any for tx parameter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  querySql: any,
  params: {
    postId: string
    action: string
    reviewerId: string
    notes?: string | null
    titleSnapshot?: string | null
    bodySnapshot?: string | null
    version: number
  },
) {
  await querySql`
    INSERT INTO content_reviews (post_id, action, reviewer_id, notes, title_snapshot, body_snapshot, version_at_review)
    VALUES (
      ${params.postId},
      ${params.action},
      ${params.reviewerId},
      ${params.notes ?? null},
      ${params.titleSnapshot ?? null},
      ${params.bodySnapshot ?? null},
      ${params.version}
    )
  `
}

// Valid status transitions for workflow actions
const VALID_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  submit_review: { from: ['draft'], to: 'in_review' },
  approve: { from: ['in_review'], to: 'approved' },
  reject: { from: ['in_review'], to: 'rejected' },
  publish: { from: ['approved'], to: 'published' },
  unpublish: { from: ['published'], to: 'draft' },
  archive: { from: ['draft', 'rejected', 'published', 'approved', 'reverted'], to: 'archived' },
  revert: { from: ['draft', 'in_review', 'approved', 'rejected'], to: 'reverted' },
}

// ── GET ─────────────────────────────────────────────────────────

/**
 * GET /api/content-pipeline — List content pipeline data
 * Query params: view (posts|generations|reviews), status, category, postId
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'posts'
  const status = searchParams.get('status')
  const category = searchParams.get('category')
  const postId = searchParams.get('postId')

  try {
    if (view === 'posts') {
      let rows
      if (status && category) {
        rows = await sql`
          SELECT * FROM content_posts
          WHERE status = ${status} AND category = ${category}
          ORDER BY updated_at DESC
        `
      } else if (status) {
        rows = await sql`
          SELECT * FROM content_posts
          WHERE status = ${status}
          ORDER BY updated_at DESC
        `
      } else if (category) {
        rows = await sql`
          SELECT * FROM content_posts
          WHERE category = ${category}
          ORDER BY updated_at DESC
        `
      } else {
        rows = await sql`
          SELECT * FROM content_posts
          ORDER BY updated_at DESC
        `
      }
      return NextResponse.json({ data: rows })

    } else if (view === 'generations') {
      const rows = await sql`
        SELECT * FROM content_generations
        ORDER BY created_at DESC
      `
      return NextResponse.json({ data: rows })

    } else if (view === 'reviews') {
      if (!postId) {
        return NextResponse.json({ error: 'postId is required for reviews view' }, { status: 400 })
      }
      const rows = await sql`
        SELECT * FROM content_reviews
        WHERE post_id = ${postId}
        ORDER BY created_at DESC
      `
      return NextResponse.json({ data: rows })

    } else {
      return NextResponse.json({ error: 'Invalid view parameter. Use: posts, generations, reviews' }, { status: 400 })
    }
  } catch (error) {
    console.error('[GET /api/content-pipeline] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch content pipeline data' }, { status: 500 })
  }
}

// ── POST ────────────────────────────────────────────────────────

/**
 * POST /api/content-pipeline — Create or generate content
 * Body: { action, ...params }
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action as string | undefined
  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  const userId = session.user.id
  const userEmail = session.user.email ?? undefined

  try {
    // ── Create a manual draft post ──────────────────────────
    if (action === 'create_post') {
      const title = body.title as string | undefined
      const bodyText = body.body as string | undefined
      const category = (body.category as string) ?? 'tip'

      if (!title) {
        return NextResponse.json({ error: 'title is required' }, { status: 400 })
      }

      const slug = generateSlug(title)
      const excerpt = (body.excerpt as string) ?? null
      const tags = (body.tags as string[]) ?? []
      const metaTitle = (body.metaTitle as string) ?? null
      const metaDescription = (body.metaDescription as string) ?? null

      const rows = await sql`
        INSERT INTO content_posts (slug, title, body, category, excerpt, tags, meta_title, meta_description, author_id, status)
        VALUES (
          ${slug},
          ${title},
          ${bodyText ?? ''},
          ${category},
          ${excerpt},
          ${tags},
          ${metaTitle},
          ${metaDescription},
          ${userId},
          'draft'
        )
        RETURNING *
      `

      emitPipelineEvent(
        'content_pipeline.post.created',
        userId,
        userEmail,
        `Draft post created: "${title}"`,
        { postId: rows[0].id, slug, category },
      ).catch(() => {})

      return NextResponse.json({ data: rows[0] }, { status: 201 })

    // ── Request AI content generation ───────────────────────
    } else if (action === 'generate') {
      const prompt = body.prompt as string | undefined
      if (!prompt) {
        return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
      }

      const category = (body.category as string) ?? 'tip'
      const model = (body.model as string) ?? 'claude-sonnet-4-20250514'
      const temperature = (body.temperature as number) ?? 0.7
      const systemPrompt = (body.systemPrompt as string) ?? null

      const rows = await sql`
        INSERT INTO content_generations (prompt, category, model, temperature, system_prompt, status, requested_by)
        VALUES (
          ${prompt},
          ${category},
          ${model},
          ${temperature},
          ${systemPrompt},
          'pending',
          ${userId}
        )
        RETURNING *
      `

      emitPipelineEvent(
        'content_pipeline.generation.requested',
        userId,
        userEmail,
        `AI generation requested: model=${model}, category=${category}`,
        { generationId: rows[0].id, model, category },
      ).catch(() => {})

      return NextResponse.json({ data: rows[0] }, { status: 201 })

    // ── Accept a generation → create post from it ───────────
    } else if (action === 'accept_generation') {
      const generationId = body.generationId as string | undefined
      if (!generationId) {
        return NextResponse.json({ error: 'generationId is required' }, { status: 400 })
      }

      // Fetch the generation
      const [gen] = await sql`
        SELECT * FROM content_generations WHERE id = ${generationId}
      `
      if (!gen) {
        return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
      }
      if (gen.status !== 'completed') {
        return NextResponse.json({ error: `Cannot accept generation with status "${gen.status}". Must be "completed".` }, { status: 400 })
      }

      const title = (gen.generatedTitle as string) ?? 'Untitled'
      const slug = generateSlug(title)

      // Create the post from generation output
      const [post] = await sql`
        INSERT INTO content_posts (
          slug, title, excerpt, body, category, tags,
          generation_id, generated_by_model, generation_prompt,
          author_id, status
        )
        VALUES (
          ${slug},
          ${title},
          ${(gen.generatedExcerpt as string) ?? null},
          ${(gen.generatedBody as string) ?? ''},
          ${gen.category as string},
          ${(gen.generatedTags as string[]) ?? []},
          ${generationId},
          ${gen.model as string},
          ${gen.prompt as string},
          ${userId},
          'draft'
        )
        RETURNING *
      `

      // Link generation to post and mark accepted
      await sql`
        UPDATE content_generations
        SET status = 'accepted', post_id = ${post.id}
        WHERE id = ${generationId}
      `

      emitPipelineEvent(
        'content_pipeline.generation.accepted',
        userId,
        userEmail,
        `Generation accepted and draft post created: "${title}"`,
        { generationId, postId: post.id, slug },
      ).catch(() => {})

      return NextResponse.json({ data: post }, { status: 201 })

    // ── Reject a generation ─────────────────────────────────
    } else if (action === 'reject_generation') {
      const generationId = body.generationId as string | undefined
      if (!generationId) {
        return NextResponse.json({ error: 'generationId is required' }, { status: 400 })
      }

      const [gen] = await sql`
        SELECT * FROM content_generations WHERE id = ${generationId}
      `
      if (!gen) {
        return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
      }
      if (gen.status !== 'completed') {
        return NextResponse.json({ error: `Cannot reject generation with status "${gen.status}". Must be "completed".` }, { status: 400 })
      }

      const notes = (body.notes as string) ?? null
      const [updated] = await sql`
        UPDATE content_generations
        SET status = 'rejected', error_message = ${notes}
        WHERE id = ${generationId}
        RETURNING *
      `

      emitPipelineEvent(
        'content_pipeline.generation.rejected',
        userId,
        userEmail,
        `Generation rejected${notes ? `: ${notes}` : ''}`,
        { generationId, notes },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    } else {
      return NextResponse.json({ error: 'Invalid action. Use: create_post, generate, accept_generation, reject_generation' }, { status: 400 })
    }
  } catch (error) {
    console.error(`[POST /api/content-pipeline] ${action} error:`, error)
    return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
  }
}

// ── PATCH ───────────────────────────────────────────────────────

/**
 * PATCH /api/content-pipeline — Workflow actions on posts
 * Body: { action, postId|generationId, ...params }
 */
export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action as string | undefined
  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  const userId = session.user.id
  const userEmail = session.user.email ?? undefined

  try {
    // ── Update draft post fields ────────────────────────────
    if (action === 'update_post') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const title = (body.title as string) ?? (post.title as string)
      const bodyText = (body.body as string) ?? (post.body as string)
      const excerpt = body.excerpt !== undefined ? (body.excerpt as string) : (post.excerpt as string | null)
      const tags = body.tags !== undefined ? (body.tags as string[]) : (post.tags as string[])
      const category = (body.category as string) ?? (post.category as string)
      const metaTitle = body.metaTitle !== undefined ? (body.metaTitle as string) : (post.metaTitle as string | null)
      const metaDescription = body.metaDescription !== undefined ? (body.metaDescription as string) : (post.metaDescription as string | null)

      // Save previous version for revert
      const [updated] = await sql`
        UPDATE content_posts
        SET
          title = ${title},
          body = ${bodyText},
          excerpt = ${excerpt},
          tags = ${tags},
          category = ${category},
          meta_title = ${metaTitle},
          meta_description = ${metaDescription},
          previous_body = ${post.body as string},
          previous_title = ${post.title as string},
          version = version + 1,
          updated_at = NOW()
        WHERE id = ${postId}
        RETURNING *
      `

      emitPipelineEvent(
        'content_pipeline.post.updated',
        userId,
        userEmail,
        `Post updated: "${title}" (v${updated.version})`,
        { postId, version: updated.version },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Submit for review ───────────────────────────────────
    } else if (action === 'submit_review') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.submit_review
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot submit for review: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET status = ${transition.to}, updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'submit_review',
          reviewerId: userId,
          titleSnapshot: post.title as string,
          bodySnapshot: post.body as string,
          version: post.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.submitted_for_review',
        userId,
        userEmail,
        `Post submitted for review: "${post.title}"`,
        { postId, previousStatus: post.status },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Approve ─────────────────────────────────────────────
    } else if (action === 'approve') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.approve
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot approve: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      const notes = (body.notes as string) ?? null
      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET status = ${transition.to}, reviewed_by = ${userId}, reviewed_at = NOW(), review_notes = ${notes}, updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'approve',
          reviewerId: userId,
          notes,
          titleSnapshot: post.title as string,
          bodySnapshot: post.body as string,
          version: post.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.approved',
        userId,
        userEmail,
        `Post approved: "${post.title}"${notes ? ` — ${notes}` : ''}`,
        { postId, notes },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Reject ──────────────────────────────────────────────
    } else if (action === 'reject') {
      const postId = body.postId as string | undefined
      const notes = body.notes as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }
      if (!notes) {
        return NextResponse.json({ error: 'notes is required when rejecting' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.reject
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot reject: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET status = ${transition.to}, reviewed_by = ${userId}, reviewed_at = NOW(), review_notes = ${notes}, updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'reject',
          reviewerId: userId,
          notes,
          titleSnapshot: post.title as string,
          bodySnapshot: post.body as string,
          version: post.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.rejected',
        userId,
        userEmail,
        `Post rejected: "${post.title}" — ${notes}`,
        { postId, notes },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Publish ─────────────────────────────────────────────
    } else if (action === 'publish') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.publish
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot publish: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET status = ${transition.to}, published_at = NOW(), published_by = ${userId}, updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'publish',
          reviewerId: userId,
          titleSnapshot: post.title as string,
          bodySnapshot: post.body as string,
          version: post.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.published',
        userId,
        userEmail,
        `Post published: "${post.title}"`,
        { postId, publishedAt: updated.publishedAt },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Unpublish ───────────────────────────────────────────
    } else if (action === 'unpublish') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.unpublish
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot unpublish: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET status = ${transition.to}, unpublished_at = NOW(), updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'unpublish',
          reviewerId: userId,
          titleSnapshot: post.title as string,
          bodySnapshot: post.body as string,
          version: post.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.unpublished',
        userId,
        userEmail,
        `Post unpublished: "${post.title}"`,
        { postId, unpublishedAt: updated.unpublishedAt },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Revert to previous version ──────────────────────────
    } else if (action === 'revert') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.revert
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot revert: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      if (!post.previousBody && !post.previousTitle) {
        return NextResponse.json({ error: 'No previous version to revert to' }, { status: 400 })
      }

      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET
            title = COALESCE(previous_title, title),
            body = COALESCE(previous_body, body),
            previous_title = NULL,
            previous_body = NULL,
            status = ${transition.to},
            version = version + 1,
            updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'revert',
          reviewerId: userId,
          notes: 'Reverted to previous version',
          titleSnapshot: row.title as string,
          bodySnapshot: row.body as string,
          version: row.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.reverted',
        userId,
        userEmail,
        `Post reverted to previous version: "${updated.title}" (v${updated.version})`,
        { postId, version: updated.version },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Archive ─────────────────────────────────────────────
    } else if (action === 'archive') {
      const postId = body.postId as string | undefined
      if (!postId) {
        return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      }

      const [post] = await sql`
        SELECT * FROM content_posts WHERE id = ${postId}
      `
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }

      const transition = VALID_TRANSITIONS.archive
      if (!transition.from.includes(post.status as string)) {
        return NextResponse.json(
          { error: `Cannot archive: post status is "${post.status}", must be one of: ${transition.from.join(', ')}` },
          { status: 400 },
        )
      }

      const updated = await sql.begin(async (_tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = _tx as any;
        const [row] = await tx`
          UPDATE content_posts
          SET status = ${transition.to}, updated_at = NOW()
          WHERE id = ${postId}
          RETURNING *
        `
        await createReviewRecord(tx, {
          postId,
          action: 'archive',
          reviewerId: userId,
          titleSnapshot: post.title as string,
          bodySnapshot: post.body as string,
          version: post.version as number,
        })
        return row
      })

      emitPipelineEvent(
        'content_pipeline.post.archived',
        userId,
        userEmail,
        `Post archived: "${post.title}"`,
        { postId },
      ).catch(() => {})

      return NextResponse.json({ data: updated })

    // ── Retry a failed generation ───────────────────────────
    } else if (action === 'retry_generation') {
      const generationId = body.generationId as string | undefined
      if (!generationId) {
        return NextResponse.json({ error: 'generationId is required' }, { status: 400 })
      }

      const [gen] = await sql`
        SELECT * FROM content_generations WHERE id = ${generationId}
      `
      if (!gen) {
        return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
      }
      if (gen.status !== 'failed') {
        return NextResponse.json(
          { error: `Cannot retry generation with status "${gen.status}". Must be "failed".` },
          { status: 400 },
        )
      }

      // Create a new generation request based on the failed one
      const [newGen] = await sql`
        INSERT INTO content_generations (prompt, category, model, temperature, system_prompt, status, requested_by, retry_count)
        VALUES (
          ${gen.prompt as string},
          ${gen.category as string},
          ${gen.model as string},
          ${gen.temperature as number},
          ${(gen.systemPrompt as string) ?? null},
          'pending',
          ${userId},
          ${(gen.retryCount as number) + 1}
        )
        RETURNING *
      `

      emitPipelineEvent(
        'content_pipeline.generation.retry_requested',
        userId,
        userEmail,
        `Generation retry requested (attempt ${newGen.retryCount + 1})`,
        { originalGenerationId: generationId, newGenerationId: newGen.id },
      ).catch(() => {})

      return NextResponse.json({ data: newGen }, { status: 201 })

    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use: update_post, submit_review, approve, reject, publish, unpublish, revert, archive, retry_generation' },
        { status: 400 },
      )
    }
  } catch (error) {
    console.error(`[PATCH /api/content-pipeline] ${action} error:`, error)
    return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
  }
}
