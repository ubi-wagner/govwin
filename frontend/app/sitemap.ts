import { MetadataRoute } from 'next';
import { sql } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rfppipeline.com';

  // Static pages
  const staticPages = [
    '', '/about', '/features', '/pricing', '/how-it-works',
    '/engine', '/the-expert', '/blog', '/resources', '/team',
    '/customers', '/apply', '/infosec', '/legal/terms',
    '/legal/privacy', '/legal/acceptable-use', '/legal/ai-disclosure',
  ].map(path => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: path === '' ? 'daily' as const : 'weekly' as const,
    priority: path === '' ? 1.0 : 0.8,
  }));

  // Dynamic blog/resource pages
  try {
    const posts = await sql`
      SELECT slug, content_type, updated_at FROM cms_content
      WHERE status = 'published' AND content_type IN ('blog_post', 'resource', 'guide')
      ORDER BY updated_at DESC
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
