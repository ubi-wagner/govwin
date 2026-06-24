'use client';

import { useState, useEffect, useCallback } from 'react';

interface AgentBreakdown {
  agentRole: string;
  displayName: string;
  calls: number;
  lastUsed: string | null;
}

interface RecentActivity {
  agentRole: string;
  taskType: string;
  createdAt: string;
  durationMs: number;
  humanAccepted: boolean | null;
}

interface UsageData {
  summary: {
    totalCalls: number;
    budgetUsedPct: number;
    callsRemainingThisHour: number;
    rateLimitPerHour?: number;
    aiEnabled?: boolean;
  };
  byAgent: AgentBreakdown[];
  recentActivity: RecentActivity[];
}

interface AgentUsagePanelProps {
  tenantSlug: string;
}

export function AgentUsagePanel({ tenantSlug }: AgentUsagePanelProps) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/agents/usage?period=${period}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Failed to load' }));
        setError(json.error || 'Failed to load agent usage');
        return;
      }
      const json = await res.json();
      setData(json.data ?? null);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, period]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">AI Agent Usage</h2>
        <p className="text-sm text-gray-400">Loading usage data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">AI Agent Usage</h2>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">AI Agent Usage</h2>
        <p className="text-sm text-gray-400">No usage data available.</p>
      </div>
    );
  }

  const budgetColor =
    data.summary.budgetUsedPct >= 90
      ? 'text-red-600'
      : data.summary.budgetUsedPct >= 70
        ? 'text-yellow-600'
        : 'text-green-600';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">AI Agent Usage</h2>
        <div className="flex gap-1">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 text-xs rounded ${
                period === p
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* AI-disabled banner (budget 0 for this tenant, or paused platform-wide) */}
      {data.summary.aiEnabled === false && (
        <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          AI is currently disabled for your account. Contact your administrator to enable it.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Total AI Calls ({period === '7d' ? 'last 7 days' : period === '30d' ? 'last 30 days' : 'last 90 days'})</p>
          <p className="text-xl font-bold mt-1">{data.summary.totalCalls}</p>
        </div>
        <div className="border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Allocation Used</p>
          <p className={`text-xl font-bold mt-1 ${budgetColor}`}>
            {data.summary.budgetUsedPct}%
          </p>
        </div>
        <div className="border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Calls Remaining (this hour)</p>
          <p className="text-xl font-bold mt-1">
            {data.summary.callsRemainingThisHour}
            {data.summary.rateLimitPerHour != null && (
              <span className="text-sm font-normal text-gray-400"> / {data.summary.rateLimitPerHour}</span>
            )}
          </p>
        </div>
      </div>

      {/* Per-agent breakdown */}
      {data.byAgent.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Per-Agent Breakdown</h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Agent</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Calls</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Last Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byAgent.map((agent) => (
                  <tr key={agent.agentRole} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{agent.displayName}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{agent.calls}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {agent.lastUsed
                        ? new Date(agent.lastUsed).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent activity */}
      {data.recentActivity.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {data.recentActivity.map((activity, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs border-l-2 border-blue-200 pl-3 py-1">
                <div>
                  <span className="font-medium text-gray-700">{activity.agentRole}</span>
                  <span className="text-gray-400 ml-2">{activity.taskType}</span>
                </div>
                <div className="flex items-center gap-2">
                  {activity.durationMs > 0 && (
                    <span className="text-gray-400">{(activity.durationMs / 1000).toFixed(1)}s</span>
                  )}
                  {activity.humanAccepted !== null && (
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                      activity.humanAccepted
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {activity.humanAccepted ? 'Accepted' : 'Pending'}
                    </span>
                  )}
                  <span className="text-gray-400">
                    {new Date(activity.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
