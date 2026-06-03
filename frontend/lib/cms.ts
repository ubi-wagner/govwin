/**
 * CMS content helpers for server components.
 *
 * Provides typed access to published cms_content rows so any
 * marketing page can pull dynamic blocks without going through
 * the API layer. Direct DB access for server components only.
 */

import { sql } from '@/lib/db';

export type ContentStatus = 'draft' | 'pending' | 'published' | 'private' | 'archived';

export interface ContentRow {
  id: string;
  slug: string;
  title: string;
  contentType: string;
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

/**
 * Fetch published content by type, ordered by display_order then published_at.
 */
export async function getPublishedContent(contentType: string, limit?: number): Promise<ContentRow[]> {
  try {
    const rows = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = ${contentType} AND status = 'published'
      ORDER BY display_order ASC, published_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
    return rows;
  } catch (e) {
    console.error('[cms/getPublishedContent] error:', e);
    return [];
  }
}

/**
 * Fetch a single content item by slug (published only).
 */
export async function getContentBySlug(slug: string): Promise<ContentRow | null> {
  try {
    const [row] = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE slug = ${slug} AND status = 'published'
      LIMIT 1
    `;
    return row ?? null;
  } catch (e) {
    console.error('[cms/getContentBySlug] error:', e);
    return null;
  }
}

/**
 * Fetch a single content item by slug (any status — for admin preview).
 */
export async function getContentBySlugAdmin(slug: string): Promise<ContentRow | null> {
  try {
    const [row] = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE slug = ${slug}
      LIMIT 1
    `;
    return row ?? null;
  } catch (e) {
    console.error('[cms/getContentBySlugAdmin] error:', e);
    return null;
  }
}

/**
 * Fetch a single content item by ID (any status — for admin preview).
 */
export async function getContentByIdAdmin(id: string): Promise<ContentRow | null> {
  try {
    const [row] = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE id = ${id}
      LIMIT 1
    `;
    return row ?? null;
  } catch (e) {
    console.error('[cms/getContentByIdAdmin] error:', e);
    return null;
  }
}

/**
 * Fetch published content matching a given tag.
 */
export async function getContentBlocks(tag: string): Promise<ContentRow[]> {
  try {
    const rows = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE ${tag} = ANY(tags) AND status = 'published'
      ORDER BY display_order ASC, published_at DESC
    `;
    return rows;
  } catch (e) {
    console.error('[cms/getContentBlocks] error:', e);
    return [];
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
      WHERE page_key = ${page} AND status = ${wantStatus}
      ORDER BY version_no DESC
      LIMIT 1
    `;
    if (rows.length === 0 && includeDrafts) {
      // Preview with no draft yet → show the live version.
      rows = await sql<{ blocks: unknown }[]>`
        SELECT blocks FROM content_pages
        WHERE page_key = ${page} AND status = 'active'
        ORDER BY version_no DESC
        LIMIT 1
      `;
    }
    const blocks = rows[0]?.blocks;
    if (Array.isArray(blocks)) {
      return (blocks as Record<string, unknown>[]).map(pageBlockToRow);
    }
    // Transition safety: no content_pages row yet → fall back to legacy cms_content.
    return await getPageBlocksLegacy(page, includeDrafts);
  } catch (e) {
    console.error('[cms/getPageBlocks] error:', e);
    return [];
  }
}

/** Legacy per-block read from cms_content. Used only until content_pages is populated for a page. */
async function getPageBlocksLegacy(page: string, includeDrafts: boolean): Promise<ContentRow[]> {
  if (includeDrafts) {
    return await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = 'page_block' AND ${page} = ANY(tags)
        AND status IN ('published', 'draft')
      ORDER BY display_order ASC, created_at ASC
    `;
  }
  return await sql<ContentRow[]>`
    SELECT id, slug, title, content_type, body, excerpt, author, tags,
           published, status, published_at, featured_image, external_url,
           display_order, metadata, created_at, updated_at
    FROM cms_content
    WHERE content_type = 'page_block' AND ${page} = ANY(tags)
      AND status = 'published'
    ORDER BY display_order ASC, created_at ASC
  `;
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
    const sectionTag = block.tags.find((t: string) => t !== page) ?? 'unknown';
    if (!grouped[sectionTag]) grouped[sectionTag] = [];
    grouped[sectionTag].push(block);
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
    const rows = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = ANY(${contentTypes}) AND status = 'published'
      ORDER BY display_order ASC, published_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
    return rows;
  } catch (e) {
    console.error('[cms/getPublishedContentByTypes] error:', e);
    return [];
  }
}
