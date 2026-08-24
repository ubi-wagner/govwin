/**
 * V8 content admin — server-side CRUD for the page-versioned content store
 * (content_pages, Main DB). Drafts are whole-page snapshots; publish promotes
 * the latest draft to active and archives the prior active + intermediate
 * drafts (kept as history). See ARCHITECTURE_V8.md.
 */
import { sql } from '@/lib/db';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { docBodyFromCanvas } from '@/lib/content-canvas';

export interface PageBlock {
  section: string;
  displayOrder: number;
  title?: string | null;
  body?: string | null;
  excerpt?: string | null;
  featuredImage?: string | null;
  metadata?: Record<string, unknown>;
  slug?: string;
  tags?: string[];
}

export type PageStatus = 'draft' | 'active' | 'archived';

export interface PageVersion {
  id: string;
  pageKey: string;
  contentType: string;
  versionNo: number;
  status: PageStatus;
  title: string | null;
  blocks: PageBlock[];
  metadata: Record<string, unknown>;
  auditNote: string | null;
  createdBy: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
}

// Result rows arrive camelCase — the sql client maps column names with
// `transform.column.from = postgres.toCamel` (see lib/db.ts).
interface PageRow {
  id: string;
  pageKey: string;
  contentType: string;
  versionNo: number;
  status: PageStatus;
  title: string | null;
  blocks: unknown;
  metadata: unknown;
  auditNote: string | null;
  createdBy: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
}

function toVersion(r: PageRow): PageVersion {
  return {
    id: r.id,
    pageKey: r.pageKey,
    contentType: r.contentType,
    versionNo: r.versionNo,
    status: r.status,
    title: r.title,
    blocks: Array.isArray(r.blocks) ? (r.blocks as PageBlock[]) : [],
    metadata: r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {},
    auditNote: r.auditNote,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
    archivedAt: r.archivedAt,
  };
}

export interface PageSummary {
  pageKey: string;
  contentType: string;
  activeVersion: number | null;
  hasDraft: boolean;
  lastUpdated: Date | null;
  lastUpdatedBy: string | null;
}

/** All pages with their active version, draft state, and who last touched them. */
export async function listPages(): Promise<PageSummary[]> {
  const rows = await sql<{
    pageKey: string;
    contentType: string;
    activeVersion: number | null;
    hasDraft: boolean;
    lastUpdated: Date | null;
    lastUpdatedBy: string | null;
  }[]>`
    SELECT page_key,
           min(content_type)                                  AS content_type,
           max(version_no) FILTER (WHERE status = 'active')   AS active_version,
           bool_or(status = 'draft')                          AS has_draft,
           max(created_at)                                    AS last_updated,
           (array_agg(created_by ORDER BY version_no DESC))[1] AS last_updated_by
    FROM content_pages
    WHERE content_type = 'page'
    GROUP BY page_key
    ORDER BY page_key
  `;
  return rows.map((r) => ({
    pageKey: r.pageKey,
    contentType: r.contentType,
    activeVersion: r.activeVersion,
    hasDraft: r.hasDraft,
    lastUpdated: r.lastUpdated,
    lastUpdatedBy: r.lastUpdatedBy,
  }));
}

/**
 * Seed a page's default blocks as an active v1 if it has no content_pages row yet.
 * Idempotent: a page that already has any row (active/draft/archived) is left
 * untouched, so this never clobbers edited content. Returns true if it seeded.
 * The seed equals the page's in-code defaults, so the public page is unchanged —
 * it just makes the editor populated instead of blank.
 */
export async function ensurePageSeeded(pageKey: string): Promise<boolean> {
  const { PAGE_SEEDS } = await import('@/lib/page-content');
  const seed = PAGE_SEEDS[pageKey];
  if (!seed) return false;
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO content_pages
        (page_key, content_type, version_no, status, title, blocks, audit_note, created_by, published_at)
      SELECT ${pageKey}, 'page', 1, 'active', ${seed.title},
             ${sql.json(seed.blocks as unknown as Parameters<typeof sql.json>[0])},
             'Seeded from page defaults', 'system', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM content_pages WHERE page_key = ${pageKey} AND content_type = 'page'
      )
      RETURNING id
    `;
    return rows.length > 0;
  } catch (e) {
    // A concurrent open can race the partial-unique active index — non-fatal.
    console.error('[content-admin/ensurePageSeeded] error:', e);
    return false;
  }
}

/** The live (active) version and the working (latest draft) version for a page. */
export async function getPage(
  pageKey: string,
): Promise<{ active: PageVersion | null; draft: PageVersion | null }> {
  const rows = await sql<PageRow[]>`
    SELECT * FROM content_pages
    WHERE page_key = ${pageKey} AND content_type = 'page' AND status IN ('active', 'draft')
    ORDER BY version_no DESC
  `;
  const active = rows.find((r) => r.status === 'active') ?? null;
  const draft = rows.find((r) => r.status === 'draft') ?? null;
  return {
    active: active ? toVersion(active) : null,
    draft: draft ? toVersion(draft) : null,
  };
}

/** Save a whole-page draft snapshot (new version) with an audit note. */
export async function saveDraft(
  pageKey: string,
  blocks: PageBlock[],
  note: string,
  user: { id?: string; email?: string },
  opts: { contentType?: string; title?: string | null } = {},
): Promise<PageVersion> {
  const [row] = await sql<PageRow[]>`
    INSERT INTO content_pages
      (page_key, content_type, version_no, status, title, blocks, audit_note, created_by)
    VALUES (
      ${pageKey},
      ${opts.contentType ?? 'page'},
      (SELECT COALESCE(max(version_no), 0) + 1 FROM content_pages WHERE page_key = ${pageKey} AND content_type = ${opts.contentType ?? 'page'}),
      'draft',
      ${opts.title ?? pageKey},
      ${sql.json(blocks as unknown as Parameters<typeof sql.json>[0])},
      ${note},
      ${user.email ?? user.id ?? 'unknown'}
    )
    RETURNING *
  `;
  return toVersion(row);
}

/** Publish the latest draft: promote it to active, archive the prior active + older drafts. */
export async function publishPage(
  pageKey: string,
): Promise<{ published: boolean; versionNo?: number; reason?: string }> {
  return await sql.begin(async (tx: any) => {
    const draftRows = await tx`
      SELECT id, version_no FROM content_pages
      WHERE page_key = ${pageKey} AND content_type = 'page' AND status = 'draft'
      ORDER BY version_no DESC
      LIMIT 1
    `;
    const draft = draftRows[0] as { id: string; versionNo: number } | undefined;
    if (!draft) return { published: false, reason: 'no_draft' };

    // Archive the current active and any intermediate drafts (kept as history).
    await tx`
      UPDATE content_pages
      SET status = 'archived', archived_at = now()
      WHERE page_key = ${pageKey}
        AND content_type = 'page'
        AND status IN ('active', 'draft')
        AND id <> ${draft.id}
    `;
    // Promote the latest draft to the single active version.
    await tx`
      UPDATE content_pages
      SET status = 'active', published_at = now()
      WHERE id = ${draft.id}
    `;
    return { published: true, versionNo: draft.versionNo };
  }).then(async (r: { published: boolean; versionNo?: number; reason?: string }) => {
    if (r.published) await closePublishTodos(pageKey, 'page');
    return r;
  });
}

/** Full version history for a page, newest first. */
export async function getVersions(pageKey: string): Promise<PageVersion[]> {
  const rows = await sql<PageRow[]>`
    SELECT * FROM content_pages
    WHERE page_key = ${pageKey} AND content_type = 'page'
    ORDER BY version_no DESC
  `;
  return rows.map(toVersion);
}

// ── Documents (blog_post / resource / guide / testimonial / team_member) ──────
// A document shares the content_pages store + version model, but is a single body
// block + metadata (tags / excerpt / featuredImage / externalUrl / author),
// scoped by content_type so it never collides with a page of the same slug.

export const DOC_TYPES = ['blog_post', 'resource', 'guide', 'testimonial', 'team_member'] as const;

export interface DocSummary {
  slug: string;
  contentType: string;
  title: string | null;
  activeVersion: number | null;
  hasDraft: boolean;
  lastUpdated: Date;
}

export interface DocFields {
  title: string;
  body: string;
  excerpt?: string | null;
  tags?: string[];
  featuredImage?: string | null;
  externalUrl?: string | null;
  author?: string | null;
  /**
   * Canvas-native authoring: when present, this CanvasDocument is the source of truth
   * (persisted in metadata.canvas) and `body` is IGNORED in favor of the canvas → HTML
   * projection (docBodyFromCanvas). Absent → legacy plain-body behavior (body used as-is),
   * so nothing regresses for callers that don't pass a canvas.
   */
  canvas?: CanvasDocument | null;
}

/** All documents (content_type <> 'page'), one row per (type, slug). */
export async function listDocuments(): Promise<DocSummary[]> {
  const rows = await sql<{
    pageKey: string;
    contentType: string;
    title: string | null;
    activeVersion: number | null;
    hasDraft: boolean;
    lastUpdated: Date;
  }[]>`
    SELECT page_key,
           content_type,
           (array_agg(title ORDER BY version_no DESC))[1]   AS title,
           max(version_no) FILTER (WHERE status = 'active') AS active_version,
           bool_or(status = 'draft')                        AS has_draft,
           max(created_at)                                  AS last_updated
    FROM content_pages
    WHERE content_type <> 'page'
    GROUP BY page_key, content_type
    ORDER BY content_type, page_key
  `;
  return rows.map((r) => ({
    slug: r.pageKey,
    contentType: r.contentType,
    title: r.title,
    activeVersion: r.activeVersion,
    hasDraft: r.hasDraft,
    lastUpdated: r.lastUpdated,
  }));
}

/**
 * Active + latest draft for one document, plus whether any archived (retired)
 * version exists — `hasArchived` lets the editor offer Restore only when there is
 * genuinely something to bring back.
 */
export async function getDocument(
  slug: string,
  contentType: string,
): Promise<{ active: PageVersion | null; draft: PageVersion | null; hasArchived: boolean }> {
  const rows = await sql<PageRow[]>`
    SELECT * FROM content_pages
    WHERE page_key = ${slug} AND content_type = ${contentType}
    ORDER BY version_no DESC
  `;
  const active = rows.find((r) => r.status === 'active') ?? null;
  const draft = rows.find((r) => r.status === 'draft') ?? null;
  const hasArchived = rows.some((r) => r.status === 'archived');
  return {
    active: active ? toVersion(active) : null,
    draft: draft ? toVersion(draft) : null,
    hasArchived,
  };
}

/**
 * On-demand lifecycle for a document (posting): retire a live one or restore a
 * retired one — independent of publishing a replacement.
 *   'archive'  → the active version goes to 'archived' (the posting is no longer live).
 *   'restore'  → the newest archived version is promoted back to 'active' (any current
 *                active is archived first, to respect the single-active-per-key index).
 * Version history is preserved either way. DOC_TYPES only (never a 'page').
 */
export async function setDocumentStatus(
  slug: string,
  contentType: string,
  action: 'archive' | 'restore',
): Promise<{ ok: boolean; reason?: string }> {
  if (!(DOC_TYPES as readonly string[]).includes(contentType)) return { ok: false, reason: 'invalid_type' };
  return await sql.begin(async (tx: any) => {
    if (action === 'archive') {
      const rows = await tx`
        UPDATE content_pages SET status = 'archived', archived_at = now()
        WHERE page_key = ${slug} AND content_type = ${contentType} AND status = 'active'
        RETURNING id
      `;
      return rows.length > 0 ? { ok: true } : { ok: false, reason: 'no_active' };
    }
    // restore: newest archived → active (archive any current active first)
    const targetRows = await tx`
      SELECT id FROM content_pages
      WHERE page_key = ${slug} AND content_type = ${contentType} AND status = 'archived'
      ORDER BY version_no DESC LIMIT 1
    `;
    const target = targetRows[0] as { id: string } | undefined;
    if (!target) return { ok: false, reason: 'no_archived' };
    await tx`
      UPDATE content_pages SET status = 'archived', archived_at = now()
      WHERE page_key = ${slug} AND content_type = ${contentType} AND status = 'active'
    `;
    await tx`UPDATE content_pages SET status = 'active', published_at = now() WHERE id = ${target.id}`;
    return { ok: true };
  });
}

/** Save a document draft (single body block + metadata) as a new version. */
export async function saveDocumentDraft(
  slug: string,
  contentType: string,
  fields: DocFields,
  note: string,
  user: { id?: string; email?: string },
): Promise<PageVersion> {
  // Canvas-native: the canvas is the source of truth; the public body is its HTML projection.
  // Rendered server-side so a client can never inject an arbitrary body — the body always
  // matches the stored canvas. Legacy callers (no canvas) keep the plain body verbatim.
  const projectedBody = fields.canvas ? docBodyFromCanvas(fields.canvas) : fields.body;
  const blocks = [{
    section: 'body',
    title: fields.title,
    body: projectedBody,
    excerpt: fields.excerpt ?? null,
    metadata: {},
  }];
  const metadata = {
    tags: fields.tags ?? [],
    excerpt: fields.excerpt ?? null,
    featuredImage: fields.featuredImage ?? null,
    externalUrl: fields.externalUrl ?? null,
    author: fields.author ?? null,
    canvas: fields.canvas ?? null,
  };
  const [row] = await sql<PageRow[]>`
    INSERT INTO content_pages
      (page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by)
    VALUES (
      ${slug},
      ${contentType},
      (SELECT COALESCE(max(version_no), 0) + 1 FROM content_pages WHERE page_key = ${slug} AND content_type = ${contentType}),
      'draft',
      ${fields.title},
      ${sql.json(blocks as unknown as Parameters<typeof sql.json>[0])},
      ${sql.json(metadata as unknown as Parameters<typeof sql.json>[0])},
      ${note},
      ${user.email ?? user.id ?? 'unknown'}
    )
    RETURNING *
  `;
  return toVersion(row);
}

/** Publish a document: promote its latest draft, archive prior active + drafts. */
/**
 * Close the review ToDo that asked for this publish.
 *
 * A `content_publish` ToDo means "a human still has to look at this and publish it". Publishing IS
 * that work, so leaving the ToDo open is a queue that can never be emptied — and an admin whose
 * content-review list only ever grows stops reading it, which is how the next real review gets
 * missed. Nothing completed these before: a published BAA guide sat with an open "Review & publish"
 * ToDo whose entity pointed at a version the publish had since archived.
 *
 * MATCHED BY page_key, NOT by the entity id. The ToDo names a specific `content_pages` ROW, and a
 * publish rewrites rows — the draft is promoted and the prior active is archived — so an id that
 * was right when the ToDo was raised can be stale by the time anyone acts on it. The page_key is
 * the thing that stays the same across versions, which makes it the honest join.
 *
 * Best-effort by design: it runs after the publish transaction has committed and never throws. A
 * publish that succeeded must not be reported as failed because a bookkeeping update did not.
 */
async function closePublishTodos(pageKey: string, contentType: string): Promise<number> {
  try {
    const res = await sql`
      UPDATE tasks SET status = 'completed', completed_at = now()
      WHERE task_type = 'content_publish'
        AND status = 'open'
        AND entity_id IN (
          SELECT id FROM content_pages WHERE page_key = ${pageKey} AND content_type = ${contentType}
        )`;
    return res.count ?? 0;
  } catch (e) {
    console.error('[content-admin] closePublishTodos failed', e);
    return 0;
  }
}

export async function publishDocument(
  slug: string,
  contentType: string,
): Promise<{ published: boolean; versionNo?: number; reason?: string }> {
  return await sql.begin(async (tx: any) => {
    const draftRows = await tx`
      SELECT id, version_no FROM content_pages
      WHERE page_key = ${slug} AND content_type = ${contentType} AND status = 'draft'
      ORDER BY version_no DESC
      LIMIT 1
    `;
    const draft = draftRows[0] as { id: string; versionNo: number } | undefined;
    if (!draft) return { published: false, reason: 'no_draft' };
    await tx`
      UPDATE content_pages SET status = 'archived', archived_at = now()
      WHERE page_key = ${slug} AND content_type = ${contentType}
        AND status IN ('active', 'draft') AND id <> ${draft.id}
    `;
    await tx`UPDATE content_pages SET status = 'active', published_at = now() WHERE id = ${draft.id}`;
    return { published: true, versionNo: draft.versionNo };
  }).then(async (r: { published: boolean; versionNo?: number; reason?: string }) => {
    if (r.published) await closePublishTodos(slug, contentType);
    return r;
  });
}
