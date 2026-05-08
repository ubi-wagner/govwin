/**
 * CMS content helpers for server components.
 *
 * Provides typed access to published cms_content rows so any
 * marketing page can pull dynamic blocks without going through
 * the API layer. Direct DB access for server components only.
 */

import { sql } from '@/lib/db';

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
             published, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = ${contentType} AND published = true
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
             published, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE slug = ${slug} AND published = true
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
             published, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE ${tag} = ANY(tags) AND published = true
      ORDER BY display_order ASC, published_at DESC
    `;
    return rows;
  } catch (e) {
    console.error('[cms/getContentBlocks] error:', e);
    return [];
  }
}

/**
 * Fetch published content by multiple types (for the resources page).
 */
export async function getPublishedContentByTypes(contentTypes: string[], limit?: number): Promise<ContentRow[]> {
  try {
    const rows = await sql<ContentRow[]>`
      SELECT id, slug, title, content_type, body, excerpt, author, tags,
             published, published_at, featured_image, external_url,
             display_order, metadata, created_at, updated_at
      FROM cms_content
      WHERE content_type = ANY(${contentTypes}) AND published = true
      ORDER BY display_order ASC, published_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
    return rows;
  } catch (e) {
    console.error('[cms/getPublishedContentByTypes] error:', e);
    return [];
  }
}
