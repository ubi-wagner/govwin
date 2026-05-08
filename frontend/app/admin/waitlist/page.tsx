import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  interface WaitlistRow {
    id: string;
    contactName: string;
    contactEmail: string;
    companyName: string;
    companyWebsite: string | null;
    techSummary: string;
    status: string;
    createdAt: Date;
  }

  let applications: WaitlistRow[] = [];
  try {
    applications = await sql<WaitlistRow[]>`
      SELECT id, contact_name, contact_email, company_name, company_website,
             tech_summary, status, created_at
      FROM applications
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[admin/waitlist] query failed:', e);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Waitlist</h1>
            <p className="text-sm text-gray-500 mt-1">
              {applications.length} pending application{applications.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link
            href="/admin/applications"
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            View All Applications
          </Link>
        </div>
      </header>

      {applications.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <h3 className="text-lg font-medium text-gray-600">No pending applications</h3>
          <p className="text-sm text-gray-500 mt-1">
            All applications have been reviewed.
          </p>
          <Link href="/admin/applications" className="text-sm text-blue-600 hover:underline mt-3 inline-block">
            View all applications
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => (
            <Link
              key={app.id}
              href="/admin/applications"
              className="block bg-white border border-gray-200 rounded-lg p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900">{app.companyName}</h3>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span>{app.contactName}</span>
                    <span>{app.contactEmail}</span>
                    {app.companyWebsite && <span>{app.companyWebsite}</span>}
                  </div>
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{app.techSummary}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">
                    Pending
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(app.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
