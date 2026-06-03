/** GET /api/admin/site/pages/[pageKey]/versions — full version history, newest first. */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getVersions } from '@/lib/content-admin';

export async function GET(_req: Request, { params }: { params: Promise<{ pageKey: string }> }) {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  const { pageKey } = await params;
  try {
    const versions = await getVersions(pageKey);
    return NextResponse.json({ data: versions });
  } catch (e) {
    console.error('[api/admin/site/pages/[pageKey]/versions GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
