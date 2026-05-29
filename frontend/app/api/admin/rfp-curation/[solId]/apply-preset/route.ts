/**
 * POST /api/admin/rfp-curation/[solId]/apply-preset
 *
 * Applies a compliance preset (or raw compliance + volumes data) to one
 * or more topics under a solicitation. For each topicId:
 *   1. Upserts a solicitation_compliance row with topic_id set
 *   2. Creates solicitation_volumes + volume_required_items from preset's volumes_data
 *
 * Body:
 *   { topicIds: string[], presetId: string }
 *   OR
 *   { topicIds: string[], compliance: object, volumes: object[] }
 *
 * Returns: { data: { applied: number, topicIds: string[] } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd } from '@/lib/events';
import type { Role } from '@/lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ solId: string }>;
}

interface PresetVolume {
  volume_name: string;
  volume_number: number;
  volume_format?: string;
  description?: string;
  items?: Array<{
    item_name: string;
    item_type: string;
    page_limit?: number | null;
    slide_limit?: number | null;
    required?: boolean;
    font_family?: string | null;
    font_size?: string | null;
    margins?: string | null;
    line_spacing?: string | null;
    header_format?: string | null;
    footer_format?: string | null;
  }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  // ── Auth check ──────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const user = session.user as { id?: string; role?: Role };
  if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
    return NextResponse.json(
      { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const { solId } = await ctx.params;
  if (!UUID_RE.test(solId)) {
    return NextResponse.json(
      { error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' },
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

  // ── Validate topicIds ───────────────────────────────────────────
  const topicIds = body.topicIds;
  if (!Array.isArray(topicIds) || topicIds.length === 0) {
    return NextResponse.json(
      { error: 'topicIds must be a non-empty array', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }
  for (const tid of topicIds) {
    if (typeof tid !== 'string' || !UUID_RE.test(tid)) {
      return NextResponse.json(
        { error: `Invalid topicId: ${tid}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
  }

  // ── Resolve compliance + volumes data ───────────────────────────
  let complianceData: Record<string, unknown>;
  let volumesData: PresetVolume[];

  if (body.presetId && typeof body.presetId === 'string') {
    if (!UUID_RE.test(body.presetId)) {
      return NextResponse.json(
        { error: 'Invalid presetId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    try {
      const [preset] = await sql<{
        complianceData: Record<string, unknown>;
        volumesData: PresetVolume[];
      }[]>`
        SELECT compliance_data, volumes_data
        FROM compliance_presets WHERE id = ${body.presetId}::uuid
      `;
      if (!preset) {
        return NextResponse.json(
          { error: 'Preset not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      complianceData = preset.complianceData;
      volumesData = preset.volumesData;
    } catch (err) {
      console.error('[apply-preset] preset lookup failed:', err);
      return NextResponse.json(
        { error: 'Failed to load preset', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } else if (body.compliance && typeof body.compliance === 'object') {
    complianceData = body.compliance as Record<string, unknown>;
    volumesData = (body.volumes as PresetVolume[]) ?? [];
  } else {
    return NextResponse.json(
      { error: 'Either presetId or compliance object is required', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  // ── Verify topics belong to this solicitation ───────────────────
  try {
    const verifyRows = await sql<{ id: string }[]>`
      SELECT id FROM opportunities
      WHERE id = ANY(${topicIds}::uuid[])
        AND solicitation_id = ${solId}::uuid
    `;
    if (verifyRows.length !== topicIds.length) {
      return NextResponse.json(
        { error: 'One or more topicIds do not belong to this solicitation', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
  } catch (err) {
    console.error('[apply-preset] topic verification failed:', err);
    return NextResponse.json(
      { error: 'Failed to verify topics', code: 'DB_ERROR' },
      { status: 500 },
    );
  }

  // ── Start event ─────────────────────────────────────────────────
  const startId = await emitEventStart({
    namespace: 'finder',
    type: 'compliance.preset_applied',
    actor: { type: 'user', id: user.id ?? 'unknown' },
    tenantId: null,
    payload: {
      solicitationId: solId,
      topicIds,
      presetId: (body.presetId as string) ?? null,
      topicCount: topicIds.length,
    },
  });

  // ── Apply to each topic ─────────────────────────────────────────
  try {
    const cd = complianceData;

    // Dual-fallback reads: accept both snake_case and camelCase keys
    // so copy-from-topic (camelCase) and presets (snake_case) both work.
    const pageLimitTechnical = (cd.page_limit_technical ?? cd.pageLimitTechnical ?? null) as number | null;
    const pageLimitCost = (cd.page_limit_cost ?? cd.pageLimitCost ?? null) as number | null;
    const fontFamily = (cd.font_family ?? cd.fontFamily ?? null) as string | null;
    const fontSize = (cd.font_size ?? cd.fontSize ?? null) as string | null;
    const margins = (cd.margins ?? null) as string | null;
    const lineSpacing = (cd.line_spacing ?? cd.lineSpacing ?? null) as string | null;
    const headerRequired = (cd.header_required ?? cd.headerRequired ?? null) as boolean | null;
    const headerFormat = (cd.header_format ?? cd.headerFormat ?? null) as string | null;
    const footerRequired = (cd.footer_required ?? cd.footerRequired ?? null) as boolean | null;
    const footerFormat = (cd.footer_format ?? cd.footerFormat ?? null) as string | null;
    const submissionFormat = (cd.submission_format ?? cd.submissionFormat ?? null) as string | null;
    const slidesAllowed = (cd.slides_allowed ?? cd.slidesAllowed ?? null) as boolean | null;
    const slideLimit = (cd.slide_limit ?? cd.slideLimit ?? null) as number | null;
    const tabaAllowed = (cd.taba_allowed ?? cd.tabaAllowed ?? null) as boolean | null;
    const piMustBeEmployee = (cd.pi_must_be_employee ?? cd.piMustBeEmployee ?? null) as boolean | null;
    const partnerMaxPct = (cd.partner_max_pct ?? cd.partnerMaxPct ?? null) as number | null;
    const clearanceRequired = (cd.clearance_required ?? cd.clearanceRequired ?? null) as string | null;
    const itarRequired = (cd.itar_required ?? cd.itarRequired ?? null) as boolean | null;

    for (const topicId of topicIds) {
      // 1. Upsert solicitation_compliance for this topic
      // Check if a row exists for this topic
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM solicitation_compliance
        WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
      `;

      if (existing.length > 0) {
        await sql`
          UPDATE solicitation_compliance SET
            page_limit_technical = ${pageLimitTechnical},
            page_limit_cost = ${pageLimitCost},
            font_family = ${fontFamily},
            font_size = ${fontSize},
            margins = ${margins},
            line_spacing = ${lineSpacing},
            header_required = ${headerRequired ?? false},
            header_format = ${headerFormat},
            footer_required = ${footerRequired ?? false},
            footer_format = ${footerFormat},
            submission_format = ${submissionFormat},
            slides_allowed = ${slidesAllowed ?? false},
            slide_limit = ${slideLimit},
            taba_allowed = ${tabaAllowed},
            pi_must_be_employee = ${piMustBeEmployee},
            partner_max_pct = ${partnerMaxPct},
            clearance_required = ${clearanceRequired},
            itar_required = ${itarRequired ?? false},
            verified_by = ${user.id ?? null},
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
            ${pageLimitTechnical},
            ${pageLimitCost},
            ${fontFamily},
            ${fontSize},
            ${margins},
            ${lineSpacing},
            ${headerRequired ?? false},
            ${headerFormat},
            ${footerRequired ?? false},
            ${footerFormat},
            ${submissionFormat},
            ${slidesAllowed ?? false},
            ${slideLimit},
            ${tabaAllowed},
            ${piMustBeEmployee},
            ${partnerMaxPct},
            ${clearanceRequired},
            ${itarRequired ?? false},
            ${user.id ?? null},
            now()
          )
        `;
      }

      // 2. Remove existing topic-specific volumes and recreate from preset
      // First get existing topic volumes to clean up their items
      const existingVols = await sql<{ id: string }[]>`
        SELECT id FROM solicitation_volumes
        WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
      `;
      if (existingVols.length > 0) {
        const volIds = existingVols.map((v) => v.id);
        await sql`DELETE FROM volume_required_items WHERE volume_id = ANY(${volIds}::uuid[])`;
        await sql`DELETE FROM solicitation_volumes
          WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid`;
      }

      // 3. Create volumes + items from preset
      for (const vol of volumesData) {
        const [newVol] = await sql<{ id: string }[]>`
          INSERT INTO solicitation_volumes (
            solicitation_id, topic_id, volume_number, volume_name,
            volume_format, description, created_by
          ) VALUES (
            ${solId}::uuid, ${topicId}::uuid,
            ${vol.volume_number},
            ${vol.volume_name},
            ${vol.volume_format ?? null},
            ${vol.description ?? null},
            ${user.id ?? null}
          )
          RETURNING id
        `;

        if (vol.items && vol.items.length > 0) {
          for (let idx = 0; idx < vol.items.length; idx++) {
            const item = vol.items[idx];
            await sql`
              INSERT INTO volume_required_items (
                volume_id, item_number, item_name, item_type, required,
                page_limit, slide_limit, font_family, font_size,
                margins, line_spacing, header_format, footer_format
              ) VALUES (
                ${newVol.id}::uuid,
                ${idx + 1},
                ${item.item_name},
                ${item.item_type},
                ${item.required ?? true},
                ${item.page_limit ?? null},
                ${item.slide_limit ?? null},
                ${item.font_family ?? null},
                ${item.font_size ?? null},
                ${item.margins ?? null},
                ${item.line_spacing ?? null},
                ${item.header_format ?? null},
                ${item.footer_format ?? null}
              )
            `;
          }
        }
      }
    }

    await emitEventEnd(startId, {
      result: { applied: topicIds.length, topicIds },
    });

    return NextResponse.json({
      data: { applied: topicIds.length, topicIds },
    });
  } catch (err) {
    console.error('[apply-preset] apply failed:', err);
    await emitEventEnd(startId, { error: { message: err instanceof Error ? err.message : String(err), code: 'DB_ERROR' } });
    return NextResponse.json(
      { error: 'Failed to apply compliance preset', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
