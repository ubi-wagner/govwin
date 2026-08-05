import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { list as listTools } from '@/lib/tools';
import type { Tool } from '@/lib/tools';
import { AgentUsageSummary } from '@/components/admin/agent-usage-summary';
import { AgentWorkforce } from '@/components/admin/agent-workforce';
import { PlatformAiConfigCard } from '@/components/admin/platform-ai-config-card';
import ProposalAutoDrive from '@/components/admin/proposal-autodrive';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // ── Get registered tools ──────────────────────────────────────────
  let tools: Tool[] = [];
  try {
    tools = listTools();
  } catch (e) {
    console.error('[admin/agents] tool registry list failed', e);
  }

  // Group tools by namespace
  const toolsByNamespace: Record<string, Tool[]> = {};
  for (const tool of tools) {
    const ns = tool.namespace;
    if (!toolsByNamespace[ns]) toolsByNamespace[ns] = [];
    toolsByNamespace[ns].push(tool);
  }

  const namespaces = Object.keys(toolsByNamespace).sort();

  // ── Recent tool invocations ───────────────────────────────────────
  interface InvocationRow {
    id: string;
    type: string;
    phase: string;
    actorType: string | null;
    actorEmail: string | null;
    tenantId: string | null;
    durationMs: number | null;
    error: unknown;
    createdAt: Date;
  }

  let recentInvocations: InvocationRow[] = [];
  try {
    recentInvocations = await sql<InvocationRow[]>`
      SELECT id, type, phase, actor_type, actor_email, tenant_id, duration_ms, error, created_at
      FROM system_events
      WHERE namespace = 'tool'
      ORDER BY created_at DESC
      LIMIT 30
    `;
  } catch (e) {
    console.error('[admin/agents] invocations query failed', e);
  }

  const NAMESPACE_COLORS: Record<string, string> = {
    memory: 'bg-purple-100 text-purple-700',
    solicitation: 'bg-indigo-100 text-indigo-700',
    opportunity: 'bg-blue-100 text-blue-700',
    compliance: 'bg-green-100 text-green-700',
    ingest: 'bg-orange-100 text-orange-700',
    volume: 'bg-teal-100 text-teal-700',
    library: 'bg-cyan-100 text-cyan-700',
    proposal: 'bg-pink-100 text-pink-700',
    source: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">AI Tools & Agents</h1>
        <p className="text-sm text-gray-500 mt-1">
          {tools.length} registered tool{tools.length !== 1 ? 's' : ''} across {namespaces.length} namespace{namespaces.length !== 1 ? 's' : ''}
        </p>
      </header>

      {/* Agent workforce — RFP-admin oversight (#117) */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Agent Workforce</h2>
        <AgentWorkforce />
      </section>

      {/* Proposal Auto-Drive (Doorbell) — admin-plane trigger for the build cohort */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Proposal Auto-Drive</h2>
        <ProposalAutoDrive />
      </section>

      {/* Usage Summary */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Usage Summary (30 days)</h2>
        <AgentUsageSummary />
      </section>

      {/* Pipeline-wide AI controls (master_admin only) */}
      {role === 'master_admin' && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">Pipeline AI Controls</h2>
          <PlatformAiConfigCard />
        </section>
      )}

      {/* Tool Registry */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-4">Tool Registry</h2>
        {namespaces.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No tools registered.</p>
        ) : (
          <div className="space-y-6">
            {namespaces.map((ns) => (
              <div key={ns}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${NAMESPACE_COLORS[ns] ?? 'bg-gray-100 text-gray-600'}`}>
                    {ns}
                  </span>
                  <span className="text-xs text-gray-400">{toolsByNamespace[ns].length} tools</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Tool Name</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Description</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Min Role</th>
                        <th className="px-4 py-2 text-center font-medium text-gray-600">Tenant Scoped</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {toolsByNamespace[ns].map((tool) => (
                        <tr key={tool.name} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs font-medium text-gray-900">
                            {tool.name}
                          </td>
                          <td className="px-4 py-2 text-gray-600 text-xs max-w-sm">
                            {tool.description.split('.')[0]}.
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                              {tool.requiredRole ?? 'any'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            {tool.tenantScoped ? (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">Yes</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Invocations */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Recent Tool Invocations</h2>
        {recentInvocations.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No recent tool invocations recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Event</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Phase</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Actor</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentInvocations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-900">{inv.type}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        inv.phase === 'start' ? 'bg-blue-100 text-blue-700'
                          : inv.phase === 'end' ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {inv.phase}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {inv.actorEmail ?? inv.actorType ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">
                      {inv.durationMs !== null ? `${inv.durationMs}ms` : '-'}
                    </td>
                    <td className="px-3 py-2">
                      {inv.error ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">Error</span>
                      ) : inv.phase === 'end' ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">OK</span>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(inv.createdAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
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
