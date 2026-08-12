/**
 * GET /admin/site/content/[id] — resolve a content_pages row id to its Content Studio editor URL
 * and redirect. This is the deep-link target for the `content_publish` review ToDo (HITL P4 / #163):
 * the ToDo carries the content_pages row id as its entity, and the Studio editor is keyed by
 * type + slug, so this maps id → /admin/site/docs/[type]/[slug].
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { sql } from '@/lib/db';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { id } = await params;
  const base = new URL(req.url).origin;
  try {
    const rows = await sql<{ contentType: string; pageKey: string }[]>`
      SELECT content_type, page_key FROM content_pages WHERE id = ${id}::uuid LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.contentType === 'page') {
      // Not a document (or gone) — fall back to the content hub.
      return NextResponse.redirect(`${base}/admin/site`);
    }
    return NextResponse.redirect(`${base}/admin/site/docs/${encodeURIComponent(row.contentType)}/${encodeURIComponent(row.pageKey)}`);
  } catch (e) {
    console.error('[admin/site/content/[id]] resolve failed:', e);
    return NextResponse.redirect(`${base}/admin/site`);
  }
}
