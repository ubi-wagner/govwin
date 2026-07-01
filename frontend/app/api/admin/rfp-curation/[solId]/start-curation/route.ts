/**
 * POST /api/admin/rfp-curation/[solId]/start-curation
 *
 * The missing transition: `claimed` → `curation_in_progress`. A claimed solicitation
 * must move here before the admin can request review (solicitation-request-review
 * requires curation_in_progress). Compare-and-swap on status. rfp_admin+.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ solId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const user = session.user as { id?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { solId } = await params;
    if (!UUID_RE.test(solId)) return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });

    let updated: Array<{ id: string; status: string }>;
    try {
      // Compare-and-swap: only from 'claimed' (idempotent-safe; already-in-progress is a no-op success).
      updated = await sql<Array<{ id: string; status: string }>>`
        UPDATE curated_solicitations
        SET status = 'curation_in_progress', updated_at = now()
        WHERE id = ${solId}::uuid AND status = 'claimed'
        RETURNING id, status
      `;
    } catch (e) {
      console.error('[start-curation] update failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (updated.length === 0) {
      // Either not found, or not in 'claimed'. Distinguish for a clean UX.
      const [cur] = await sql<Array<{ status: string }>>`SELECT status FROM curated_solicitations WHERE id = ${solId}::uuid LIMIT 1`;
      if (!cur) return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
      if (cur.status === 'curation_in_progress') return NextResponse.json({ data: { status: 'curation_in_progress', noop: true } });
      return NextResponse.json({ error: `Cannot start curation from status '${cur.status}' (must be 'claimed')`, code: 'CONFLICT' }, { status: 409 });
    }

    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'solicitation.curation_started',
        actor: { type: 'user', id: user.id ?? 'unknown' },
        tenantId: null,
        payload: { correlationId: randomUUID(), solicitationId: solId },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ data: { status: 'curation_in_progress' } });
  } catch (err) {
    console.error('[start-curation] error', err);
    return NextResponse.json({ error: 'Failed to start curation', code: 'DB_ERROR' }, { status: 500 });
  }
}
