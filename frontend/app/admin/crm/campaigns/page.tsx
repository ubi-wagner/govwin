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
    console.error('[admin/crm/campaigns] count query failed:', e);
    return -1;
  }
}

interface RuleRow {
  id: string;
  name: string | null;
  description: string | null;
  isActive: boolean;
  triggerNamespace: string;
  triggerType: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  createdAt: Date;
}

interface EventRow {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string;
  createdAt: Date;
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // Stats
  const [activeRules, emailEventsToday] = await Promise.all([
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM automation_rules WHERE is_active = true
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM system_events
      WHERE namespace = 'system' AND type LIKE 'email%'
        AND created_at > NOW() - INTERVAL '24 hours'
    `),
  ]);

  // Automation rules
  let rules: RuleRow[] = [];
  try {
    rules = await sql<RuleRow[]>`
      SELECT id, name, description, is_active, trigger_namespace, trigger_type,
             action_type, action_config, created_at
      FROM automation_rules
      ORDER BY is_active DESC, created_at DESC
    `;
  } catch (e) {
    console.error('[admin/crm/campaigns] rules query failed:', e);
  }

  // Recent email events
  let recentEmailEvents: EventRow[] = [];
  try {
    recentEmailEvents = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, actor_type, created_at
      FROM system_events
      WHERE namespace = 'system' AND type LIKE 'email%'
      ORDER BY created_at DESC
      LIMIT 20
    `;
  } catch (e) {
    console.error('[admin/crm/campaigns] email events query failed:', e);
  }

  const formatVal = (v: number) => (v === -1 ? 'N/A' : v.toLocaleString());

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <p className="text-sm text-gray-500 mt-1">Email automation rules and campaign activity</p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Active Rules" value={formatVal(activeRules)} />
        <StatCard label="Emails Sent Today" value={formatVal(emailEventsToday)} />
        <StatCard label="Total Rules" value={formatVal(rules.length)} />
      </div>

      {/* Automation rules table */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Automation Rules</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">No automation rules configured.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Active</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Description</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Trigger</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {rule.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[300px] truncate">
                      {rule.description ?? rule.name ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                        {rule.triggerNamespace}:{rule.triggerType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {rule.actionType}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(rule.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent email events */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Email Events</h2>
          <Link href="/admin/events" className="text-sm text-blue-600 hover:underline">
            View all events
          </Link>
        </div>
        {recentEmailEvents.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">No email events recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Event</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Phase</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actor</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentEmailEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-pink-50 text-pink-700">
                        {ev.namespace}.{ev.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {ev.phase ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {ev.actorType}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(ev.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
