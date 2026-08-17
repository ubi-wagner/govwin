/**
 * POST /api/portal/[tenantSlug]/documents
 *
 * Quick-create a standalone document (Tier 2, #3) — the founder's "quick document
 * creation from template and library … a super simple 1-page flier or the whole
 * proposal." Starts EITHER from a `document_templates` skeleton (`templateId`,
 * the tenant's own or a system template) OR from a blank preset
 * (`preset` ∈ flier|letter|deck|sheet), persists a `tenant_documents` row, and
 * returns its id so the client opens the canvas editor.
 *
 * Body: { templateId?: uuid, preset?: BlankPreset, title?: string }
 * Returns: { data: { documentId, title, docType } }
 *
 * Auth: tenant_user+ with tenant access (RFP/master admin via shadow).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { duplicatePastProposalAtoms } from '@/lib/documents/duplicate-past-proposal';
import {
  starterFromPreset, starterFromTemplate, isBlankPreset, countNodes,
  type TemplateRow,
} from '@/lib/documents/starter';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS: own-template lookup + tenant_documents INSERT are RLS-forced — without
    // the context the templateId lookup 404s and the INSERT throws an RLS-violation under govtech_app.

    let body: { templateId?: unknown; preset?: unknown; title?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : undefined;
    // Pre-generate the id so the starter can key the canvas' document_id to the row.
    const documentId = crypto.randomUUID();

    let starter;
    let sourceTemplateId: string | null = null;

    if (body.templateId !== undefined && body.templateId !== null && body.templateId !== '') {
      if (typeof body.templateId !== 'string' || !isValidUUID(body.templateId)) {
        return NextResponse.json({ error: 'Invalid templateId', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      let tpl: TemplateRow | undefined;
      try {
        // Phase 5 (template bridge): only the tenant's OWN saved templates — the shared is_system read is
        // RETIRED (the pristine stable instantiates through the owned template-card gallery,
        // /template-cards/[id]/use). Never another tenant's skeleton, never a shared system row.
        [tpl] = await sql<TemplateRow[]>`
          SELECT id, name, template_type, canvas_preset, canvas_document, metadata
          FROM document_templates
          WHERE id = ${body.templateId}::uuid
            AND tenant_id = ${tenantId}::uuid AND is_system = false
          LIMIT 1
        `;
      } catch (e) {
        console.error('[portal/documents] template lookup failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      if (!tpl) {
        return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      starter = starterFromTemplate(tpl, { documentId, actorId: su.id, title });
      sourceTemplateId = tpl.id;
    } else if (isBlankPreset(body.preset)) {
      starter = starterFromPreset(body.preset, { documentId, actorId: su.id, title });
    } else {
      return NextResponse.json(
        { error: 'Provide a templateId or a preset (flier | letter | deck | sheet)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const nodeCount = countNodes(starter.canvas);

    let created: { id: string } | undefined;
    try {
      [created] = await sql<{ id: string }[]>`
        INSERT INTO tenant_documents
          (id, tenant_id, title, doc_type, canvas, source_template_id, node_count, version, created_by)
        VALUES (
          ${documentId}::uuid,
          ${tenantId}::uuid,
          ${starter.title},
          ${starter.docType},
          ${sql.json(starter.canvas as unknown as Parameters<typeof sql.json>[0])},
          ${sourceTemplateId}::uuid,
          ${nodeCount},
          1,
          ${su.id}::uuid
        )
        RETURNING id
      `;
    } catch (e) {
      console.error('[portal/documents] insert failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'document.created',
        actor: userActor(su.id, su.email ?? undefined),
        tenantId,
        payload: { documentId: created!.id, title: starter.title, docType: starter.docType, sourceTemplateId },
      });
    } catch (e) { console.error('[portal/documents] event emit failed (non-fatal):', e); }

    // Branch-and-promote (#18): when regenerating from a template templified from a past
    // proposal, copy the seminal atoms into WORKING draft copies bound to this document,
    // each with derived_from lineage to its seminal atom (mutated/collaborated until full
    // lock promotes them to foundation). Best-effort — never fail document creation.
    let regenerated: { copiedAtoms: number } | null = null;
    if (sourceTemplateId) {
      try {
        const actorKind = hasRoleAtLeast(role, 'tenant_admin') ? 'admin' : 'collaborator';
        const dup = await duplicatePastProposalAtoms(tenantId, created!.id, sourceTemplateId, { id: su.id, kind: actorKind });
        if (dup && dup.copied > 0) {
          regenerated = { copiedAtoms: dup.copied };
          try {
            await emitEventSingle({
              namespace: 'library',
              type: 'document.regenerated',
              actor: userActor(su.id, su.email ?? undefined),
              tenantId,
              payload: { documentId: created!.id, seminalCocoonId: dup.seminalCocoonId, copiedAtoms: dup.copied },
            });
          } catch (e) { console.error('[portal/documents] regenerated event emit failed (non-fatal):', e); }
        }
      } catch (e) { console.error('[portal/documents] past-proposal duplicate failed (non-fatal):', e); }
    }

    return NextResponse.json(
      { data: { documentId: created!.id, title: starter.title, docType: starter.docType, ...(regenerated ? { regenerated } : {}) } },
      { status: 201 },
    );
  } catch (e) {
    console.error('[portal/documents] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
