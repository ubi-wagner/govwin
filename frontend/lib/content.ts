/**
 * Content Management — Server-side helpers for dynamic page content
 *
 * Marketing pages call getPageContent() at render time. If published
 * content exists in the DB, it's returned. Otherwise, the page
 * falls back to its static/hardcoded content.
 *
 * This module is server-only — import only in Server Components or API routes.
 */
import { sql } from '@/lib/db'
import { unstable_noStore as noStore } from 'next/cache'
import type { ContentPageKey, ContentMetadata } from '@/types'

export interface PublishedContent {
  content: Record<string, unknown>
  metadata: ContentMetadata
  publishedAt: string
}

/**
 * Fetch published content for a marketing page.
 * Returns null if no published content exists (page should use static fallback).
 *
 * Safe to call in Server Components — errors return null silently.
 */
export async function getPageContent(pageKey: ContentPageKey): Promise<PublishedContent | null> {
  // Opt out of Next.js data cache so published content changes are visible immediately
  noStore()

  try {
    const rows = await sql`
      SELECT published_content, published_metadata, published_at
      FROM site_content
      WHERE page_key = ${pageKey} AND published_content IS NOT NULL
    `
    if (rows.length === 0) return null

    const content = rows[0].publishedContent as Record<string, unknown>
    // Treat empty objects as unpublished — they have no section data to merge
    if (!content || Object.keys(content).length === 0) return null

    return {
      content,
      metadata: rows[0].publishedMetadata as ContentMetadata,
      publishedAt: rows[0].publishedAt as string,
    }
  } catch (error) {
    console.error(`[getPageContent] Failed to load content for ${pageKey}:`, error)
    return null
  }
}

/**
 * Helper to merge published content with static defaults.
 * If a section exists in the published content, use it. Otherwise use the static default.
 */
export function mergeContent<T>(
  published: Record<string, unknown> | null,
  staticDefaults: T
): T {
  if (!published) return staticDefaults

  const merged = { ...staticDefaults } as Record<string, unknown>
  for (const key of Object.keys(staticDefaults as Record<string, unknown>)) {
    if (published[key] !== undefined) {
      merged[key] = published[key]
    }
  }
  return merged as T
}

/**
 * Helper to merge SEO metadata.
 * Published metadata overrides static metadata fields.
 */
export function mergeMetadata(
  published: ContentMetadata | null,
  staticMeta: { title: string; description: string }
): { title: string; description: string } {
  if (!published) return staticMeta
  return {
    title: published.title ?? staticMeta.title,
    description: published.description ?? staticMeta.description,
  }
}
