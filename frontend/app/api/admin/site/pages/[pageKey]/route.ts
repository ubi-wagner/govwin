/** GET /api/admin/site/pages/[pageKey] — the active + latest draft version of a page. */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPage } from '@/lib/content-admin';

export async function GET(_req: Request, { params }: { params: Promise<{ pageKey: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { pageKey } = await params;
  try {
    const page = await getPage(pageKey);
    return NextResponse.json({ data: page });
  } catch (e) {
    console.error('[api/admin/site/pages/[pageKey] GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
