import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { TopicDetail } from '@/components/rfp-curation/topic-detail';

interface Props {
  params: Promise<{ solId: string; topicId: string }>;
}

export default async function Page({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') redirect('/admin/dashboard');

  const { solId, topicId } = await params;

  const topicRows = await sql<Record<string, unknown>[]>`
    SELECT o.id, o.source, o.title, o.topic_number, o.topic_branch, o.topic_status,
           o.tech_focus_areas, o.close_date, o.posted_date, o.description,
           o.poc_name, o.poc_email, o.solicitation_id,
           cs.solicitation_title, cs.namespace, cs.status AS solicitation_status
    FROM opportunities o
    LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id
    WHERE o.id = ${topicId}::uuid
      AND o.solicitation_id = ${solId}::uuid
  `;
  if (topicRows.length === 0) notFound();
  const r = topicRows[0];

  const topic = {
    id: r.id as string,
    title: r.title as string,
    topicNumber: (r.topicNumber as string) ?? null,
    topicBranch: (r.topicBranch as string) ?? null,
    topicStatus: (r.topicStatus as string) ?? 'open',
    techFocusAreas: (r.techFocusAreas as string[]) ?? [],
    description: (r.description as string) ?? null,
    closeDate: r.closeDate ? (r.closeDate as Date).toISOString() : null,
    postedDate: r.postedDate ? (r.postedDate as Date).toISOString() : null,
    pocName: (r.pocName as string) ?? null,
    pocEmail: (r.pocEmail as string) ?? null,
    solicitationId: (r.solicitationId as string),
    solicitationTitle: (r.solicitationTitle as string) ?? null,
    namespace: (r.namespace as string) ?? null,
    solicitationStatus: (r.solicitationStatus as string) ?? null,
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link
          href={`/admin/rfp-curation/${solId}`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; Back to Solicitation Workspace
        </Link>
      </div>
      <TopicDetail topic={topic} currentUserId={session.user.id ?? ''} />
    </div>
  );
}
