import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { resolveTemplateKey, getTemplate, interpolateTemplate } from '@/lib/templates';
import type { CanvasDocument } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/create
 *
 * Creates a new proposal for a given topic (opportunity). Admin-granted
 * for the founding cohort — no Stripe required.
 *
 * Input:  { topicId: string, productType?: 'proposal_phase1' | 'proposal_phase2' }
 *         (topicId is opportunities.id — the topic row)
 * Output: { data: { proposalId: string, sectionCount: number } }
 *
 * Steps:
 *   1. Auth + tenant access check (tenant_admin or above)
 *   2. Validate topicId exists and get its solicitation_id
 *   3. Check for duplicate proposals (same tenant + opportunity)
 *   4. Create the proposals row
 *   5. Find the solicitation's volume_required_items (filtered by phase if productType set)
 *   6. Create proposal_sections from required items
 *   7. Emit capture.proposal.created event
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'tenant_admin role required' }, { status: 403 });
    }

    const userId = sessionUser.id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session' }, { status: 401 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(userId, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied' }, { status: 403 });
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { topicId?: unknown; productType?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const topicId = body.topicId;
    if (typeof topicId !== 'string' || !topicId.trim()) {
      return NextResponse.json({ error: 'topicId is required' }, { status: 400 });
    }

    const validProductTypes = ['proposal_phase1', 'proposal_phase2'] as const;
    const productType = typeof body.productType === 'string' &&
      (validProductTypes as readonly string[]).includes(body.productType)
      ? body.productType
      : null;

    // ── Find the topic (opportunity) and its parent solicitation ─────
    const [topic] = await sql<{
      id: string;
      title: string;
      solicitationId: string | null;
      agency: string | null;
      topicNumber: string | null;
      programType: string | null;
      solicitationNumber: string | null;
    }[]>`
      SELECT id, title, solicitation_id, agency, topic_number,
             program_type, solicitation_number
      FROM opportunities
      WHERE id = ${topicId}
    `;

    if (!topic) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    if (!topic.solicitationId) {
      return NextResponse.json(
        { error: 'Topic has no linked solicitation' },
        { status: 422 },
      );
    }

    // ── Prevent duplicate proposals for same tenant + topic ──────────
    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE tenant_id = ${tenantId}
        AND opportunity_id = ${topicId}
      LIMIT 1
    `;
    if (existing) {
      return NextResponse.json(
        { error: 'Proposal already exists for this topic' },
        { status: 409 },
      );
    }

    // ── Create the proposal ──────────────────────────────────────────
    const proposalTitle = topic.topicNumber
      ? `${topic.topicNumber}: ${topic.title}`
      : topic.title;

    const [proposal] = await sql<{ id: string }[]>`
      INSERT INTO proposals (tenant_id, opportunity_id, solicitation_id, title, stage)
      VALUES (
        ${tenantId},
        ${topicId},
        ${topic.solicitationId},
        ${proposalTitle},
        'outline'
      )
      RETURNING id
    `;

    // ── Find required items from the solicitation's volumes ──────────
    // When productType is set, map to phase filter for applies_to_phase
    const phaseFilter = productType === 'proposal_phase1'
      ? 'phase_1'
      : productType === 'proposal_phase2'
        ? 'phase_2'
        : null;

    const requiredItems = phaseFilter
      ? await sql<{
          id: string;
          itemNumber: number;
          itemName: string;
          itemType: string;
          volumeId: string;
          pageLimit: number | null;
        }[]>`
          SELECT vri.id, vri.item_number, vri.item_name, vri.item_type,
                 vri.volume_id, vri.page_limit
          FROM volume_required_items vri
          JOIN solicitation_volumes sv ON sv.id = vri.volume_id
          WHERE sv.solicitation_id = ${topic.solicitationId}
            AND (sv.applies_to_phase IS NULL OR sv.applies_to_phase = '{}' OR ${phaseFilter} = ANY(sv.applies_to_phase))
            AND (vri.applies_to_phase IS NULL OR vri.applies_to_phase = '{}' OR ${phaseFilter} = ANY(vri.applies_to_phase))
          ORDER BY sv.volume_number ASC, vri.item_number ASC
        `
      : await sql<{
          id: string;
          itemNumber: number;
          itemName: string;
          itemType: string;
          volumeId: string;
          pageLimit: number | null;
        }[]>`
          SELECT vri.id, vri.item_number, vri.item_name, vri.item_type,
                 vri.volume_id, vri.page_limit
          FROM volume_required_items vri
          JOIN solicitation_volumes sv ON sv.id = vri.volume_id
          WHERE sv.solicitation_id = ${topic.solicitationId}
          ORDER BY sv.volume_number ASC, vri.item_number ASC
        `;

    // ── Create proposal_sections from required items ─────────────────
    // Build merge-field variables for template interpolation
    const tenantName = (tenant.name as string) ?? '';
    const templateVariables: Record<string, string> = {
      company_name: tenantName,
      topic_number: topic.topicNumber ?? '',
      topic_title: topic.title,
      solicitation_number: topic.solicitationNumber ?? '',
      pi_name: '{pi_name}',
      pi_email: '{pi_email}',
      cage_code: '{cage_code}',
      uei: '{uei}',
    };

    let sectionCount = 0;

    if (requiredItems.length > 0) {
      const programType = topic.programType ?? '';

      for (const item of requiredItems) {
        // Insert the section row first to get its id
        const [section] = await sql<{ id: string }[]>`
          INSERT INTO proposal_sections (
            proposal_id, section_number, title, content, status, page_allocation
          ) VALUES (
            ${proposal.id},
            ${String(item.itemNumber)},
            ${item.itemName},
            ${null},
            'empty',
            ${item.pageLimit}
          )
          RETURNING id
        `;

        // Attempt to resolve and apply a template for this section
        const templateKey = resolveTemplateKey(programType, item.itemType);
        if (templateKey) {
          const templateDoc: CanvasDocument | null = getTemplate(templateKey);
          if (templateDoc) {
            // Set metadata IDs linking this document to the proposal structure
            templateDoc.metadata.proposal_id = proposal.id;
            templateDoc.metadata.solicitation_id = topic.solicitationId ?? '';
            templateDoc.metadata.volume_id = item.volumeId;
            templateDoc.metadata.required_item_id = item.id;
            templateDoc.metadata.created_at = new Date().toISOString();
            templateDoc.metadata.last_modified_at = new Date().toISOString();
            templateDoc.metadata.last_modified_by = userId;
            templateDoc.document_id = section.id;

            // Interpolate merge fields with available data
            const interpolated = interpolateTemplate(templateDoc, templateVariables);

            // Store the canvas document JSON and update status to reflect template content
            const contentJson = JSON.stringify(interpolated);
            await sql`
              UPDATE proposal_sections
              SET content = ${contentJson},
                  status = 'ai_drafted'
              WHERE id = ${section.id}
            `;
          }
        }

        sectionCount++;
      }
    } else {
      // No required items defined — create a single default section
      await sql`
        INSERT INTO proposal_sections (
          proposal_id, section_number, title, content, status
        ) VALUES (
          ${proposal.id},
          '1',
          'Technical Volume',
          ${null},
          'empty'
        )
      `;
      sectionCount = 1;
    }

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.created',
      actor: userActor(userId, sessionUser.email),
      tenantId,
      payload: {
        proposalId: proposal.id,
        topicId,
        solicitationId: topic.solicitationId,
        sectionCount,
        title: proposalTitle,
        productType: productType ?? undefined,
      },
    });

    return NextResponse.json({
      data: {
        proposalId: proposal.id,
        sectionCount,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/create] error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
