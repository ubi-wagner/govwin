/** GET /api/admin/site/docs/[type]/[slug] — active + latest draft of a document. */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDocument } from '@/lib/content-admin';

export async function GET(_req: Request, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { type, slug } = await params;
  try {
    return NextResponse.json({ data: await getDocument(slug, type) });
  } catch (e) {
    console.error('[api/admin/site/docs/[type]/[slug] GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
