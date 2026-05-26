/**
 * GET + PUT + DELETE /api/admin/rfp-curation/[solId]/topics/[topicId]/compliance
 *
 * GET:    Returns the resolved compliance for a topic (merged: topic -> solicitation -> defaults).
 * PUT:    Save topic-level compliance overrides.
 * DELETE: Remove topic overrides (revert to solicitation baseline).
 *
 * Returns: { data: { compliance: {...}, source: 'topic'|'solicitation'|'none', volumes: [...] } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';
import type { Role } from '@/lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ solId: string; topicId: string }>;
}

function rowToCompliance(row: Record<string, unknown>): Record<string, unknown> {
  return {
    pageLimitTechnical: row.pageLimitTechnical ?? null,
    pageLimitCost: row.pageLimitCost ?? null,
    fontFamily: row.fontFamily ?? null,
    fontSize: row.fontSize ?? null,
    margins: row.margins ?? null,
    lineSpacing: row.lineSpacing ?? null,
    headerRequired: row.headerRequired ?? null,
    headerFormat: row.headerFormat ?? null,
    footerRequired: row.footerRequired ?? null,
    footerFormat: row.footerFormat ?? null,
    submissionFormat: row.submissionFormat ?? null,
    slidesAllowed: row.slidesAllowed ?? null,
    slideLimit: row.slideLimit ?? null,
    tabaAllowed: row.tabaAllowed ?? null,
    piMustBeEmployee: row.piMustBeEmployee ?? null,
    partnerMaxPct: row.partnerMaxPct ?? null,
    clearanceRequired: row.clearanceRequired ?? null,
    itarRequired: row.itarRequired ?? null,
  };
}

async function authCheck() {
  const session = await auth();
  if (!session?.user) return { error: 'Authentication required', code: 'UNAUTHENTICATED', status: 401 };
  const user = session.user as { id?: string; role?: Role };
  if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
    return { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN', status: 403 };
  }
  return { user };
}

export async function GET(_request: Request, ctx: RouteContext) {
  const authResult = await authCheck();
  if ('error' in authResult) {
    return NextResponse.json(
      { error: authResult.error, code: authResult.code },
      { status: authResult.status },
    );
  }

  const { solId, topicId } = await ctx.params;
  if (!UUID_RE.test(solId) || !UUID_RE.test(topicId)) {
    return NextResponse.json(
      { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  try {
    // 1. Try topic-level compliance
    const topicComp = await sql<Record<string, unknown>[]>`
      SELECT * FROM solicitation_compliance
      WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
    `;

    // 2. Fall back to solicitation baseline
    const solComp = await sql<Record<string, unknown>[]>`
      SELECT * FROM solicitation_compliance
      WHERE solicitation_id = ${solId}::uuid AND topic_id IS NULL
    `;

    let source: 'topic' | 'solicitation' | 'none' = 'none';
    let compliance: Record<string, unknown> = {};

    if (topicComp.length > 0) {
      source = 'topic';
      compliance = rowToCompliance(topicComp[0]);
    } else if (solComp.length > 0) {
      source = 'solicitation';
      compliance = rowToCompliance(solComp[0]);
    }

    // 3. Get topic-specific volumes (fall back to solicitation baseline)
    const topicVolumes = await sql<{
      volumeId: string;
      volumeNumber: number;
      volumeName: string;
      volumeFormat: string | null;
      description: string | null;
      items: unknown[];
    }[]>`
      SELECT
        v.id AS volume_id, v.volume_number, v.volume_name,
        v.volume_format, v.description,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', i.id, 'itemNumber', i.item_number,
            'itemName', i.item_name, 'itemType', i.item_type,
            'required', i.required, 'pageLimit', i.page_limit,
            'slideLimit', i.slide_limit
          ) ORDER BY i.item_number) FROM volume_required_items i WHERE i.volume_id = v.id),
          '[]'::json
        ) AS items
      FROM solicitation_volumes v
      WHERE v.solicitation_id = ${solId}::uuid
        AND (v.topic_id = ${topicId}::uuid OR v.topic_id IS NULL)
      ORDER BY v.topic_id NULLS LAST, v.volume_number ASC
    `;

    // If we have topic-specific volumes, use those; otherwise use solicitation baseline
    const hasTopicVolumes = topicVolumes.some((v) => v.volumeId !== null);
    const volumes = topicVolumes.map((v) => ({
      id: v.volumeId,
      volumeNumber: v.volumeNumber,
      volumeName: v.volumeName,
      volumeFormat: v.volumeFormat,
      description: v.description,
      items: v.items ?? [],
    }));

    return NextResponse.json({
      data: {
        compliance,
        source,
        solicitationCompliance: solComp.length > 0 ? rowToCompliance(solComp[0]) : null,
        volumes,
        hasTopicVolumes,
      },
    });
  } catch (err) {
    console.error('[topic-compliance] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch topic compliance', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, ctx: RouteContext) {
  const authResult = await authCheck();
  if ('error' in authResult) {
    return NextResponse.json(
      { error: authResult.error, code: authResult.code },
      { status: authResult.status },
    );
  }

  const { solId, topicId } = await ctx.params;
  if (!UUID_RE.test(solId) || !UUID_RE.test(topicId)) {
    return NextResponse.json(
      { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  const c = (body.compliance ?? body) as Record<string, unknown>;

  try {
    // Verify topic belongs to this solicitation
    const [topic] = await sql<{ id: string }[]>`
      SELECT id FROM opportunities
      WHERE id = ${topicId}::uuid AND solicitation_id = ${solId}::uuid
    `;
    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found under this solicitation', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Upsert compliance row
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM solicitation_compliance
      WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
    `;

    if (existing.length > 0) {
      await sql`
        UPDATE solicitation_compliance SET
          page_limit_technical = ${(c.pageLimitTechnical as number) ?? (c.page_limit_technical as number) ?? null},
          page_limit_cost = ${(c.pageLimitCost as number) ?? (c.page_limit_cost as number) ?? null},
          font_family = ${(c.fontFamily as string) ?? (c.font_family as string) ?? null},
          font_size = ${(c.fontSize as string) ?? (c.font_size as string) ?? null},
          margins = ${(c.margins as string) ?? null},
          line_spacing = ${(c.lineSpacing as string) ?? (c.line_spacing as string) ?? null},
          header_required = ${(c.headerRequired as boolean) ?? (c.header_required as boolean) ?? false},
          header_format = ${(c.headerFormat as string) ?? (c.header_format as string) ?? null},
          footer_required = ${(c.footerRequired as boolean) ?? (c.footer_required as boolean) ?? false},
          footer_format = ${(c.footerFormat as string) ?? (c.footer_format as string) ?? null},
          submission_format = ${(c.submissionFormat as string) ?? (c.submission_format as string) ?? null},
          slides_allowed = ${(c.slidesAllowed as boolean) ?? (c.slides_allowed as boolean) ?? false},
          slide_limit = ${(c.slideLimit as number) ?? (c.slide_limit as number) ?? null},
          taba_allowed = ${(c.tabaAllowed as boolean) ?? (c.taba_allowed as boolean) ?? null},
          pi_must_be_employee = ${(c.piMustBeEmployee as boolean) ?? (c.pi_must_be_employee as boolean) ?? null},
          partner_max_pct = ${(c.partnerMaxPct as number) ?? (c.partner_max_pct as number) ?? null},
          clearance_required = ${(c.clearanceRequired as string) ?? (c.clearance_required as string) ?? null},
          itar_required = ${(c.itarRequired as boolean) ?? (c.itar_required as boolean) ?? false},
          verified_by = ${authResult.user.id ?? null},
          verified_at = now(),
          updated_at = now()
        WHERE id = ${existing[0].id}::uuid
      `;
    } else {
      await sql`
        INSERT INTO solicitation_compliance (
          solicitation_id, topic_id,
          page_limit_technical, page_limit_cost,
          font_family, font_size, margins, line_spacing,
          header_required, header_format, footer_required, footer_format,
          submission_format, slides_allowed, slide_limit,
          taba_allowed, pi_must_be_employee, partner_max_pct,
          clearance_required, itar_required,
          verified_by, verified_at
        ) VALUES (
          ${solId}::uuid, ${topicId}::uuid,
          ${(c.pageLimitTechnical as number) ?? (c.page_limit_technical as number) ?? null},
          ${(c.pageLimitCost as number) ?? (c.page_limit_cost as number) ?? null},
          ${(c.fontFamily as string) ?? (c.font_family as string) ?? null},
          ${(c.fontSize as string) ?? (c.font_size as string) ?? null},
          ${(c.margins as string) ?? null},
          ${(c.lineSpacing as string) ?? (c.line_spacing as string) ?? null},
          ${(c.headerRequired as boolean) ?? (c.header_required as boolean) ?? false},
          ${(c.headerFormat as string) ?? (c.header_format as string) ?? null},
          ${(c.footerRequired as boolean) ?? (c.footer_required as boolean) ?? false},
          ${(c.footerFormat as string) ?? (c.footer_format as string) ?? null},
          ${(c.submissionFormat as string) ?? (c.submission_format as string) ?? null},
          ${(c.slidesAllowed as boolean) ?? (c.slides_allowed as boolean) ?? false},
          ${(c.slideLimit as number) ?? (c.slide_limit as number) ?? null},
          ${(c.tabaAllowed as boolean) ?? (c.taba_allowed as boolean) ?? null},
          ${(c.piMustBeEmployee as boolean) ?? (c.pi_must_be_employee as boolean) ?? null},
          ${(c.partnerMaxPct as number) ?? (c.partner_max_pct as number) ?? null},
          ${(c.clearanceRequired as string) ?? (c.clearance_required as string) ?? null},
          ${(c.itarRequired as boolean) ?? (c.itar_required as boolean) ?? false},
          ${authResult.user.id ?? null},
          now()
        )
      `;
    }

    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'compliance.topic_override_saved',
        actor: { type: 'user', id: authResult.user.id ?? 'unknown' },
        tenantId: null,
        payload: {
          correlationId: randomUUID(),
          solicitationId: solId,
          topicId,
        },
      });
    } catch (e) {
      console.error('[topic-compliance] PUT event emission failed:', e);
      // non-fatal, continue
    }

    return NextResponse.json({ data: { topicId, saved: true } });
  } catch (err) {
    console.error('[topic-compliance] PUT failed:', err);
    return NextResponse.json(
      { error: 'Failed to save topic compliance', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const authResult = await authCheck();
  if ('error' in authResult) {
    return NextResponse.json(
      { error: authResult.error, code: authResult.code },
      { status: authResult.status },
    );
  }

  const { solId, topicId } = await ctx.params;
  if (!UUID_RE.test(solId) || !UUID_RE.test(topicId)) {
    return NextResponse.json(
      { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  try {
    // Delete topic-specific compliance
    await sql`
      DELETE FROM solicitation_compliance
      WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
    `;

    // Delete topic-specific volumes + their items
    const volRows = await sql<{ id: string }[]>`
      SELECT id FROM solicitation_volumes
      WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
    `;
    if (volRows.length > 0) {
      const volIds = volRows.map((v) => v.id);
      await sql`DELETE FROM volume_required_items WHERE volume_id = ANY(${volIds}::uuid[])`;
      await sql`DELETE FROM solicitation_volumes
        WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid`;
    }

    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'compliance.topic_override_cleared',
        actor: { type: 'user', id: authResult.user.id ?? 'unknown' },
        tenantId: null,
        payload: {
          correlationId: randomUUID(),
          solicitationId: solId,
          topicId,
        },
      });
    } catch (e) {
      console.error('[topic-compliance] DELETE event emission failed:', e);
      // non-fatal, continue
    }

    return NextResponse.json({ data: { topicId, cleared: true } });
  } catch (err) {
    console.error('[topic-compliance] DELETE failed:', err);
    return NextResponse.json(
      { error: 'Failed to clear topic compliance', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
