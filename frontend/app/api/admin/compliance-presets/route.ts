/**
 * GET + POST /api/admin/compliance-presets
 *
 * GET:  List all compliance presets (system + user-created).
 * POST: Create a custom preset from a topic's current compliance + volumes.
 *
 * Returns: { data: { presets: [...] } }  or  { data: { id: string } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';
import type { Role } from '@/lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
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

  try {
    const rows = await sql<{
      id: string;
      name: string;
      phaseType: string;
      agency: string | null;
      programType: string | null;
      complianceData: Record<string, unknown>;
      volumesData: unknown[];
      isSystem: boolean;
      createdAt: Date;
    }[]>`
      SELECT id, name, phase_type, agency, program_type,
             compliance_data, volumes_data, is_system, created_at
      FROM compliance_presets
      ORDER BY is_system DESC, name ASC
    `;

    return NextResponse.json({
      data: {
        presets: rows.map((r) => ({
          id: r.id,
          name: r.name,
          phaseType: r.phaseType,
          agency: r.agency,
          programType: r.programType,
          complianceData: r.complianceData,
          volumesData: r.volumesData,
          isSystem: r.isSystem,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    });
  } catch (err) {
    console.error('[compliance-presets] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch compliance presets', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  // ── Input validation ────────────────────────────────────────────
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json(
      { error: 'name is required', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }
  if (!body.phaseType || typeof body.phaseType !== 'string') {
    return NextResponse.json(
      { error: 'phaseType is required', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  // If sourceTopicId is given, pull compliance + volumes from that topic
  let complianceData = body.complianceData ?? {};
  let volumesData = body.volumesData ?? [];

  if (body.sourceTopicId && typeof body.sourceTopicId === 'string') {
    if (!UUID_RE.test(body.sourceTopicId)) {
      return NextResponse.json(
        { error: 'Invalid sourceTopicId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    try {
      // Pull compliance from topic
      const compRows = await sql<Record<string, unknown>[]>`
        SELECT * FROM solicitation_compliance
        WHERE topic_id = ${body.sourceTopicId}::uuid
        LIMIT 1
      `;
      if (compRows.length > 0) {
        const c = compRows[0];
        complianceData = {
          page_limit_technical: c.pageLimitTechnical,
          page_limit_cost: c.pageLimitCost,
          font_family: c.fontFamily,
          font_size: c.fontSize,
          margins: c.margins,
          line_spacing: c.lineSpacing,
          header_required: c.headerRequired,
          header_format: c.headerFormat,
          footer_required: c.footerRequired,
          footer_format: c.footerFormat,
          submission_format: c.submissionFormat,
          slides_allowed: c.slidesAllowed,
          slide_limit: c.slideLimit,
          taba_allowed: c.tabaAllowed,
          pi_must_be_employee: c.piMustBeEmployee,
          partner_max_pct: c.partnerMaxPct,
          clearance_required: c.clearanceRequired,
          itar_required: c.itarRequired,
        };
      }

      // Pull volumes from the topic's solicitation scoped to the topic
      const volRows = await sql<{
        volumeName: string;
        volumeNumber: number;
        volumeFormat: string | null;
        description: string | null;
        items: unknown[];
      }[]>`
        SELECT
          v.volume_name, v.volume_number, v.volume_format, v.description,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'item_name', i.item_name,
              'item_type', i.item_type,
              'page_limit', i.page_limit,
              'slide_limit', i.slide_limit,
              'required', i.required
            ) ORDER BY i.item_number)
            FROM volume_required_items i WHERE i.volume_id = v.id),
            '[]'::json
          ) AS items
        FROM solicitation_volumes v
        WHERE v.topic_id = ${body.sourceTopicId}::uuid
        ORDER BY v.volume_number
      `;
      if (volRows.length > 0) {
        volumesData = volRows.map((v) => ({
          volume_name: v.volumeName,
          volume_number: v.volumeNumber,
          items: v.items,
        }));
      }
    } catch (err) {
      console.error('[compliance-presets] source topic lookup failed:', err);
      return NextResponse.json(
        { error: 'Failed to load source topic data', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  }

  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO compliance_presets (
        name, phase_type, agency, program_type,
        compliance_data, volumes_data, is_system, created_by
      ) VALUES (
        ${body.name},
        ${body.phaseType},
        ${(body.agency as string) ?? null},
        ${(body.programType as string) ?? null},
        ${sql.json(complianceData as Parameters<typeof sql.json>[0])},
        ${sql.json(volumesData as Parameters<typeof sql.json>[0])},
        false,
        ${user.id ?? null}
      )
      RETURNING id
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'compliance_preset.created',
      actor: { type: 'user', id: user.id ?? 'unknown' },
      tenantId: null,
      payload: { correlationId: randomUUID(), presetId: row.id, name: body.name as string },
    });

    return NextResponse.json({ data: { id: row.id } }, { status: 201 });
  } catch (err) {
    console.error('[compliance-presets] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to create compliance preset', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
