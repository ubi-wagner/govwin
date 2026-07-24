'use client';

import React, { useState, useCallback } from 'react';

type FrameworkPolicy = {
  id: string;
  scope: string;
  triggerKey: string;
  enabled: boolean;
  recipientRoles: string[];
  nudgeDays: number[];
  dueInMinutes: number | null;
  channel: string;
  configuredAt: string | null;
  updatedAt: string;
};

const CHANNEL_COLORS: Record<string, string> = {
  email: 'bg-green-50 text-green-700',
  todo: 'bg-pink-50 text-pink-700',
  both: 'bg-purple-50 text-purple-700',
};

function dueLabel(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function PolicyClient({ initialPolicies }: { initialPolicies: FrameworkPolicy[] }) {
  const [policies, setPolicies] = useState<FrameworkPolicy[]>(initialPolicies);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(async (policy: FrameworkPolicy) => {
    setToggling(policy.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/automation/policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !policy.enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to update policy');
        return;
      }
      setPolicies((prev) =>
        prev.map((p) => (p.id === policy.id ? { ...p, enabled: !policy.enabled } : p)),
      );
    } catch {
      setError('Failed to update policy');
    } finally {
      setToggling(null);
    }
  }, []);

  const build = policies.filter((p) => p.scope === 'build');
  const discovery = policies.filter((p) => p.scope === 'discovery');

  function renderSection(label: string, rows: FrameworkPolicy[]) {
    if (rows.length === 0) return null;
    return (
      <div className="mb-2">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {label}
        </div>
        {rows.map((policy) => {
          const isToggling = toggling === policy.id;
          return (
            <div
              key={policy.id}
              className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              {/* Enable toggle */}
              <button
                onClick={() => handleToggle(policy)}
                disabled={isToggling}
                className={`relative flex-shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  policy.enabled ? 'bg-green-500' : 'bg-gray-300'
                } ${isToggling ? 'opacity-50' : ''}`}
                title={policy.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    policy.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>

              {/* Trigger key */}
              <div className="flex-1 min-w-0">
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded break-all">
                  {policy.triggerKey}
                </code>
              </div>

              {/* Recipients */}
              <div className="hidden md:flex gap-1 flex-wrap max-w-[180px]">
                {policy.recipientRoles.length > 0
                  ? policy.recipientRoles.map((r) => (
                      <span key={r} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        {r}
                      </span>
                    ))
                  : <span className="text-xs text-gray-400">—</span>}
              </div>

              {/* Due window */}
              <div className="hidden lg:block text-xs text-gray-500 w-12 text-right">
                {dueLabel(policy.dueInMinutes)}
              </div>

              {/* Nudge days */}
              <div className="hidden lg:block text-xs text-gray-500 w-16 text-right">
                {policy.nudgeDays.length > 0 ? `d${policy.nudgeDays.join(',')}` : '—'}
              </div>

              {/* Channel */}
              <div className="hidden sm:block">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${CHANNEL_COLORS[policy.channel] ?? 'bg-gray-100 text-gray-600'}`}>
                  {policy.channel}
                </span>
              </div>

              {/* Configured indicator */}
              <div className="text-xs text-gray-400 w-20 text-right flex-shrink-0">
                {policy.configuredAt ? 'edited' : 'default'}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {policies.length === 0 ? (
        <p className="text-sm text-gray-400 py-6">
          No platform framework policies found. Run migration 126 to seed them.
        </p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className="w-9 flex-shrink-0">On</div>
            <div className="flex-1">Trigger Key</div>
            <div className="hidden md:block w-[180px]">Recipients</div>
            <div className="hidden lg:block w-12 text-right">Window</div>
            <div className="hidden lg:block w-16 text-right">Nudges</div>
            <div className="hidden sm:block w-16">Channel</div>
            <div className="w-20 text-right">Status</div>
          </div>
          {renderSection('Build', build)}
          {renderSection('Discovery', discovery)}
        </div>
      )}
    </div>
  );
}
