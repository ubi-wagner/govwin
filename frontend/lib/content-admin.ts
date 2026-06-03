/**
 * V8 content admin — server-side CRUD for the page-versioned content store
 * (content_pages, Main DB). Drafts are whole-page snapshots; publish promotes
 * the latest draft to active and archives the prior active + intermediate
 * drafts (kept as history). See ARCHITECTURE_V8.md.
 */
import { sql } from '@/lib/db';

export interface PageBlock {
  section: string;
  displayOrder: number;
  title?: string | null;
  body?: string | null;
  excerpt?: string | null;
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
  lastUpdated: Date;
}

/** All pages with their active version and whether an unpublished draft exists. */
export async function listPages(): Promise<PageSummary[]> {
  const rows = await sql<{
    pageKey: string;
    contentType: string;
    activeVersion: number | null;
    hasDraft: boolean;
    lastUpdated: Date;
  }[]>`
    SELECT page_key,
           min(content_type)                                AS content_type,
           max(version_no) FILTER (WHERE status = 'active') AS active_version,
           bool_or(status = 'draft')                        AS has_draft,
           max(created_at)                                  AS last_updated
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
  }));
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
