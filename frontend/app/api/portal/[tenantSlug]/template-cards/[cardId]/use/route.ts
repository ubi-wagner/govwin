/**
 * POST /api/portal/[tenantSlug]/template-cards/[cardId]/use
 *
 * Instantiate a pristine template CARD (tenant_template_cards, mig 177) into a
 * working tenant_documents row — the "copy-create-add to workspace" step of the
 * template bridge (docs/TEMPLATE_BRIDGE_DESIGN.md Phase 2). The card is a
 * skeleton snapshot the tenant OWNS; instantiation clones its CanvasDocument into
 * a fresh, editable document. That new document is the artifact; the card stays
 * skeleton-only and can be used again.
 *
 * The card is NOT a document_templates row, so source_template_id (FK ->
 * document_templates) stays NULL — provenance is recorded in source_template_key.
 * Atomize-into-library fires later, on first EXPORT of the filled doc (the "on
 * download" trigger), not here — a blank skeleton would only pollute the library.
 *
 * Body: { title?: string }
 * Returns: { data: { documentId, title, docType } }
 * Auth: tenant_user+ with tenant access (RFP/master admin via shadow).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle, userActor } from '@/lib/events';
import { starterFromTemplate, countNodes, type TemplateRow } from '@/lib/documents/starter';
import type { TemplateSnapshot } from '@/lib/template-bridge';

interface RouteContext {
  params: Promise<{ tenantSlug: string; cardId: string }>;
}

// Master template FORMAT ('document'|'deck'|'spreadsheet') → tenant_documents.doc_type.
function docTypeForFormat(format: string): string {
  if (format === 'deck') return 'slide_deck';
  if (format === 'spreadsheet') return 'cost_volume';
  return 'custom';
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, cardId } = await ctx.params;
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
    if (!isValidUUID(cardId)) {
      return NextResponse.json({ error: 'Invalid card id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { title?: unknown };
    try { body = await request.json(); } catch { body = {}; }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : undefined;

    const documentId = crypto.randomUUID();
    const actorId = su.id;

    // Read the owned card (RLS-scoped), clone its canvas into a new document, and insert — all in one
    // tenant-scoped transaction so the card read and the doc write share the same app.tenant_id context.
    type CardRow = { templateKey: string; title: string; format: string; template: unknown };
    let result: { documentId: string; title: string; docType: string } | null = null;
    let notFound = false;
    let sourceTemplateKey: string | null = null;
    try {
      result = await withTenant<{ documentId: string; title: string; docType: string } | null>(tenantId, async (tx) => {
        // Explicit tenant predicate (belt) + RLS (suspenders): the app runs as `govtech_app` so
        // RLS scopes it; the tenant_id filter is defense-in-depth against instantiating another
        // tenant's card.
        const rows = await tx`
          SELECT template_key AS "templateKey", title, format, template
          FROM tenant_template_cards WHERE id = ${cardId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
        ` as CardRow[];
        const card = rows[0];
        if (!card) { notFound = true; return null; }
        sourceTemplateKey = card.templateKey;

        const snapshot = coerceJsonb<TemplateSnapshot | null>(card.template, null);
        const canvasDocument = snapshot?.canvasDocument ?? null;

        // Map the owned card into the shape starterFromTemplate consumes, then flatten its pristine
        // CanvasDocument into a fresh editable document (anchors carried literal — the tenant fills them).
        const tplRow: TemplateRow = {
          id: cardId,
          name: card.title,
          templateType: docTypeForFormat(card.format),
          canvasPreset: (canvasDocument as { canvas?: unknown } | null)?.canvas ?? null,
          canvasDocument,
          metadata: {},
        };
        const starter = starterFromTemplate(tplRow, { documentId, actorId, title });
        const nodeCount = countNodes(starter.canvas);

        const inserted = await tx`
          INSERT INTO tenant_documents
            (id, tenant_id, title, doc_type, canvas, source_template_id, source_template_key, node_count, version, created_by)
          VALUES (
            ${documentId}::uuid, ${tenantId}::uuid, ${starter.title}, ${starter.docType},
            ${tx.json(starter.canvas as unknown as Parameters<typeof tx.json>[0])},
            NULL, ${card.templateKey}, ${nodeCount}, 1, ${actorId}::uuid
          )
          RETURNING id
        ` as Array<{ id: string }>;
        if (!inserted[0]) return null;
        return { documentId: inserted[0].id, title: starter.title, docType: starter.docType };
      });
    } catch (e) {
      console.error('[portal/template-cards/use] instantiate failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (notFound || !result) {
      return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'document.created',
        actor: userActor(actorId, su.email ?? undefined),
        tenantId,
        payload: { documentId: result.documentId, title: result.title, docType: result.docType, sourceTemplateKey, via: 'template_card', cardId },
      });
    } catch (e) { console.error('[portal/template-cards/use] event emit failed (non-fatal):', e); }

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (e) {
    console.error('[portal/template-cards/use] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
