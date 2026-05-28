import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { EmailOutboxClient } from './email-outbox-client';

export const dynamic = 'force-dynamic';

const CMS_BASE =
  process.env.CMS_SERVICE_URL ||
  process.env.CMS_PUBLIC_URL ||
  'https://rfp-crm-production.up.railway.app';

function cmsHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const user = process.env.CMS_BASIC_USER;
  const pass = process.env.CMS_BASIC_PASS;
  if (user && pass) {
    headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  return headers;
}

type OutboxItem = {
  id: string;
  send_id: string;
  status: string;
  priority: number;
  category: string | null;
  recipient_preview: string | null;
  subject_preview: string | null;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  send?: {
    recipient_email: string;
    recipient_name: string | null;
    subject: string;
    body_html: string | null;
    template_id: string | null;
    campaign_id: string | null;
    tenant_id: string | null;
    send_status: string;
    was_modified: boolean;
  };
};

type OutboxStats = {
  pending: number;
  claimed: number;
  approved_today: number;
  rejected_today: number;
};

export default async function EmailOutboxPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  let items: OutboxItem[] = [];
  let stats: OutboxStats = { pending: 0, claimed: 0, approved_today: 0, rejected_today: 0 };
  let fetchError: string | null = null;

  try {
    const headers = cmsHeaders();

    const [outboxRes, statsRes] = await Promise.all([
      fetch(`${CMS_BASE}/email/outbox?limit=50`, {
        headers,
        next: { revalidate: 0 },
      }).catch(() => null),
      fetch(`${CMS_BASE}/email/outbox/stats`, {
        headers,
        next: { revalidate: 0 },
      }).catch(() => null),
    ]);

    if (outboxRes && outboxRes.ok) {
      const outboxData = await outboxRes.json();
      items = outboxData.data ?? [];
    } else {
      fetchError = 'Could not connect to CMS service. The email outbox data is hosted in the CMS database.';
    }

    if (statsRes && statsRes.ok) {
      const statsData = await statsRes.json();
      stats = statsData.data ?? stats;
    }
  } catch (e) {
    console.error('[admin/email-outbox] CMS fetch failed:', e);
    fetchError = 'Failed to connect to CMS service for email outbox data.';
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Email Outbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            HITL approval queue — review and approve outgoing emails before they send
          </p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>

      {fetchError && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 font-medium">CMS Service Unavailable</p>
          <p className="text-sm text-amber-700 mt-1">{fetchError}</p>
          <p className="text-xs text-amber-600 mt-2">
            The email tables (email_outbox, email_sends) are in the CMS database.
            Ensure the CMS service is running and CMS_SERVICE_URL is configured.
          </p>
        </div>
      )}

      <EmailOutboxClient initialItems={items} initialStats={stats} />
    </div>
  );
}
