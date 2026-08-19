/**
 * GET + POST /api/admin/rfp-curation/[solId]/notes — the curation note thread (mig 190).
 *
 * The master OPP's internal margin: append-only admin comments that survive every status
 * (the old note fields were transition-coupled — dead once pushed_to_pipeline went
 * terminal). Internal by contract: never customer-visible, never on the bridge. The
 * customer-facing channels remain the amendment engine (formal updates) and the
 * opportunity's expert note (rides the card snapshot).
 *
 * Auth: rfp_admin / master_admin (platform-scope).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext { params: Promise<{ solId: string }> }

async function requireAdmin() {
  const session = await auth();
  const su = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
  const role = isRole(su?.role) ? su!.role : null;
  if (!su?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) return null;
  return { id: su.id, email: su.email ?? undefined };
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    try {
      const notes = await sql<Array<{ id: string; authorEmail: string | null; body: string; createdAt: Date }>>`
        SELECT id, author_email AS "authorEmail", body, created_at AS "createdAt"
        FROM curation_notes WHERE solicitation_id = ${solId}::uuid
        ORDER BY created_at DESC LIMIT 200`;
      return NextResponse.json({ data: { notes } });
    } catch (e) {
      console.error('[curation-notes] list failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[curation-notes] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let body: { body?: unknown } = {};
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > 4000) {
      return NextResponse.json({ error: 'body (1–4000 chars) is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    try {
      const [note] = await sql<Array<{ id: string; createdAt: Date }>>`
        INSERT INTO curation_notes (solicitation_id, author_id, author_email, body)
        SELECT ${solId}::uuid, ${admin.id}::uuid, ${admin.email ?? null}, ${text}
        WHERE EXISTS (SELECT 1 FROM curated_solicitations WHERE id = ${solId}::uuid)
        RETURNING id, created_at AS "createdAt"`;
      if (!note) return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
      try {
        await emitEventSingle({
          namespace: 'finder', type: 'curation_note.added',
          actor: userActor(admin.id, admin.email), tenantId: null,
          payload: { solicitationId: solId, noteId: note.id },
        });
      } catch (e) { console.error('[curation-notes] emit failed (non-fatal)', e); }
      return NextResponse.json({ data: { id: note.id, createdAt: note.createdAt } }, { status: 201 });
    } catch (e) {
      console.error('[curation-notes] insert failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[curation-notes] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
