/**
 * PATCH /api/admin/rfp-curation/[solId]/annotations/[annotationId]
 *
 * Update an annotation's classification metadata — the section type, side tags, and
 * accept status — which the admin atomization rail writes into the annotation's
 * `payload` JSONB. This is how a drawn highlight/box becomes a classified,
 * accepted section anchor for downstream matching.
 *
 * Reads the current payload with coerceJsonb (tolerating the legacy
 * JSON.stringify::jsonb string form) and rewrites it via sql.json so it round-trips
 * as a real object going forward.
 *
 * Body: { sectionType?, tags?[], status?, complianceVariableName? }
 * Returns: { data: { annotation } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUS = ['draft', 'approved', 'archived'] as const;

interface RouteContext {
  params: Promise<{ solId: string; annotationId: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { solId, annotationId } = await ctx.params;
    if (!UUID_RE.test(solId) || !UUID_RE.test(annotationId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { sectionType?: string | null; tags?: string[]; status?: string; complianceVariableName?: string | null };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.status !== undefined && !(VALID_STATUS as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUS.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be an array', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // Load the annotation (scoped to the solicitation) + its current payload.
    let row: { id: string; payload: unknown } | undefined;
    try {
      [row] = await sql<Array<{ id: string; payload: unknown }>>`
        SELECT id, payload FROM solicitation_annotations
        WHERE id = ${annotationId}::uuid AND solicitation_id = ${solId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[annotations/patch] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Annotation not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Merge into the existing payload (coerced — tolerant of the legacy string form).
    const current = coerceJsonb<Record<string, unknown>>(row.payload, {});
    const merged: Record<string, unknown> = { ...current };
    if (body.sectionType !== undefined) merged.sectionType = body.sectionType;
    if (body.tags !== undefined) merged.tags = body.tags.filter((t) => typeof t === 'string');
    if (body.status !== undefined) merged.status = body.status;

    let updated: Record<string, unknown> | undefined;
    try {
      const rows = await sql`
        UPDATE solicitation_annotations
        SET payload = ${sql.json(merged as Parameters<typeof sql.json>[0])},
            compliance_variable_name = COALESCE(${body.complianceVariableName ?? null}, compliance_variable_name),
            updated_at = now()
        WHERE id = ${annotationId}::uuid AND solicitation_id = ${solId}::uuid
        RETURNING id, kind, source_location, payload, compliance_variable_name, updated_at
      `;
      updated = rows[0];
    } catch (e) {
      console.error('[annotations/patch] update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'annotation.classified',
        actor: { type: 'user', id: user.id ?? 'unknown' },
        tenantId: null,
        payload: { correlationId: randomUUID(), solicitationId: solId, annotationId, sectionType: merged.sectionType ?? null, status: merged.status ?? null },
      });
    } catch {
      // best-effort
    }

    return NextResponse.json({ data: { annotation: updated } });
  } catch (err) {
    console.error('[annotations/patch] error:', err);
    return NextResponse.json({ error: 'Failed to update annotation', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
