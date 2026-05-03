/**
 * GET + POST /api/admin/rfp-curation/[solId]/outline
 *
 * GET:  Returns the current outline JSON for a solicitation from
 *       `solicitation_outlines`. Falls back to `curated_solicitations.ai_extracted`
 *       if no explicit outline row exists yet.
 * POST: Saves or updates the outline. Upserts into `solicitation_outlines`
 *       (one outline per solicitation).
 *
 * GET returns:  { data: { outline: object | null } }
 * POST returns: { data: { outline: object, outlineId: string } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: Role }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;

    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Try solicitation_outlines first ─────────────────────────────
    const outlineRows = await sql<{ id: string; outline: unknown }[]>`
      SELECT id, outline FROM solicitation_outlines
      WHERE solicitation_id = ${solId}::uuid
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (outlineRows.length > 0) {
      return NextResponse.json({
        data: { outline: outlineRows[0].outline, outlineId: outlineRows[0].id },
      });
    }

    // ── Fallback: ai_extracted from curated_solicitations ───────────
    const csRows = await sql<{ aiExtracted: unknown }[]>`
      SELECT ai_extracted FROM curated_solicitations
      WHERE id = ${solId}::uuid
    `;

    if (csRows.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: { outline: csRows[0].aiExtracted ?? null, outlineId: null },
    });
  } catch (error) {
    console.error('[rfp-curation] GET outline failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outline', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const user = session.user as {
      id?: string;
      role?: Role;
    };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;

    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Parse body ──────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { outline } = body;
    if (!outline || typeof outline !== 'object') {
      return NextResponse.json(
        { error: 'outline is required and must be an object', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // Validate outline has expected shape: must be a non-array object with
    // at least one key (e.g. volumes, sections, or title)
    if (Array.isArray(outline)) {
      return NextResponse.json(
        { error: 'outline must be a JSON object, not an array', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    const outlineKeys = Object.keys(outline as Record<string, unknown>);
    if (outlineKeys.length === 0) {
      return NextResponse.json(
        { error: 'outline must not be empty', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const actorId = user.id!;

    // ── Verify solicitation exists ──────────────────────────────────
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM curated_solicitations WHERE id = ${solId}::uuid
    `;
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Upsert outline ──────────────────────────────────────────────
    // Check if an outline row exists for this solicitation
    const existingOutline = await sql<{ id: string }[]>`
      SELECT id FROM solicitation_outlines
      WHERE solicitation_id = ${solId}::uuid
      LIMIT 1
    `;

    let row: { id: string; outline: unknown };
    if (existingOutline.length > 0) {
      [row] = await sql<{ id: string; outline: unknown }[]>`
        UPDATE solicitation_outlines
        SET outline = ${JSON.stringify(outline)}::jsonb,
            created_by = ${actorId}::uuid,
            updated_at = now()
        WHERE solicitation_id = ${solId}::uuid
        RETURNING id, outline
      `;
    } else {
      [row] = await sql<{ id: string; outline: unknown }[]>`
        INSERT INTO solicitation_outlines
          (solicitation_id, outline, created_by)
        VALUES
          (${solId}::uuid, ${JSON.stringify(outline)}::jsonb, ${actorId}::uuid)
        RETURNING id, outline
      `;
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'outline.saved',
      actor: { type: 'user', id: actorId },
      tenantId: null,
      payload: { correlationId: randomUUID(), solicitationId: solId, outlineId: row.id },
    });

    return NextResponse.json({
      data: { outline: row.outline, outlineId: row.id },
    });
  } catch (error) {
    console.error('[rfp-curation] POST outline failed:', error);
    return NextResponse.json(
      { error: 'Failed to save outline', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
