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

  const triageHistory = triageRows.map((t) => ({
    id: t.id,
    action: t.action,
    actorId: t.actorId,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
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

  return (
    <CurationWorkspace
      solicitation={solicitation}
      compliance={compliance}
      triageHistory={triageHistory}
      topics={topics}
      documents={documents}
      currentUserId={session.user.id ?? ''}
    />
  );
}
