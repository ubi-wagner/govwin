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
 * Fetch all published page_block entries for a given page tag.
 * Returns rows ordered by display_order for use in marketing page rendering.
 */
export async function getPageBlocks(page: string): Promise<ContentRow[]> {
  try {
    const rows = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, status, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = 'page_block'
        AND ${page} = ANY(tags)
        AND status = 'published'
      ORDER BY display_order ASC, created_at ASC
    `;
    return rows;
  } catch (e) {
    console.error('[cms/getPageBlocks] error:', e);
    return [];
  }
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
