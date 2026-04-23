import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { CurationWorkspace } from '@/components/rfp-curation/curation-workspace';

interface Props {
  params: Promise<{ solId: string }>;
}

export default async function CurationWorkspacePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { solId } = await params;

  const solRows = await sql<Record<string, unknown>[]>`
    SELECT
      cs.id, cs.opportunity_id, cs.status, cs.namespace,
      cs.claimed_by, cs.claimed_at, cs.curated_by, cs.approved_by,
      cs.review_requested_for, cs.phase_like, cs.ai_extracted,
      cs.ai_confidence, cs.full_text, cs.annotations AS annotations_inline,
      cs.pushed_at, cs.dismissed_reason, cs.created_at, cs.updated_at,
      o.title, o.source, o.source_id, o.agency, o.office, o.program_type,
      o.solicitation_number, o.naics_codes, o.set_aside_type,
      o.close_date, o.posted_date, o.description
    FROM curated_solicitations cs
    JOIN opportunities o ON o.id = cs.opportunity_id
    WHERE cs.id = ${solId}::uuid
  `;

  if (solRows.length === 0) notFound();
  const r = solRows[0];

  const compRows = await sql<Record<string, unknown>[]>`
    SELECT * FROM solicitation_compliance WHERE solicitation_id = ${solId}::uuid
  `;
  const compliance = compRows.length > 0 ? compRows[0] : null;

  const triageRows = await sql<{ id: string; action: string; actorId: string; notes: string | null; createdAt: Date }[]>`
    SELECT id, action, actor_id, notes, created_at
    FROM triage_actions WHERE solicitation_id = ${solId}::uuid
    ORDER BY created_at ASC
  `;

  // Topics under this solicitation (the pursuable units — what customers pin)
  const topicRows = await sql<{
    id: string;
    topicNumber: string | null;
    title: string;
    topicBranch: string | null;
    topicStatus: string | null;
    techFocusAreas: string[] | null;
    closeDate: Date | null;
    isActive: boolean;
  }[]>`
    SELECT id, topic_number, title, topic_branch, topic_status,
           tech_focus_areas, close_date, is_active
    FROM opportunities
    WHERE solicitation_id = ${solId}::uuid
    ORDER BY
      CASE WHEN topic_number IS NULL THEN 1 ELSE 0 END,
      topic_number ASC
  `;

  // Linked source documents (uploaded files on this solicitation)
  const docRows = await sql<{
    id: string;
    documentType: string;
    originalFilename: string;
    storageKey: string;
    fileSize: number | null;
    contentType: string | null;
    extractedAt: Date | null;
    createdAt: Date;
  }[]>`
    SELECT id, document_type, original_filename, storage_key,
           file_size, content_type, extracted_at, created_at
    FROM solicitation_documents
    WHERE solicitation_id = ${solId}::uuid
    ORDER BY created_at ASC
  `;

  // Volumes with their required items (joined in one query)
  const volumeRows = await sql<{
    volumeId: string;
    volumeNumber: number;
    volumeName: string;
    volumeFormat: string | null;
    description: string | null;
    specialRequirements: string[] | null;
    appliesToPhase: string[] | null;
    items: Array<{
      id: string;
      itemNumber: number;
      itemName: string;
      itemType: string;
      required: boolean;
      pageLimit: number | null;
      slideLimit: number | null;
      fontFamily: string | null;
      fontSize: string | null;
      margins: string | null;
      lineSpacing: string | null;
      headerFormat: string | null;
      footerFormat: string | null;
      appliesToPhase: string[] | null;
      verifiedBy: string | null;
    }> | null;
  }[]>`
    SELECT
      v.id AS volume_id,
      v.volume_number,
      v.volume_name,
      v.volume_format,
      v.description,
      v.special_requirements,
      v.applies_to_phase,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', i.id,
              'itemNumber', i.item_number,
              'itemName', i.item_name,
              'itemType', i.item_type,
              'required', i.required,
              'pageLimit', i.page_limit,
              'slideLimit', i.slide_limit,
              'fontFamily', i.font_family,
              'fontSize', i.font_size,
              'margins', i.margins,
              'lineSpacing', i.line_spacing,
              'headerFormat', i.header_format,
              'footerFormat', i.footer_format,
              'appliesToPhase', i.applies_to_phase,
              'verifiedBy', i.verified_by
            ) ORDER BY i.item_number
          )
          FROM volume_required_items i WHERE i.volume_id = v.id
        ),
        '[]'::json
      ) AS items
    FROM solicitation_volumes v
    WHERE v.solicitation_id = ${solId}::uuid
    ORDER BY v.volume_number ASC
  `;

  const solicitation = {
    id: r.id as string,
    opportunityId: r.opportunityId as string,
    status: r.status as string,
    namespace: (r.namespace as string) ?? null,
    claimedBy: (r.claimedBy as string) ?? null,
    curatedBy: (r.curatedBy as string) ?? null,
    approvedBy: (r.approvedBy as string) ?? null,
    aiExtracted: r.aiExtracted ?? null,
    fullText: (r.fullText as string) ?? null,
    title: r.title as string,
    source: r.source as string,
    agency: (r.agency as string) ?? null,
    office: (r.office as string) ?? null,
    programType: (r.programType as string) ?? null,
    solicitationNumber: (r.solicitationNumber as string) ?? null,
    description: (r.description as string) ?? null,
    closeDate: r.closeDate ? (r.closeDate as Date).toISOString() : null,
    postedDate: r.postedDate ? (r.postedDate as Date).toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
  };

  // Resolve actor ids → user display names + emails for the activity feed.
  // Collect every unique actor id across all audit/event sources.
  const actorIds = new Set<string>();
  for (const t of triageRows) if (t.actorId) actorIds.add(t.actorId);
  if (r.claimedBy) actorIds.add(r.claimedBy as string);
  if (r.curatedBy) actorIds.add(r.curatedBy as string);
  if (r.approvedBy) actorIds.add(r.approvedBy as string);

  const userLookup: Record<string, { name: string; email: string | null }> = {};
  if (actorIds.size > 0) {
    const userRows = await sql<{ id: string; name: string | null; email: string }[]>`
      SELECT id, name, email FROM users WHERE id = ANY(${Array.from(actorIds)}::uuid[])
    `;
    for (const u of userRows) {
      userLookup[u.id] = { name: u.name ?? u.email, email: u.email };
    }
  }

  // Related system_events (tool invocations, compliance saves, etc.)
  const eventRows = await sql<{
    id: string;
    type: string;
    phase: string;
    actorId: string;
    actorEmail: string | null;
    payload: Record<string, unknown> | null;
    createdAt: Date;
  }[]>`
    SELECT id, type, phase, actor_id, actor_email, payload, created_at
    FROM system_events
    WHERE namespace = 'finder'
      AND (
        payload->>'solicitationId' = ${solId}
        OR payload->>'solicitation_id' = ${solId}
      )
    ORDER BY created_at DESC
    LIMIT 100
  `;

  const triageHistory = triageRows.map((t) => ({
    id: t.id,
    action: t.action,
    actorId: t.actorId,
    actorName: userLookup[t.actorId]?.name ?? null,
    actorEmail: userLookup[t.actorId]?.email ?? null,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
  }));

  const activityEvents = eventRows.map((e) => ({
    id: e.id,
    type: e.type,
    phase: e.phase,
    actorId: e.actorId,
    actorEmail: e.actorEmail,
    actorName: e.actorId && userLookup[e.actorId]?.name ? userLookup[e.actorId].name : null,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  }));

  const topics = topicRows.map((t) => ({
    id: t.id,
    topicNumber: t.topicNumber,
    title: t.title,
    topicBranch: t.topicBranch,
    topicStatus: t.topicStatus,
    techFocusAreas: t.techFocusAreas ?? [],
    closeDate: t.closeDate?.toISOString() ?? null,
    isActive: t.isActive,
  }));

  const documents = docRows.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    originalFilename: d.originalFilename,
    storageKey: d.storageKey,
    fileSize: d.fileSize,
    contentType: d.contentType,
    extractedAt: d.extractedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }));

  const volumes = volumeRows.map((v) => ({
    id: v.volumeId,
    volumeNumber: v.volumeNumber,
    volumeName: v.volumeName,
    volumeFormat: v.volumeFormat,
    description: v.description,
    specialRequirements: v.specialRequirements ?? [],
    appliesToPhase: v.appliesToPhase,
    items: v.items ?? [],
  }));

  // Persisted annotations (compliance tags on the source PDF)
  const annotationRows = await sql<{
    id: string;
    kind: string;
    complianceVariableName: string | null;
    sourceLocation: { page?: number } | null;
    payload: { excerpt?: string } | null;
  }[]>`
    SELECT id, kind, compliance_variable_name, source_location, payload
    FROM solicitation_annotations
    WHERE solicitation_id = ${solId}::uuid
    ORDER BY created_at ASC
  `;
  const initialAnnotations = annotationRows
    .map((a) => ({
      id: a.id,
      pageNumber: a.sourceLocation?.page ?? 1,
      sourceExcerpt: a.payload?.excerpt ?? '',
      complianceVariableName: a.complianceVariableName,
    }))
    .filter((a) => a.sourceExcerpt);

  return (
    <CurationWorkspace
      solicitation={solicitation}
      compliance={compliance}
      triageHistory={triageHistory}
      activityEvents={activityEvents}
      topics={topics}
      documents={documents}
      volumes={volumes}
      initialAnnotations={initialAnnotations}
      currentUserId={session.user.id ?? ''}
    />
  );
}
