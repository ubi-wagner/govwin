import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import VisualEditor from './visual-editor';

export const dynamic = 'force-dynamic';

export default async function VisualEditorPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  // Fetch distinct page tags from cms_content page_blocks
  let pages: string[] = [];
  try {
    const rows = await sql<{ tag: string }[]>`
      SELECT DISTINCT unnest(tags) AS tag
      FROM cms_content
      WHERE content_type = 'page_block'
      ORDER BY tag ASC
    `;
    // Filter to known page tags (not section tags)
    const PAGE_TAGS = new Set([
      'homepage', 'about', 'features', 'value', 'pricing',
      'how-it-works', 'engine', 'the-expert', 'security', 'infosec',
      'apply', 'get-started', 'resources',
    ]);
    pages = rows.map((r: { tag: string }) => r.tag).filter((t: string) => PAGE_TAGS.has(t));
  } catch (e) {
    console.error('[admin/content/editor] query failed:', e);
  }

  return (
    <div className="-m-8 h-screen">
      <VisualEditor pages={pages} />
    </div>
  );
}
