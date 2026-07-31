import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // The waitlist is a distinct funnel from applications: a marketing-page email
  // capture (waitlist table), NOT a reviewed account application. Read the real
  // `waitlist` table; extract metadata fields in SQL so a legacy string-scalar
  // metadata value can't break client-side coercion.
  interface WaitlistRow {
    id: string;
    email: string;
    companyName: string | null;
    website: string | null;
    notes: string | null;
    createdAt: Date;
  }

  let entries: WaitlistRow[] = [];
  try {
    entries = await sql<WaitlistRow[]>`
      SELECT id, email, company_name,
             metadata->>'website' AS website,
             metadata->>'notes'   AS notes,
             created_at
      FROM waitlist
      ORDER BY created_at DESC
      LIMIT 200
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
              {entries.length} signup{entries.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link
            href="/admin/applications"
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            View Applications
          </Link>
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <h3 className="text-lg font-medium text-gray-600">No waitlist signups yet</h3>
          <p className="text-sm text-gray-500 mt-1">
            Emails captured from the marketing site will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div
              key={e.id}
              className="block bg-white border border-gray-200 rounded-lg p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900">{e.companyName || e.email}</h3>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span>{e.email}</span>
                    {e.website && <span>{e.website}</span>}
                  </div>
                  {e.notes && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{e.notes}</p>}
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-gray-400">
                    {new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
