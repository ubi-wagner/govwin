'use client';

import { useEffect, useState } from 'react';

interface UsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  uniqueTenants: number;
  avgCostPerCall: number;
}

export function AgentUsageSummary() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/agents/usage?period=30d');
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed to load usage data' }));
          if (!cancelled) setError(json.error || 'Failed to load usage data');
          return;
        }
        const json = await res.json();
        if (!cancelled && json.data?.summary) {
          setSummary(json.data.summary);
        }
      } catch {
        if (!cancelled) setError('Network error loading usage data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="text-sm text-gray-400 py-4">Loading usage data...</div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-3">
        {error}
      </div>
    );
  }

  if (!summary) return null;

  const stats = [
    { label: 'Total Calls (30d)', value: summary.totalCalls.toLocaleString() },
    { label: 'Total Cost', value: `$${summary.totalCostUsd.toFixed(2)}` },
    { label: 'Avg Cost / Call', value: `$${summary.avgCostPerCall.toFixed(4)}` },
    { label: 'Input Tokens', value: summary.totalInputTokens.toLocaleString() },
    { label: 'Output Tokens', value: summary.totalOutputTokens.toLocaleString() },
    { label: 'Active Tenants', value: summary.uniqueTenants.toString() },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">
            {s.label}
          </p>
          <p className="text-lg font-bold text-gray-900 mt-0.5">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
