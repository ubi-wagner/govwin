import { permanentRedirect } from 'next/navigation';

// V8: the standalone blog is consolidated into Resources. Individual posts now
// live at /resources/[slug] (same slug, served from content_pages). The RSS feed
// stays at /blog/feed.xml (a separate route, unaffected by this redirect).
export default async function BlogPostRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  permanentRedirect(`/resources/${slug}`);
}
