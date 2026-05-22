import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { resolveTemplateKey, getTemplate, interpolateTemplate } from '@/lib/templates';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
import { putObject, copyObject } from '@/lib/storage/s3-client';
import { customerProposalPath } from '@/lib/storage/paths';
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
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'tenant_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = sessionUser.id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(userId, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Stripe gate — founding cohort bypass
    // When Stripe is live, check for a valid purchase or active subscription
    // before allowing proposal creation. For now, all tenant_admins can create.
    const FOUNDING_COHORT_BYPASS = process.env.FOUNDING_COHORT_BYPASS === 'true';
    if (!FOUNDING_COHORT_BYPASS) {
      return NextResponse.json(
        { error: 'Active subscription required to create proposals', code: 'PAYMENT_REQUIRED' },
        { status: 402 },
      );
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { topicId?: unknown; productType?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const topicId = body.topicId;
    if (typeof topicId !== 'string' || !topicId.trim()) {
      return NextResponse.json({ error: 'topicId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
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
      return NextResponse.json({ error: 'Topic not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (!topic.solicitationId) {
      return NextResponse.json(
        { error: 'Topic has no linked solicitation', code: 'VALIDATION_ERROR' },
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
        { error: 'Proposal already exists for this topic', code: 'VALIDATION_ERROR' },
        { status: 409 },
      );
    }

    // ── Start event for multi-step proposal creation ──────────────────
    const eventId = await emitEventStart({
      namespace: 'proposal',
      type: 'proposal.created',
      actor: userActor(userId, sessionUser.email),
      tenantId,
      payload: {
        tenantId,
        tenantSlug,
        topicId,
        solicitationId: topic.solicitationId,
        productType: productType ?? undefined,
      },
    });

    // ── Create the proposal + sections in a transaction ─────────────
    const proposalTitle = topic.topicNumber
      ? `${topic.topicNumber}: ${topic.title}`
      : topic.title;

    // ── Resolve compliance + volumes via topic -> solicitation -> defaults chain ─
    const resolved = await resolveTopicCompliance(topicId);

    // Flatten resolved volumes into a requiredItems list for section creation.
    // Each item gets a synthetic section number based on volume + item ordering.
    const requiredItems: Array<{
      itemNumber: number;
      itemName: string;
      itemType: string;
      pageLimit: number | null;
    }> = [];

    let globalItemIndex = 0;
    for (const vol of resolved.volumes) {
      for (const item of vol.items) {
        globalItemIndex++;
        requiredItems.push({
          itemNumber: globalItemIndex,
          itemName: item.itemName as string,
          itemType: item.itemType as string,
          pageLimit: (item.pageLimit as number) ?? null,
        });
      }
    }

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

    const { proposal, sectionCount } = await sql.begin(async (tx: any) => {
      const [proposalRow] = await tx<{ id: string }[]>`
        INSERT INTO proposals (tenant_id, opportunity_id, solicitation_id, title, stage)
        VALUES (
          ${tenantId},
          ${topicId},
          ${topic.solicitationId},
          ${proposalTitle},
          'draft'
        )
        RETURNING id
      `;

      let count = 0;

      if (requiredItems.length > 0) {
        const programType = topic.programType ?? '';

        for (const item of requiredItems) {
          // Insert the section row first to get its id
          const [section] = await tx<{ id: string }[]>`
            INSERT INTO proposal_sections (
              proposal_id, section_number, title, content, status, page_allocation
            ) VALUES (
              ${proposalRow.id},
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
              templateDoc.metadata.proposal_id = proposalRow.id;
              templateDoc.metadata.solicitation_id = topic.solicitationId ?? '';
              templateDoc.metadata.created_at = new Date().toISOString();
              templateDoc.metadata.last_modified_at = new Date().toISOString();
              templateDoc.metadata.last_modified_by = userId;
              templateDoc.document_id = section.id;

              // Interpolate merge fields with available data
              const interpolated = interpolateTemplate(templateDoc, templateVariables);

              // Store the canvas document JSON and update status to reflect template content
              const contentJson = JSON.stringify(interpolated);
              await tx`
                UPDATE proposal_sections
                SET content = ${contentJson},
                    status = 'ai_drafted'
                WHERE id = ${section.id}
              `;
            }
          }

          count++;
        }
      } else {
        // No required items defined — create a single default section
        await tx`
          INSERT INTO proposal_sections (
            proposal_id, section_number, title, content, status
          ) VALUES (
            ${proposalRow.id},
            '1',
            'Technical Volume',
            ${null},
            'empty'
          )
        `;
        count = 1;
      }

      return { proposal: proposalRow, sectionCount: count };
    });

    // ── Provision S3 artifacts (non-blocking — failure is logged, not fatal) ─
    let docsCopied = 0;
    try {
      // 1. Freeze compliance snapshot
      const complianceSnapshot = JSON.stringify(resolved.compliance, null, 2);
      await putObject({
        key: customerProposalPath(tenantSlug, proposal.id, 'compliance.json'),
        body: Buffer.from(complianceSnapshot),
        contentType: 'application/json',
        metadata: { 'snapshot-type': 'compliance', 'source-solicitation': topic.solicitationId ?? '' },
      });

      // 2. Save volumes structure
      const volumesSnapshot = JSON.stringify(resolved.volumes, null, 2);
      await putObject({
        key: customerProposalPath(tenantSlug, proposal.id, 'volumes.json'),
        body: Buffer.from(volumesSnapshot),
        contentType: 'application/json',
      });

      // 3. Copy RFP documents to customer sandbox
      const solDocs = await sql<{
        id: string;
        storageKey: string;
        originalFilename: string;
        documentType: string;
        isPrimary: boolean;
      }[]>`
        SELECT id, storage_key, original_filename, document_type, is_primary
        FROM solicitation_documents
        WHERE solicitation_id = ${topic.solicitationId}::uuid
        ORDER BY is_primary DESC, created_at ASC
      `;

      for (const doc of solDocs) {
        try {
          await copyObject({
            sourceKey: doc.storageKey,
            destKey: customerProposalPath(tenantSlug, proposal.id, `rfp/${doc.originalFilename}`),
          });
          docsCopied++;
        } catch (copyErr) {
          console.error('[api/portal/proposals/create] rfp doc copy failed', {
            docId: doc.id,
            sourceKey: doc.storageKey,
            err: copyErr instanceof Error ? copyErr.message : String(copyErr),
          });
        }
      }

      // 4. Save topic metadata snapshot
      const topicSnapshot = JSON.stringify({
        topicNumber: topic.topicNumber,
        title: topic.title,
        agency: topic.agency,
        programType: topic.programType,
        solicitationNumber: topic.solicitationNumber,
        snapshotAt: new Date().toISOString(),
      }, null, 2);
      await putObject({
        key: customerProposalPath(tenantSlug, proposal.id, 'topic.json'),
        body: Buffer.from(topicSnapshot),
        contentType: 'application/json',
      });
    } catch (artifactErr) {
      // Artifact provisioning is enrichment — DB rows are the critical path.
      // Log the warning but do not fail the proposal creation.
      console.error('[api/portal/proposals/create] artifact provisioning warning', {
        proposalId: proposal.id,
        err: artifactErr instanceof Error ? artifactErr.message : String(artifactErr),
      });
    }

    // ── End event ─────────────────────────────────────────────────────
    await emitEventEnd(eventId, {
      result: {
        tenantId,
        tenantSlug,
        proposalId: proposal.id,
        sectionCount,
        title: proposalTitle,
        artifactsProvisioned: {
          compliance: true,
          volumes: true,
          rfpDocuments: docsCopied,
          topicMetadata: true,
        },
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
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
