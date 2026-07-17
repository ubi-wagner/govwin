/**
 * Template Studio — document_templates library (E3b).
 *
 *   GET  /api/admin/templates            — list templates (lightweight; no bodies).
 *        ?templateType= &programType= &agency=  optional filters.
 *   POST /api/admin/templates            — create a template, or "save as new"
 *        from an existing one (sourceTemplateId). Body carries the canvas_preset
 *        (CanvasRules format spec) + canvas_document (full starter body).
 *
 * Auth: rfp_admin / master_admin. The create-route reads these (DB-first) when a
 * required item links a template_id (E3a).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';

const TEMPLATE_TYPES = [
  'technical_volume', 'cost_volume', 'slide_deck', 'past_performance',
  'key_personnel', 'commercialization', 'abstract', 'cover_sheet',
  'supporting_docs', 'custom',
] as const;

function authz(session: unknown): { userId: string } | null {
  const u = (session as { user?: { id?: string; role?: unknown } } | null)?.user;
  if (!u?.id) return null;
  const role = isRole(u.role) ? u.role : null;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) return null;
  return { userId: u.id };
}

export async function GET(request: Request) {
  try {
    const who = authz(await auth());
    if (!who) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(request.url);
    const templateType = url.searchParams.get('templateType');
    const programType = url.searchParams.get('programType');
    const agency = url.searchParams.get('agency');
    if (templateType && !(TEMPLATE_TYPES as readonly string[]).includes(templateType)) {
      return NextResponse.json({ error: 'Invalid templateType', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let templates;
    try {
      templates = await sql`
        SELECT id, name, description, template_type, agency, program_type,
               node_count, is_system, tenant_id, created_by, created_at, updated_at,
               storage_key, canvas_preset
        FROM document_templates
        WHERE (${templateType}::text IS NULL OR template_type = ${templateType})
          AND (${programType}::text IS NULL OR program_type = ${programType})
          AND (${agency}::text IS NULL OR agency = ${agency})
        ORDER BY is_system DESC, name ASC
      `;
    } catch (e) {
      console.error('[admin/templates] list query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { templates } });
  } catch (e) {
    console.error('[admin/templates] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const who = authz(await auth());
    if (!who) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const templateType = typeof body.templateType === 'string' ? body.templateType : 'custom';
    if (!(TEMPLATE_TYPES as readonly string[]).includes(templateType)) {
      return NextResponse.json(
        { error: `templateType must be one of: ${TEMPLATE_TYPES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const sourceTemplateId = typeof body.sourceTemplateId === 'string' ? body.sourceTemplateId : null;
    if (sourceTemplateId && !isValidUUID(sourceTemplateId)) {
      return NextResponse.json({ error: 'Invalid sourceTemplateId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // "Save as new": seed canvas_preset / canvas_document from the source, then
    // let the body override either.
    let baseCanvasPreset: unknown = {};
    let baseCanvasDocument: unknown = {};
    if (sourceTemplateId) {
      let src;
      try {
        [src] = await sql<{ canvasPreset: unknown; canvasDocument: unknown }[]>`
          SELECT canvas_preset, canvas_document FROM document_templates
          WHERE id = ${sourceTemplateId}::uuid LIMIT 1
        `;
      } catch (e) {
        console.error('[admin/templates] source lookup failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      if (!src) {
        return NextResponse.json({ error: 'Source template not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      baseCanvasPreset = src.canvasPreset ?? {};
      baseCanvasDocument = src.canvasDocument ?? {};
    }

    const canvasPreset = body.canvasPreset !== undefined ? body.canvasPreset : baseCanvasPreset;
    const canvasDocument = body.canvasDocument !== undefined ? body.canvasDocument : baseCanvasDocument;
    const nodeCount = Array.isArray((canvasDocument as { nodes?: unknown[] })?.nodes)
      ? (canvasDocument as { nodes: unknown[] }).nodes.length
      : 0;

    let created;
    try {
      [created] = await sql<{ id: string }[]>`
        INSERT INTO document_templates
          (name, description, template_type, agency, program_type,
           canvas_preset, canvas_document, node_count, is_system, created_by, metadata)
        VALUES (
          ${name},
          ${typeof body.description === 'string' ? body.description : null},
          ${templateType},
          ${typeof body.agency === 'string' ? body.agency : null},
          ${typeof body.programType === 'string' ? body.programType : null},
          ${sql.json(canvasPreset as Parameters<typeof sql.json>[0])},
          ${sql.json(canvasDocument as Parameters<typeof sql.json>[0])},
          ${nodeCount},
          false,
          ${who.userId}::uuid,
          '{}'::jsonb
        )
        RETURNING id
      `;
    } catch (e) {
      console.error('[admin/templates] insert failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { templateId: created.id } }, { status: 201 });
  } catch (e) {
    console.error('[admin/templates] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
