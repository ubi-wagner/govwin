'use client';

import React, { useState, useCallback } from 'react';
import { fmtDate } from '@/lib/fmt';

type AutomationRule = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerNamespace: string;
  triggerType: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  log_only: 'bg-gray-100 text-gray-700',
  queue_notification: 'bg-blue-100 text-blue-700',
  queue_job: 'bg-purple-100 text-purple-700',
  emit_event: 'bg-indigo-100 text-indigo-700',
  send_email: 'bg-green-100 text-green-700',
  notify_admin: 'bg-yellow-100 text-yellow-700',
  webhook: 'bg-orange-100 text-orange-700',
  update_status: 'bg-teal-100 text-teal-700',
  create_todo: 'bg-pink-100 text-pink-700',
  distribute_social: 'bg-cyan-100 text-cyan-700',
  publish_content: 'bg-emerald-100 text-emerald-700',
  unpublish_content: 'bg-red-100 text-red-700',
  enroll_drip: 'bg-violet-100 text-violet-700',
};

export function AutomationClient({
  initialRules,
}: {
  initialRules: AutomationRule[];
}) {
  const [rules, setRules] = useState<AutomationRule[]>(initialRules);
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(async (ruleId: string, currentActive: boolean) => {
    setToggleLoading(ruleId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/automation/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to toggle rule');
        return;
      }
      // Update local state
      setRules((prev) =>
        prev.map((r) =>
          r.id === ruleId ? { ...r, isActive: !currentActive } : r,
        ),
      );
    } catch {
      setError('Failed to toggle rule');
    } finally {
      setToggleLoading(null);
    }
  }, []);

  const toggleConfig = useCallback((ruleId: string) => {
    setExpandedConfig((prev) => (prev === ruleId ? null : ruleId));
  }, []);

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-sm text-gray-400 py-8">No automation rules found.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Trigger</th>
                <th className="px-4 py-3 font-medium">Action Type</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const actionColor =
                  ACTION_TYPE_COLORS[rule.actionType] ?? 'bg-gray-100 text-gray-700';
                const isExpanded = expandedConfig === rule.id;
                const isToggling = toggleLoading === rule.id;

                return (
                  <React.Fragment key={rule.id}>
                    <tr
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{rule.name}</div>
                        {rule.description && (
                          <div className="text-xs text-gray-400 mt-0.5 max-w-[300px] truncate">
                            {rule.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                          {rule.triggerNamespace}:{rule.triggerType}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionColor}`}
                        >
                          {rule.actionType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggle(rule.id, rule.isActive)}
                          disabled={isToggling}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            rule.isActive ? 'bg-green-500' : 'bg-gray-300'
                          } ${isToggling ? 'opacity-50' : ''}`}
                          title={rule.isActive ? 'Active (click to disable)' : 'Inactive (click to enable)'}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              rule.isActive ? 'translate-x-4.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {fmtDate(rule.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => toggleConfig(rule.id)}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                          >
                            {isExpanded ? 'Hide Config' : 'View Config'}
                          </button>
                          <a
                            href={`/admin/events?namespace=system&type=${encodeURIComponent(rule.triggerType)}`}
                            className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                          >
                            View Logs
                          </a>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${rule.id}-config`} className="border-t border-gray-100">
                        <td colSpan={6} className="px-4 py-3 bg-gray-50">
                          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                            Action Config
                          </div>
                          <pre className="text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto max-h-48">
                            {JSON.stringify(rule.actionConfig, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
