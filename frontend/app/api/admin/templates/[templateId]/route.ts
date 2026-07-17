/**
 * Template Studio — single template (E3b).
 *
 *   GET   /api/admin/templates/[templateId]  — full template incl. canvas_preset
 *         + canvas_document (the starter body).
 *   PATCH /api/admin/templates/[templateId]  — edit a non-system template
 *         (name/description/type/agency/program_type/canvas_preset/canvas_document).
 *         System templates are read-only — "save as new" via POST instead.
 *
 * Auth: rfp_admin / master_admin.
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

interface Ctx { params: Promise<{ templateId: string }> }

function authz(session: unknown): boolean {
  const u = (session as { user?: { id?: string; role?: unknown } } | null)?.user;
  if (!u?.id) return false;
  const role = isRole(u.role) ? u.role : null;
  return !!role && hasRoleAtLeast(role, 'rfp_admin');
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    if (!authz(await auth())) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { templateId } = await ctx.params;
    if (!isValidUUID(templateId)) {
      return NextResponse.json({ error: 'Invalid templateId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let tpl;
    try {
      [tpl] = await sql`
        SELECT id, name, description, template_type, agency, program_type,
               canvas_preset, canvas_document, node_count, is_system,
               tenant_id, created_by, created_at, updated_at
        FROM document_templates WHERE id = ${templateId}::uuid LIMIT 1
      `;
    } catch (e) {
      console.error('[admin/templates/:id] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!tpl) {
      return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ data: { template: tpl } });
  } catch (e) {
    console.error('[admin/templates/:id] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    if (!authz(await auth())) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { templateId } = await ctx.params;
    if (!isValidUUID(templateId)) {
      return NextResponse.json({ error: 'Invalid templateId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (typeof body.templateType === 'string' && !(TEMPLATE_TYPES as readonly string[]).includes(body.templateType)) {
      return NextResponse.json({ error: 'Invalid templateType', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let existing;
    try {
      [existing] = await sql<{ id: string; isSystem: boolean }[]>`
        SELECT id, is_system FROM document_templates WHERE id = ${templateId}::uuid LIMIT 1
      `;
    } catch (e) {
      console.error('[admin/templates/:id] existence check failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        { error: 'System templates are read-only — use "save as new" instead', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // COALESCE-style partial update: only provided fields change. node_count is
    // recomputed when canvas_document is supplied.
    const nameVal = typeof body.name === 'string' ? body.name.trim() : null;
    const descVal = typeof body.description === 'string' ? body.description : null;
    const typeVal = typeof body.templateType === 'string' ? body.templateType : null;
    const agencyVal = typeof body.agency === 'string' ? body.agency : null;
    const programVal = typeof body.programType === 'string' ? body.programType : null;
    // sql.json (not JSON.stringify::jsonb, which round-trips as a STRING) — null
    // when the field is omitted, so the COALESCE below preserves the existing value.
    const presetParam =
      body.canvasPreset !== undefined ? sql.json(body.canvasPreset as Parameters<typeof sql.json>[0]) : null;
    const docParam =
      body.canvasDocument !== undefined ? sql.json(body.canvasDocument as Parameters<typeof sql.json>[0]) : null;
    const nodeCount = body.canvasDocument !== undefined && Array.isArray((body.canvasDocument as { nodes?: unknown[] })?.nodes)
      ? (body.canvasDocument as { nodes: unknown[] }).nodes.length
      : null;

    try {
      await sql`
        UPDATE document_templates SET
          name            = COALESCE(${nameVal}, name),
          description     = COALESCE(${descVal}, description),
          template_type   = COALESCE(${typeVal}, template_type),
          agency          = COALESCE(${agencyVal}, agency),
          program_type    = COALESCE(${programVal}, program_type),
          canvas_preset   = COALESCE(${presetParam}::jsonb, canvas_preset),
          canvas_document = COALESCE(${docParam}::jsonb, canvas_document),
          node_count      = COALESCE(${nodeCount}, node_count),
          updated_at      = now()
        WHERE id = ${templateId}::uuid
      `;
    } catch (e) {
      console.error('[admin/templates/:id] update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { templateId, updated: true } });
  } catch (e) {
    console.error('[admin/templates/:id] PATCH failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/templates/[templateId] — remove a non-system template.
 * Unlinks any required-items that pointed at it (they fall back to the registry).
 */
export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    if (!authz(await auth())) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { templateId } = await ctx.params;
    if (!isValidUUID(templateId)) {
      return NextResponse.json({ error: 'Invalid templateId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let existing;
    try {
      [existing] = await sql<{ id: string; is_system: boolean }[]>`
        SELECT id, is_system FROM document_templates WHERE id = ${templateId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[admin/templates/:id] DELETE existence check failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
    if (existing.is_system) return NextResponse.json({ error: 'System templates cannot be deleted', code: 'FORBIDDEN' }, { status: 403 });
    try {
      await sql`UPDATE volume_required_items SET template_id = NULL WHERE template_id = ${templateId}::uuid`;
      await sql`DELETE FROM document_templates WHERE id = ${templateId}::uuid AND is_system = false`;
    } catch (e) {
      console.error('[admin/templates/:id] delete failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { deleted: true } });
  } catch (e) {
    console.error('[admin/templates/:id] DELETE failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
