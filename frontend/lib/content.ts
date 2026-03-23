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
 * Deep-merge published content into static defaults.
 *
 * - Top-level sections missing from published → use static default
 * - Published section is a plain object → recursively merge fields
 *   (so partial CMS edits don't clobber fields the CMS didn't touch)
 * - Published section is an array or primitive → replace entirely
 */
export function mergeContent<T>(
  published: Record<string, unknown> | null,
  staticDefaults: T
): T {
  if (!published) return staticDefaults

  const defaults = staticDefaults as Record<string, unknown>
  const merged = { ...defaults }

  for (const key of Object.keys(defaults)) {
    const pub = published[key]
    if (pub === undefined) continue

    const def = defaults[key]
    // Deep-merge plain objects (not arrays, not null)
    if (
      pub && def &&
      typeof pub === 'object' && typeof def === 'object' &&
      !Array.isArray(pub) && !Array.isArray(def)
    ) {
      const mergedSection: Record<string, unknown> = { ...(def as Record<string, unknown>) }
      for (const [k, v] of Object.entries(pub as Record<string, unknown>)) {
        if (v !== undefined) mergedSection[k] = v
      }
      merged[key] = mergedSection
    } else {
      merged[key] = pub
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
