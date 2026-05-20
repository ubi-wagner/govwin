import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

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

interface TodoRow {
  id: string;
  title: string;
  description: string | null;
  todoType: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedEmail: string | null;
  assignedName: string | null;
  createdAt: Date;
  dueAt: Date | null;
}

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  const params = await searchParams;
  const typeFilter = params.type ?? 'all';
  const statusFilter = params.status ?? 'open';

  const validTypes = ['all', 'curation', 'support', 'content_review', 'campaign', 'general'];
  const validStatuses = ['all', 'open', 'in_progress', 'done', 'dismissed'];
  const activeType = validTypes.includes(typeFilter) ? typeFilter : 'all';
  const activeStatus = validStatuses.includes(statusFilter) ? statusFilter : 'open';

  let todos: TodoRow[] = [];
  try {
    if (activeType === 'all' && activeStatus === 'all') {
      todos = await sql<TodoRow[]>`
        SELECT t.id, t.title, t.description, t.todo_type, t.priority, t.status,
               t.assigned_to, u.email AS assigned_email, u.name AS assigned_name,
               t.created_at, t.due_at
        FROM admin_todos t
        LEFT JOIN users u ON u.id = t.assigned_to
        ORDER BY
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.created_at DESC
        LIMIT 100
      `;
    } else if (activeType === 'all') {
      todos = await sql<TodoRow[]>`
        SELECT t.id, t.title, t.description, t.todo_type, t.priority, t.status,
               t.assigned_to, u.email AS assigned_email, u.name AS assigned_name,
               t.created_at, t.due_at
        FROM admin_todos t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.status = ${activeStatus}
        ORDER BY
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.created_at DESC
        LIMIT 100
      `;
    } else if (activeStatus === 'all') {
      todos = await sql<TodoRow[]>`
        SELECT t.id, t.title, t.description, t.todo_type, t.priority, t.status,
               t.assigned_to, u.email AS assigned_email, u.name AS assigned_name,
               t.created_at, t.due_at
        FROM admin_todos t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.todo_type = ${activeType}
        ORDER BY
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.created_at DESC
        LIMIT 100
      `;
    } else {
      todos = await sql<TodoRow[]>`
        SELECT t.id, t.title, t.description, t.todo_type, t.priority, t.status,
               t.assigned_to, u.email AS assigned_email, u.name AS assigned_name,
               t.created_at, t.due_at
        FROM admin_todos t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.todo_type = ${activeType} AND t.status = ${activeStatus}
        ORDER BY
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.created_at DESC
        LIMIT 100
      `;
    }
  } catch (e) {
    console.error('[admin/crm/todos] query failed:', e);
  }

  const typeTabs = [
    { label: 'All', value: 'all' },
    { label: 'Curation', value: 'curation' },
    { label: 'Support', value: 'support' },
    { label: 'Content Review', value: 'content_review' },
    { label: 'Campaign', value: 'campaign' },
    { label: 'General', value: 'general' },
  ];

  const statusTabs = [
    { label: 'Open', value: 'open' },
    { label: 'In Progress', value: 'in_progress' },
    { label: 'Done', value: 'done' },
    { label: 'Dismissed', value: 'dismissed' },
    { label: 'All', value: 'all' },
  ];

  function buildUrl(newType: string, newStatus: string): string {
    const p = new URLSearchParams();
    if (newType !== 'all') p.set('type', newType);
    if (newStatus !== 'open') p.set('status', newStatus);
    const qs = p.toString();
    return `/admin/crm/todos${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Admin TODOs</h1>
        <p className="text-sm text-gray-500 mt-1">
          {todos.length} items
        </p>
      </header>

      {/* Type filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {typeTabs.map((tab) => (
          <Link
            key={tab.value}
            href={buildUrl(tab.value, activeStatus)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeType === tab.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-6">
        {statusTabs.map((tab) => (
          <Link
            key={tab.value}
            href={buildUrl(activeType, tab.value)}
            className={`px-3 py-1 text-xs font-medium rounded-full ${
              activeStatus === tab.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {todos.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No TODOs found for this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Priority</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Assigned To</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {todos.map((todo) => (
                <tr key={todo.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 max-w-[300px] truncate">
                    {todo.title}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {todo.todoType.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[todo.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {todo.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[todo.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {todo.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {todo.assignedName ?? todo.assignedEmail ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(todo.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(todo.dueAt)}
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
