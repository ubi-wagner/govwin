import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { resolveTemplateKey, getTemplate, interpolateTemplate } from '@/lib/templates';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
import { inferSectionType, type SectionStandard } from '@/lib/section-standards';
import { putObject, copyObject } from '@/lib/storage/s3-client';
import { customerProposalPath } from '@/lib/storage/paths';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { buildArtifactSpecs } from '@/lib/artifact-spec';
import { isValidUUID } from '@/lib/validation';
import { launchProjectCollaboration } from '@/lib/process/project-collaboration';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * Turn a required item into one or more compliance-matrix requirement labels.
 * If the item enumerates required_sections (shall-statements / named subsections)
 * each becomes its own requirement; otherwise the item itself is the requirement.
 */
function requirementLabels(itemName: string, requiredSections: unknown): string[] {
  const subs = Array.isArray(requiredSections)
    ? requiredSections
        .map((s) =>
          typeof s === 'string'
            ? s
            : (s as { name?: string; label?: string; text?: string } | null)?.name ??
              (s as { label?: string } | null)?.label ??
              (s as { text?: string } | null)?.text ??
              null,
        )
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  return subs.length > 0 ? subs.map((s) => `${itemName} — ${s}`) : [itemName];
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

    // Stripe gate — founding cohort.
    // V1: proposal creation is admin-granted (no Stripe). The paywall is OFF by
    // default so the founding cohort can convert opportunities → workspaces;
    // set FOUNDING_COHORT_BYPASS=false to require a purchase/subscription once
    // billing is live. (When enforced, this is where the purchase/subscription
    // check belongs.)
    const paywallEnforced = process.env.FOUNDING_COHORT_BYPASS === 'false';
    if (paywallEnforced) {
      return NextResponse.json(
        { error: 'Active subscription required to create proposals', code: 'PAYMENT_REQUIRED' },
        { status: 402 },
      );
    }

    // ── Input validation ─────────────────────────────────────────────
    const DB_STAGES = ['draft', 'review', 'final', 'submitted', 'archived'] as const;

    let body: { topicId?: unknown; productType?: unknown; gateConfig?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const topicId = body.topicId;
    if (typeof topicId !== 'string' || !topicId.trim()) {
      return NextResponse.json({ error: 'topicId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (!isValidUUID(topicId)) {
      return NextResponse.json({ error: 'Invalid topicId format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const validProductTypes = ['proposal_phase1', 'proposal_phase2'] as const;
    const productType = typeof body.productType === 'string' &&
      (validProductTypes as readonly string[]).includes(body.productType)
      ? body.productType
      : null;

    // Validate gate_config if provided, otherwise default to ['draft', 'final']
    let gateConfig: string[] = ['draft', 'final'];
    if (Array.isArray(body.gateConfig) && body.gateConfig.length >= 2) {
      const allValid = body.gateConfig.every(
        (s: unknown) => typeof s === 'string' && (DB_STAGES as readonly string[]).includes(s),
      );
      if (!allValid) {
        return NextResponse.json(
          { error: `gate_config values must be from: ${DB_STAGES.join(', ')}`, code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      gateConfig = body.gateConfig as string[];
    }

    // ── Find the topic (opportunity) and its parent solicitation ─────
    let topic: {
      id: string;
      title: string;
      solicitationId: string | null;
      agency: string | null;
      topicNumber: string | null;
      programType: string | null;
      solicitationNumber: string | null;
    } | undefined;
    try {
      [topic] = await sql<{
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
    } catch (dbErr) {
      console.error('[api/portal/proposals/create] topic query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

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
    let existing: { id: string } | undefined;
    try {
      [existing] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE tenant_id = ${tenantId}
          AND opportunity_id = ${topicId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/create] duplicate check failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
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
      volumeName: string | null;
      volumeNumber: number | null;
      templateId: string | null;
      expertNotes: string | null;
      requiredSections: unknown;
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
          volumeName: (vol.volumeName as string) ?? null,
          volumeNumber: (vol.volumeNumber as number) ?? null,
          templateId: (item.templateId as string) ?? null,
          expertNotes: (item.expertNotes as string) ?? null,
          requiredSections: (item as { requiredSections?: unknown }).requiredSections ?? null,
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

    // Load active section standards once to tag each section against the
    // taxonomy (C1). Best-effort — pre-migration or empty just leaves sections
    // untagged (section_type = null).
    let sectionStandards: SectionStandard[] = [];
    try {
      sectionStandards = await sql<SectionStandard[]>`
        SELECT key, label FROM section_standards WHERE is_active = true
      `;
    } catch (stdErr) {
      console.error('[api/portal/proposals/create] section_standards load failed (non-fatal):', stdErr);
    }

    // ── R0.3: resolve the source spotlight bucket for the IMMUTABLE origin card ─
    // Best-effort — an admin-granted opportunity that was never spotlighted simply
    // has no bucket (source_bucket stays null). Read before the txn so the freeze
    // is atomic in the INSERT (no post-insert UPDATE window).
    let topBucket: { bucket: string; score: number } | null = null;
    try {
      // Greenfield spine: read the card's best bucket score from tenant_bucket_scores
      // (auto-populated on fan-out), joined to the bucket for its name — not the
      // legacy spotlight_bucket_scores, which the new spine never writes.
      const [b] = await sql<{ bucket: string; score: number }[]>`
        SELECT tsb.name AS bucket, s.score
        FROM tenant_bucket_scores s
        JOIN tenant_spotlight_buckets tsb ON tsb.id = s.bucket_id
        WHERE s.tenant_id = ${tenantId}::uuid AND s.opportunity_id = ${topicId}::uuid
        ORDER BY s.score DESC NULLS LAST
        LIMIT 1
      `;
      topBucket = b ?? null;
    } catch (bucketErr) {
      console.error('[api/portal/proposals/create] source bucket lookup failed (non-fatal):', bucketErr);
    }

    // The IMMUTABLE origin layer of the card: the L0 opportunity summary + the L1
    // source bucket, frozen at purchase so a later master edit / close / amendment
    // never rewrites the project's audit. Compliance is deliberately NOT frozen
    // here — it renders LIVE from the matrix (an amendment must raise the live
    // burden; freezing it would understate it — mig 089 / 3-factor review flaw #7).
    const originCard = {
      opportunity: {
        id: topicId,
        title: topic.title,
        agency: topic.agency,
        programType: topic.programType,
        topicNumber: topic.topicNumber,
        solicitationNumber: topic.solicitationNumber,
      },
      bucket: topBucket ? { key: topBucket.bucket, score: topBucket.score } : null,
      frozenAt: new Date().toISOString(),
    };

    const { proposal, sectionCount, artifacts } = await sql.begin(async (tx: any) => {
      const [proposalRow] = await tx<{ id: string }[]>`
        INSERT INTO proposals (tenant_id, opportunity_id, solicitation_id, title, stage, gate_config, is_locked, origin_card, source_bucket)
        VALUES (
          ${tenantId},
          ${topicId},
          ${topic.solicitationId},
          ${proposalTitle},
          'draft',
          ${sql.json(gateConfig)},
          true,
          ${sql.json(originCard)},
          ${topBucket?.bucket ?? null}
        )
        RETURNING id
      `;

      let count = 0;

      // ── E1: create one artifact (the lockable/downloadable document unit) per
      //    volume, then link each section to its artifact. format_spec /
      //    compliance_spec are frozen here ('{}' until E2 populates them).
      const artifactByVolKey = new Map<string, string>();
      const createdArtifacts: { id: string; volumeName: string | null; artifactType: string }[] = [];
      const volKey = (num: number | null, name: string | null) => `${num ?? ''}|${name ?? ''}`;

      if (requiredItems.length > 0) {
        const programType = topic.programType ?? '';

        for (const vol of resolved.volumes) {
          const volName = (vol.volumeName as string) ?? null;
          const volNum = (vol.volumeNumber as number) ?? null;
          const artifactType = /cost|budget|price/i.test(volName ?? '') ? 'cost' : 'narrative';
          // E2: freeze the format + compliance spec onto the artifact at purchase.
          const { formatSpec, complianceSpec } = buildArtifactSpecs({
            artifactType,
            items: (vol.items as Array<Record<string, unknown>>) ?? [],
            compliance: resolved.compliance,
          });
          const [art] = await tx<{ id: string }[]>`
            INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
            VALUES (${proposalRow.id}, ${volNum}, ${volName}, ${artifactType},
                    ${JSON.stringify(formatSpec)}::jsonb, ${JSON.stringify(complianceSpec)}::jsonb)
            RETURNING id
          `;
          artifactByVolKey.set(volKey(volNum, volName), art.id);
          createdArtifacts.push({ id: art.id, volumeName: volName, artifactType });
        }

        for (const item of requiredItems) {
          const artifactId = artifactByVolKey.get(volKey(item.volumeNumber, item.volumeName)) ?? null;
          // Insert the section row first to get its id
          const [section] = await tx<{ id: string }[]>`
            INSERT INTO proposal_sections (
              proposal_id, artifact_id, section_number, title, content, status, page_allocation,
              volume_name, volume_number, section_type, meta
            ) VALUES (
              ${proposalRow.id},
              ${artifactId},
              ${String(item.itemNumber)},
              ${item.itemName},
              ${null},
              'empty',
              ${item.pageLimit},
              ${item.volumeName},
              ${item.volumeNumber},
              ${inferSectionType(item.itemName, sectionStandards)},
              ${tx.json({ itemType: item.itemType ?? null, volumeName: item.volumeName ?? null, expertNotes: item.expertNotes ?? null })}
            )
            RETURNING id
          `;

          // Compliance matrix: one requirement row per required item (or per named
          // required-section within it), linked to the section that addresses it.
          // This is what the proposal card's percentComplete and the workspace
          // compliance tab read — previously never populated (always 0%). Rows
          // start 'not_addressed' and flip to 'satisfied' when the section locks.
          for (const reqText of requirementLabels(item.itemName, item.requiredSections)) {
            await tx`
              INSERT INTO proposal_compliance_matrix
                (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
              VALUES (${proposalRow.id}, ${reqText}, ${item.volumeName ?? 'RFP'}, true, 'not_addressed', ${section.id})
            `;
          }

          // E3: resolve the starter template — DB-backed first (expert-authored
          // via the Template Studio, linked per required-item via template_id),
          // then the in-code registry as fallback.
          let templateDoc: CanvasDocument | null = null;
          if (item.templateId) {
            const [tpl] = await tx<{ canvasDocument: CanvasDocument | null }[]>`
              SELECT canvas_document FROM document_templates WHERE id = ${item.templateId}::uuid LIMIT 1
            `;
            if (tpl?.canvasDocument && Array.isArray((tpl.canvasDocument as { nodes?: unknown }).nodes)) {
              templateDoc = tpl.canvasDocument;
            }
          }
          if (!templateDoc) {
            const templateKey = resolveTemplateKey(programType, item.itemType);
            if (templateKey) templateDoc = getTemplate(templateKey);
          }
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

          count++;
        }
      } else {
        // No required items defined — create a single default artifact + section
        const { formatSpec: defFormat, complianceSpec: defCompliance } = buildArtifactSpecs({
          artifactType: 'narrative', items: [], compliance: resolved.compliance,
        });
        const [defArt] = await tx<{ id: string }[]>`
          INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
          VALUES (${proposalRow.id}, 1, 'Technical Volume', 'narrative',
                  ${JSON.stringify(defFormat)}::jsonb, ${JSON.stringify(defCompliance)}::jsonb)
          RETURNING id
        `;
        artifactByVolKey.set(volKey(1, 'Technical Volume'), defArt.id);
        createdArtifacts.push({ id: defArt.id, volumeName: 'Technical Volume', artifactType: 'narrative' });
        const [defSection] = await tx<{ id: string }[]>`
          INSERT INTO proposal_sections (
            proposal_id, artifact_id, section_number, title, content, status,
            volume_name, volume_number
          ) VALUES (
            ${proposalRow.id},
            ${defArt.id},
            '1',
            'Technical Volume',
            ${null},
            'empty',
            'Technical Volume',
            1
          )
          RETURNING id
        `;
        // Matrix: at least one requirement so the card burden isn't an empty shell.
        await tx`
          INSERT INTO proposal_compliance_matrix
            (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
          VALUES (${proposalRow.id}, 'Technical Volume', 'RFP', true, 'not_addressed', ${defSection.id})
        `;
        count = 1;
      }

      // ── Seed supporting documents from compliance matrix ──────────
      try {
        const complianceRow = await tx`
          SELECT required_documents, required_sections FROM solicitation_compliance
          WHERE solicitation_id = ${topic.solicitationId}::uuid LIMIT 1
        `;

        if (complianceRow.length > 0) {
          const requiredDocs = complianceRow[0].requiredDocuments;
          // requiredDocs is JSONB — could be array of strings or array of objects
          if (Array.isArray(requiredDocs)) {
            for (const doc of requiredDocs) {
              const label = typeof doc === 'string' ? doc : (doc.name || doc.label || String(doc));
              const source = typeof doc === 'object' && doc !== null ? (doc.source || doc.reference || null) : null;
              const required = typeof doc === 'object' && doc !== null ? (doc.required !== false) : true;

              await tx`
                INSERT INTO proposal_supporting_docs
                  (proposal_id, tenant_id, requirement_label, requirement_source,
                   category, is_required, status)
                VALUES (${proposalRow.id}::uuid, ${tenantId}::uuid, ${label}, ${source},
                        'supporting_document', ${required}, 'missing')
              `;
            }
          }
        }

        // Also create placeholder rows for the user-upload categories
        await tx`
          INSERT INTO proposal_supporting_docs
            (proposal_id, tenant_id, requirement_label, category, is_required, status)
          VALUES
            (${proposalRow.id}::uuid, ${tenantId}::uuid, 'Proposal Input Materials', 'proposal_input', false, 'missing'),
            (${proposalRow.id}::uuid, ${tenantId}::uuid, 'Other Documents', 'other', false, 'missing')
        `;
      } catch (seedErr) {
        // Supporting doc seeding is enrichment — don't fail the whole proposal creation
        console.error('[api/portal/proposals/create] supporting docs seed failed (non-fatal):', seedErr);
      }

      return { proposal: proposalRow, sectionCount: count, artifacts: createdArtifacts };
    });

    // ── Link matching purchase to the new proposal ─────────────────
    try {
      await sql`
        UPDATE purchases
        SET proposal_id = ${proposal.id}::uuid
        WHERE tenant_id = ${tenantId}::uuid
          AND opportunity_id = ${topicId}::uuid
          AND proposal_id IS NULL
      `;
    } catch (purchaseErr) {
      // Non-fatal — purchase linkage is not critical path
      console.error('[api/portal/proposals/create] purchase link failed (non-fatal):', purchaseErr);
    }

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

    // ── E1: V0 provisioning (copy) event — the compliance event emitted on copy
    //    of the skeleton + RFP docs into the customer portal. Carries the created
    //    artifacts + copied-doc refs for the control plane / automation (E5/F1).
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'proposal.v0_provisioned',
        actor: userActor(userId, sessionUser.email),
        tenantId,
        payload: {
          proposalId: proposal.id,
          tenantSlug,
          artifacts: artifacts.map((a) => ({ id: a.id, volumeName: a.volumeName, artifactType: a.artifactType })),
          rfpDocumentsCopied: docsCopied,
          complianceCopied: true,
          volumesCopied: true,
        },
      });
    } catch {
      // Best-effort — never break the main flow
    }

    // ── Activity log ─────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, details)
        VALUES (${proposal.id}::uuid, ${tenantId}::uuid, ${userId}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'proposal_created',
                ${JSON.stringify({ title: proposalTitle, topic_id: topicId, section_count: sectionCount })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/create] activity log failed', logErr);
    }

    // ── Notify RFP admins about new proposal (72-hour review SLA) ───
    let adminsNotifiedCount = 0;
    try {
      const admins = await sql<{ email: string; name: string | null }[]>`
        SELECT email, name FROM users
        WHERE role IN ('rfp_admin', 'master_admin') AND is_active = true
        LIMIT 10
      `;

      if (admins.length > 0) {
        const { sendEmail } = await import('@/lib/email');
        const tenantRow = await sql<{ name: string }[]>`SELECT name FROM tenants WHERE id = ${tenantId}::uuid`;
        const tenantName = tenantRow[0]?.name || tenantSlug;

        for (const admin of admins) {
          try {
            await sendEmail({
              to: admin.email,
              subject: `ACTION REQUIRED — New Proposal Locked for Admin Review — ${tenantName}`,
              html: `
                <p>Hi ${admin.name || 'Admin'},</p>
                <p>A new proposal workspace has been created and is <strong>locked for admin review</strong>. The customer can see the proposal but cannot edit until you unlock it.</p>
                <ul>
                  <li><strong>Customer:</strong> ${tenantName}</li>
                  <li><strong>Proposal:</strong> ${proposalTitle}</li>
                  <li><strong>Sections:</strong> ${sectionCount}</li>
                  <li><strong>Created:</strong> ${new Date().toISOString()}</li>
                </ul>
                <p><strong>Within 72 hours, please:</strong></p>
                <ol>
                  <li>Review the section skeleton and compliance matrix</li>
                  <li>Co-draft and edit sections as needed (AI draft, manual edits)</li>
                  <li>Verify compliance variables are accurate</li>
                  <li>Unlock the proposal to release it to the customer</li>
                </ol>
                <p>The customer will be notified when the proposal is unlocked and ready for their input.</p>
                <p>— RFP Pipeline System</p>
              `,
            });
            adminsNotifiedCount++;
          } catch (emailErr) {
            console.error('[proposals/create] admin alert email failed:', emailErr);
          }
        }
      }
    } catch (alertErr) {
      console.error('[proposals/create] admin alert setup failed:', alertErr);
      // Non-fatal — proposal creation succeeded
    }

    // Emit admin alert delivery summary event (closed-loop)
    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'email.admin_alert_delivered',
        actor: userActor(userId, sessionUser.email),
        tenantId,
        payload: {
          proposalId: proposal.id,
          proposalTitle,
          adminsNotified: adminsNotifiedCount,
          status: adminsNotifiedCount > 0 ? 'sent' : 'no_admins',
        },
      });
    } catch {
      // Best-effort — never break the main flow
    }

    // ── 72h admin-review HITL gate (R3.3 spine bridge) ──────────────
    // Launch the generic ProjectCollaboration reaction on the opportunity spine:
    // a REAL deadline-tracked, nudged HITL gate parked in the rfp_admin task queue
    // (entity = this proposal), resolved when the admin reviews + unlocks. This is
    // the registered-Workflow HITL gate that replaces the old `AdminProposalSetup`
    // PHANTOM (a bare process_instances row with no Workflow class, force-failed by
    // the stuck sweep ~5 min in — removed in gap-sweep C1). The inline admin emails
    // above stay as the immediate ping; this adds the tracked, nudged queue item.
    // Non-fatal: a launch failure never breaks proposal creation.
    try {
      const launch = await launchProjectCollaboration({
        actor: { id: userId, email: sessionUser.email ?? null, role, tenantId },
        tenantId,
        scope: 'project',
        opportunityId: topicId,
        proposalId: proposal.id,
        stage: 'draft',
        taskType: 'admin_review',
        taskTitle: `Review & unlock: ${proposalTitle}`,
        assigneeRole: 'rfp_admin',
        entityType: 'proposal',
        entityRef: proposal.id,
        nudgeDays: [1, 3],
        dueMinutes: 4320, // 72h review SLA
        completeTemplate: 'proposal_unlocked',
      });
      if (!launch.ok) {
        console.error('[proposals/create] ProjectCollaboration launch refused:', launch.code, launch.error);
      }
    } catch (launchErr) {
      console.error('[proposals/create] ProjectCollaboration launch failed (non-fatal):', launchErr);
    }

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
