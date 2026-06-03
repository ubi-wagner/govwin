/** GET /api/admin/site/docs — list all documents (blog_post/resource/guide/testimonial/team_member). */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listDocuments } from '@/lib/content-admin';

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return a.res;
  try {
    return NextResponse.json({ data: await listDocuments() });
  } catch (e) {
    console.error('[api/admin/site/docs GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
