import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function safeCount(query: Promise<{ count: number }[]>): Promise<number> {
  try {
    const [row] = await query;
    return Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/crm] count query failed:', e);
    return -1;
  }
}

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
};

const STAGE_STYLES: Record<string, string> = {
  lead: 'bg-yellow-100 text-yellow-700',
  target: 'bg-blue-100 text-blue-700',
  customer: 'bg-green-100 text-green-700',
  at_risk: 'bg-orange-100 text-orange-700',
  churned: 'bg-red-100 text-red-700',
};

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function CrmDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // Run stat queries in parallel
  const [
    openTodos,
    activeCampaigns,
    pendingSupport,
    socialPostsThisWeek,
  ] = await Promise.all([
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM admin_todos WHERE status IN ('open','in_progress')
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM automation_rules WHERE is_active = true
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM admin_todos WHERE todo_type = 'support' AND status IN ('open','in_progress')
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM social_posts WHERE created_at > NOW() - INTERVAL '7 days'
    `),
  ]);

  // Lead pipeline
  interface PipelineRow { lifecycleStage: string; count: number }
  let pipeline: PipelineRow[] = [];
  try {
    pipeline = await sql<PipelineRow[]>`
      SELECT lifecycle_stage, COUNT(*)::int AS count
      FROM tenants
      WHERE lifecycle_stage IS NOT NULL
      GROUP BY lifecycle_stage
    `;
  } catch (e) {
    console.error('[admin/crm] pipeline query failed:', e);
  }

  const pipelineMap: Record<string, number> = {};
  for (const row of pipeline) {
    pipelineMap[row.lifecycleStage] = row.count;
  }

  // Recent open TODOs
  interface TodoRow {
    id: string;
    title: string;
    todoType: string;
    priority: string;
    status: string;
    createdAt: Date;
    dueAt: Date | null;
  }
  let recentTodos: TodoRow[] = [];
  try {
    recentTodos = await sql<TodoRow[]>`
      SELECT id, title, todo_type, priority, status, created_at, due_at
      FROM admin_todos
      WHERE status != 'done'
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 10
    `;
  } catch (e) {
    console.error('[admin/crm] recent todos query failed:', e);
  }

  const formatVal = (v: number) => (v === -1 ? 'N/A' : v.toLocaleString());
  const stages = ['lead', 'target', 'customer', 'at_risk', 'churned'];

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">CRM Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Lead pipeline, tasks, and campaign overview</p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Open TODOs" value={formatVal(openTodos)} href="/admin/crm/todos" />
        <StatCard label="Active Rules" value={formatVal(activeCampaigns)} href="/admin/crm/campaigns" />
        <StatCard label="Pending Support" value={formatVal(pendingSupport)} href="/admin/crm/support" />
        <StatCard label="Social Posts (7d)" value={formatVal(socialPostsThisWeek)} href="/admin/crm/social" />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link
          href="/admin/crm/todos"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Create TODO
        </Link>
        <Link
          href="/admin/crm/campaigns"
          className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
        >
          New Campaign
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Pipeline — 1/3 */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Lead Pipeline</h2>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {stages.map((stage) => (
              <div key={stage} className="flex items-center justify-between px-4 py-3">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLES[stage] ?? 'bg-gray-100 text-gray-600'}`}>
                  {stage.replace('_', ' ')}
                </span>
                <span className="text-sm font-bold text-gray-700">
                  {pipelineMap[stage] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent TODOs — 2/3 */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent TODOs</h2>
            <Link href="/admin/crm/todos" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {recentTodos.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No open TODOs</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTodos.map((todo) => (
                    <tr key={todo.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-700 max-w-[250px] truncate">
                        {todo.title}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">
                        {todo.todoType}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[todo.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                          {todo.priority}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">
                        {todo.status}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(todo.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="block bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
    >
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </Link>
  );
}
