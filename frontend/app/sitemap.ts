import { MetadataRoute } from 'next';
import { sql } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rfppipeline.com';

  // Static pages
  const staticPages = [
    '', '/about', '/features', '/pricing', '/how-it-works',
    '/the-expert', '/blog', '/resources', '/team',
    '/customers', '/apply', '/infosec', '/legal/terms',
    '/legal/privacy', '/legal/acceptable-use', '/legal/ai-disclosure',
  ].map(path => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: path === '' ? 'daily' as const : 'weekly' as const,
    priority: path === '' ? 1.0 : 0.8,
  }));

  // Dynamic blog/resource/guide pages.
  //
  // ── THIS READ THE SUPERSEDED STORE, AND SEARCH ENGINES SAW THE CONSEQUENCE ──────────────────
  // Front-facing content moved to `content_pages` (the versioned, canvas-native store the admin
  // Site Content editor writes). `cms_content` is the legacy table kept only as a read-fallback
  // during that transition — and this file never moved. Everything published since read as absent:
  // measured on the sandbox corpus, 4 live documents (3 guides and 1 resource) existed, were
  // reachable, and were missing from the sitemap. Nothing looks broken, because a sitemap that
  // omits a page renders exactly like one that does not.
  //
  // `status = 'active'` is the published state in `content_pages`; the legacy table called it
  // 'published'. Highest `version_no` per key, because the store is versioned and every prior
  // version is still a row.
  try {
    const posts = await sql`
      -- COALESCE(published_at, created_at): content_pages has no updated_at. Writing one anyway
      -- threw 42703, and the catch below turned that into "static pages only" — a sitemap that
      -- looks entirely normal and silently drops every article. Same shape as the defect this
      -- change is fixing, which is why the fix was verified by counting the served entries rather
      -- than by the build passing.
      SELECT DISTINCT ON (page_key, content_type)
             page_key AS slug, content_type,
             COALESCE(published_at, created_at) AS updated_at
        FROM content_pages
       WHERE status = 'active' AND content_type IN ('blog_post', 'resource', 'guide')
       ORDER BY page_key, content_type, version_no DESC
    `;
    const dynamicPages = posts.map(p => ({
      url: `${baseUrl}/${p.contentType === 'blog_post' ? 'blog' : 'resources'}/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
    return [...staticPages, ...dynamicPages];
  } catch {
    return staticPages;
  }
}
