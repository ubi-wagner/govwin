import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { ApplicationReview, type ApplicationItem } from '@/components/admin/application-review';

type ApplicationRow = {
  id: string;
  contactEmail: string;
  contactName: string;
  contactTitle: string | null;
  contactPhone: string | null;
  companyName: string;
  companyWebsite: string | null;
  companySize: string | null;
  companyState: string | null;
  samRegistered: boolean | null;
  samCageCode: string | null;
  dunsUei: string | null;
  previousSubmissions: number | null;
  previousAwards: number | null;
  previousAwardPrograms: string[] | null;
  techSummary: string;
  techAreas: string[] | null;
  targetPrograms: string[] | null;
  targetAgencies: string[] | null;
  desiredOutcomes: string[] | null;
  motivation: string | null;
  referralSource: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  createdAt: Date;
};

export default async function ApplicationsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  let rows: ApplicationRow[] = [];
  try {
    rows = await sql<ApplicationRow[]>`
      SELECT *
      FROM applications
      ORDER BY
        CASE status
          WHEN 'pending' THEN 0
          WHEN 'under_review' THEN 1
          ELSE 2
        END,
        created_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[admin/applications] query failed:', e);
  }

  const items: ApplicationItem[] = rows.map((r) => ({
    id: r.id,
    contactEmail: r.contactEmail,
    contactName: r.contactName,
    contactTitle: r.contactTitle,
    contactPhone: r.contactPhone,
    companyName: r.companyName,
    companyWebsite: r.companyWebsite,
    companySize: r.companySize,
    companyState: r.companyState,
    samRegistered: r.samRegistered,
    samCageCode: r.samCageCode,
    dunsUei: r.dunsUei,
    previousSubmissions: r.previousSubmissions,
    previousAwards: r.previousAwards,
    previousAwardPrograms: r.previousAwardPrograms ?? [],
    techSummary: r.techSummary,
    techAreas: r.techAreas ?? [],
    targetPrograms: r.targetPrograms ?? [],
    targetAgencies: r.targetAgencies ?? [],
    desiredOutcomes: r.desiredOutcomes ?? [],
    motivation: r.motivation,
    referralSource: r.referralSource,
    status: r.status,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNotes: r.reviewNotes,
    createdAt: r.createdAt.toISOString(),
  }));

  const pendingCount = items.filter(
    (a) => a.status === 'pending' || a.status === 'under_review',
  ).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Founding Cohort Applications</h1>
        <p className="text-sm text-gray-500 mt-1">
          {items.length} applications &middot; {pendingCount} pending review
        </p>
      </div>
      <ApplicationReview applications={items} />
    </div>
  );
}
