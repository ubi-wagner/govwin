import { getPublishedContent } from '@/lib/cms';

export async function GET() {
  const posts = await getPublishedContent('blog_post', 50);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.rfppipeline.com';

  const items = posts.map(p => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${baseUrl}/blog/${p.slug}</link>
      <description><![CDATA[${p.excerpt || ''}]]></description>
      <pubDate>${new Date(p.publishedAt || p.createdAt).toUTCString()}</pubDate>
      <guid>${baseUrl}/blog/${p.slug}</guid>
    </item>
  `).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>RFP Pipeline Blog</title>
    <link>${baseUrl}/blog</link>
    <description>Insights on government contracting, SBIR/STTR proposals, and AI-powered RFP management</description>
    <atom:link href="${baseUrl}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
