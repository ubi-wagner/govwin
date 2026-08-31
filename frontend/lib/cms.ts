/**
 * CMS content helpers for server components.
 *
 * Typed access to published front-facing content so a marketing page can pull its blocks without
 * going through the API layer. Direct DB access, server components only.
 *
 * ── ONE STORE: `content_pages` ───────────────────────────────────────────────────────────────
 * Every read here is `content_pages` — the versioned, canvas-native store the admin Site Content
 * editor writes. The legacy `cms_content` table is no longer read by this module.
 *
 * It was, until this pass, through four fallbacks that could not fire. All 14 documents in the
 * legacy table have a matching active `content_pages` row; all 116 of its page-blocks belong to
 * nine pages that are migrated (block counts equal or larger) or three whose routes are redirects
 * and never ask for blocks. A fallback that cannot fire is worse than none: it reads as a
 * still-live second source, so nobody retires the table and nobody notices when a reader — the
 * sitemap did exactly this — is still pointed at it and quietly serves the old set.
 *
 * docs/CMS_CRM_CONSOLIDATION.md has the measurements and the remaining phases.
 */

import { sql } from '@/lib/db';

/**
 * Log a read-path DB error, but stay silent during `next build`. The build
 * container has no DB connection (Railway injects DB creds only into the running
 * container), so these reads intentionally fail and fall back to in-code defaults.
 * Suppressing during the build phase keeps build output clean while still
 * surfacing genuine failures at runtime.
 */
function logReadError(tag: string, e: unknown): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  console.error(`${tag} error:`, e);
}

export type ContentStatus = 'draft' | 'pending' | 'published' | 'private' | 'archived';

export interface ContentRow {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  /** Block grouping key (hero, pillars, …). Authoritative over tags for buildLookup. */
  section?: string;
  body: string;
  excerpt: string | null;
  author: string | null;
  tags: string[];
  published: boolean;
  status: ContentStatus;
  publishedAt: Date | null;
  featuredImage: string | null;
  externalUrl: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── V8 documents: read from content_pages (active doc versions), mapped to the
// legacy ContentRow shape so existing marketing components render unchanged. ──

/** Map a content_pages document row (camelCase via the sql transform) to ContentRow. */
function docRowToContentRow(r: Record<string, unknown>): ContentRow {
  const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {};
  const blocks = Array.isArray(r.blocks) ? (r.blocks as Record<string, unknown>[]) : [];
  const bodyBlock = blocks[0] ?? {};
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    id: String(r.id ?? ''),
    slug: typeof r.pageKey === 'string' ? r.pageKey : '',
    title: typeof r.title === 'string' ? r.title : '',
    contentType: typeof r.contentType === 'string' ? r.contentType : '',
    body: typeof bodyBlock.body === 'string' ? bodyBlock.body : '',
    excerpt: str(meta.excerpt) ?? str(bodyBlock.excerpt),
    author: str(meta.author),
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
    published: true,
    status: 'published',
    publishedAt: (r.publishedAt as Date) ?? null,
    featuredImage: str(meta.featuredImage),
    externalUrl: str(meta.externalUrl),
    displayOrder: 0,
    metadata: meta,
    createdAt: (r.createdAt as Date) ?? new Date(0),
    updatedAt: (r.createdAt as Date) ?? new Date(0),
  };
}

/** Active documents of the given content types from content_pages. */
async function activeDocs(types: string[], limit?: number): Promise<ContentRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM content_pages
    WHERE content_type = ANY(${types}) AND status = 'active'
    ORDER BY published_at DESC NULLS LAST, created_at DESC
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;
  return rows.map(docRowToContentRow);
}

/**
 * Single active ARTICLE by slug (page_key). Restricted to the three article types that have a
 * public detail page (/resources/[slug]) — NOT team_member/testimonial (list-only) nor 'page'
 * (a marketing page), so those are never reachable/indexable as a generic article at that route.
 */
const ARTICLE_TYPES = ['resource', 'guide', 'blog_post'] as const;
async function activeDocBySlug(slug: string): Promise<ContentRow | null> {
  const [row] = await sql<Record<string, unknown>[]>`
    SELECT * FROM content_pages
    WHERE page_key = ${slug} AND status = 'active'
      AND content_type = ANY(${ARTICLE_TYPES as unknown as string[]})
    ORDER BY published_at DESC NULLS LAST
    LIMIT 1
  `;
  return row ? docRowToContentRow(row) : null;
}

/**
 * Fetch published content by type, from `content_pages` — the canonical store.
 *
 * The legacy `cms_content` fallback that used to sit here is gone. It was unreachable: every one of
 * the 14 documents in that table has a matching active `content_pages` row (checked by slug and
 * type, zero uncovered), and this function only reached the fallback when `content_pages` returned
 * nothing for a type. See docs/CMS_CRM_CONSOLIDATION.md §1a.
 */
export async function getPublishedContent(contentType: string, limit?: number): Promise<ContentRow[]> {
  try {
    return await activeDocs([contentType], limit);
  } catch (e) {
    logReadError('[cms/getPublishedContent]', e);
    return [];
  }
}

/**
 * Fetch a single content item by slug (published only).
 */
export async function getContentBySlug(slug: string): Promise<ContentRow | null> {
  try {
    return await activeDocBySlug(slug);
  } catch (e) {
    logReadError('[cms/getContentBySlug]', e);
    return null;
  }
}




/**
 * Fetch the blocks for a page from the V8 content store (content_pages).
 *
 * Public pages read the single `active` version; preview (`includeDrafts`) reads
 * the latest `draft` version, falling back to active when no draft exists. Blocks
 * are returned in the legacy ContentRow shape so marketing page components
 * (buildLookup/single/many) render unchanged.
 */
export async function getPageBlocks(page: string, includeDrafts = false): Promise<ContentRow[]> {
  try {
    const wantStatus = includeDrafts ? 'draft' : 'active';
    let rows = await sql<{ blocks: unknown }[]>`
      SELECT blocks FROM content_pages
      WHERE page_key = ${page} AND content_type = 'page' AND status = ${wantStatus}
      ORDER BY version_no DESC
      LIMIT 1
    `;
    if (rows.length === 0 && includeDrafts) {
      // Preview with no draft yet → show the live version.
      rows = await sql<{ blocks: unknown }[]>`
        SELECT blocks FROM content_pages
        WHERE page_key = ${page} AND content_type = 'page' AND status = 'active'
        ORDER BY version_no DESC
        LIMIT 1
      `;
    }
    const blocks = rows[0]?.blocks;
    if (Array.isArray(blocks)) {
      return (blocks as Record<string, unknown>[]).map(pageBlockToRow);
    }
    // No active content_pages row for this page. There is no legacy fallback any more: the twelve
    // page keys in `cms_content` are nine pages that ARE migrated (block counts equal or larger)
    // and three whose routes are redirects and never call this. An empty array is the honest
    // answer for a page nobody has authored — the fallback could only have returned another
    // page's blocks. docs/CMS_CRM_CONSOLIDATION.md §1a.
    return [];
  } catch (e) {
    logReadError('[cms/getPageBlocks]', e);
    return [];
  }
}


/** Map a content_pages JSON block to the legacy ContentRow shape used by page components. */
function pageBlockToRow(b: Record<string, unknown>): ContentRow {
  const metadata = (b.metadata && typeof b.metadata === 'object')
    ? (b.metadata as Record<string, unknown>)
    : {};
  const tags = Array.isArray(b.tags) ? (b.tags as string[]) : [];
  return {
    id: String(b.id ?? ''),
    slug: typeof b.slug === 'string' ? b.slug : '',
    title: typeof b.title === 'string' ? b.title : '',
    contentType: 'page_block',
    section: typeof b.section === 'string' ? b.section : undefined,
    body: typeof b.body === 'string' ? b.body : '',
    excerpt: typeof b.excerpt === 'string' ? b.excerpt : null,
    author: null,
    tags,
    published: true,
    status: 'published',
    publishedAt: null,
    featuredImage: typeof b.featuredImage === 'string' ? b.featuredImage : null,
    externalUrl: typeof b.externalUrl === 'string' ? b.externalUrl : null,
    displayOrder: typeof b.displayOrder === 'number' ? b.displayOrder : 0,
    metadata,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/**
 * Group page blocks by their section tag (second tag after the page name).
 * Returns a map of section → single ContentRow or ContentRow[] (for lists).
 */
export function buildLookup(blocks: ContentRow[], page: string): Record<string, ContentRow | ContentRow[]> {
  const grouped: Record<string, ContentRow[]> = {};
  for (const block of blocks) {
    // Prefer the explicit section (what the editor edits); fall back to the
    // legacy tag-derived section, for blocks that carry their section in `tags`.
    const sectionKey = block.section || block.tags.find((t: string) => t !== page) || 'unknown';
    if (!grouped[sectionKey]) grouped[sectionKey] = [];
    grouped[sectionKey].push(block);
  }
  const result: Record<string, ContentRow | ContentRow[]> = {};
  for (const [key, items] of Object.entries(grouped)) {
    result[key] = items.length === 1 ? items[0] : items;
  }
  return result;
}

/**
 * Helper to safely extract a single ContentRow from a lookup entry.
 */
export function single(entry: ContentRow | ContentRow[] | undefined): ContentRow | undefined {
  if (!entry) return undefined;
  return Array.isArray(entry) ? entry[0] : entry;
}

/**
 * Helper to safely extract an array of ContentRow from a lookup entry.
 */
export function many(entry: ContentRow | ContentRow[] | undefined): ContentRow[] {
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

/**
 * Fetch published content by multiple types (for the resources page).
 */
export async function getPublishedContentByTypes(contentTypes: string[], limit?: number): Promise<ContentRow[]> {
  try {
    return await activeDocs(contentTypes, limit);
  } catch (e) {
    logReadError('[cms/getPublishedContentByTypes]', e);
    return [];
  }
}
