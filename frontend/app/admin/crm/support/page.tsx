import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-500',
};

function formatDate(d: Date | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function relativeAge(d: Date): string {
  const now = Date.now();
  const then = new Date(d).getTime();
  const diffHr = Math.floor((now - then) / (1000 * 60 * 60));
  if (diffHr < 1) return '<1h';
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

interface SupportRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedEmail: string | null;
  assignedName: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: Date;
  dueAt: Date | null;
}

export default async function SupportPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  let tickets: SupportRow[] = [];
  try {
    tickets = await sql<SupportRow[]>`
      SELECT t.id, t.title, t.description, t.priority, t.status,
             t.assigned_to, u.email AS assigned_email, u.name AS assigned_name,
             t.related_entity_type, t.related_entity_id,
             t.created_at, t.due_at
      FROM admin_todos t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.todo_type = 'support'
      ORDER BY
        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[admin/crm/support] query failed:', e);
  }

  const openCount = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Support Queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          {tickets.length} tickets &middot; {openCount} open
        </p>
      </header>

      {tickets.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No support tickets found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Priority</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Assigned To</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Age</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Related</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 max-w-[300px] truncate">
                    {ticket.title}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[ticket.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[ticket.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {ticket.assignedName ?? ticket.assignedEmail ?? 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {relativeAge(ticket.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {ticket.relatedEntityType
                      ? `${ticket.relatedEntityType}`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
