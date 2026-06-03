/** GET /api/admin/site/pages — list all content pages (active version + draft flag). */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listPages } from '@/lib/content-admin';

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  try {
    const pages = await listPages();
    return NextResponse.json({ data: pages });
  } catch (e) {
    console.error('[api/admin/site/pages GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
