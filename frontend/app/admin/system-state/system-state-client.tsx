'use client';

import { useRouter } from 'next/navigation';
import { TimeAgo, Elapsed } from '@/components/ui/time-ago';
import { useState, useEffect } from 'react';
import type {
  HealthSummary,
  ActiveWorkflow,
  PipelineState,
  EventTreeNode,
  ErrorEvent,
  EventVolumeRow,
  ContentPipelineData,
  EmailAutomationData,
} from './page';
import { fmtDateTime, fmtNum } from '@/lib/fmt';

// ─── Constants ────────────────────────────────────────────────────────

const NAMESPACE_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  finder:   { bar: 'bg-indigo-500', text: 'text-indigo-600', bg: 'bg-indigo-50' },
  capture:  { bar: 'bg-green-500',  text: 'text-green-600',  bg: 'bg-green-50' },
  identity: { bar: 'bg-blue-500',   text: 'text-blue-600',   bg: 'bg-blue-50' },
  proposal: { bar: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-50' },
  library:  { bar: 'bg-teal-500',   text: 'text-teal-600',   bg: 'bg-teal-50' },
  system:   { bar: 'bg-yellow-500', text: 'text-yellow-700', bg: 'bg-yellow-50' },
  tool:     { bar: 'bg-orange-500', text: 'text-orange-600', bg: 'bg-orange-50' },
};

const STATUS_STYLES: Record<string, { border: string; bg: string; dot: string; text: string }> = {
  running:  { border: 'border-l-blue-500',   bg: 'bg-blue-50',   dot: 'bg-blue-500',   text: 'text-blue-700' },
  paused:   { border: 'border-l-yellow-500', bg: 'bg-yellow-50', dot: 'bg-yellow-500', text: 'text-yellow-700' },
  pending:  { border: 'border-l-gray-400',   bg: 'bg-gray-50',   dot: 'bg-gray-400',   text: 'text-gray-600' },
  retrying: { border: 'border-l-orange-500', bg: 'bg-orange-50', dot: 'bg-orange-500', text: 'text-orange-700' },
};

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'workflows', label: 'Active Workflows' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'content', label: 'Content Pipeline' },
  { key: 'email', label: 'Email Automation' },
  { key: 'trees', label: 'Process Trees' },
  { key: 'errors', label: 'Errors' },
  { key: 'volume', label: 'Event Volume' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// ─── Formatting helpers ───────────────────────────────────────────────

// `relativeTime` / `formatElapsed` used to live here and read `Date.now()` DURING RENDER, which
// failed hydration for the whole page (React #418 → error boundary, on a route still answering 200).
// They are now <TimeAgo> / <Elapsed>, which own their own mount state — see components/ui/time-ago.

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatWorkflowName(name: string): string {
  return name
    .replace(/^On/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

function formatStepName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncateJson(obj: unknown, maxLen = 120): string {
  const s = JSON.stringify(obj);
  if (!s || s === '{}' || s === 'null') return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Sub-components ───────────────────────────────────────────────────

function HealthBar({ health }: { health: HealthSummary }) {
  const cards = [
    {
      label: 'Active Workflows',
      value: health.activeWorkflows,
      color: 'border-blue-400 bg-blue-50',
      accent: health.activeWorkflows > 0 ? 'text-blue-700' : 'text-gray-400',
    },
    {
      label: 'Pending Jobs',
      value: health.pendingJobs,
      color: 'border-indigo-400 bg-indigo-50',
      accent: health.pendingJobs > 0 ? 'text-indigo-700' : 'text-gray-400',
    },
    {
      label: 'Events (1h)',
      value: health.eventsLastHour,
      color: 'border-teal-400 bg-teal-50',
      accent: 'text-teal-700',
    },
    {
      label: 'Events (24h)',
      value: health.eventsLast24h,
      color: 'border-green-400 bg-green-50',
      accent: 'text-green-700',
    },
    {
      label: 'Automation Rules',
      value: health.activeAutomationRules,
      color: 'border-purple-400 bg-purple-50',
      accent: 'text-purple-700',
    },
    {
      label: 'Errors (1h)',
      value: health.errorsLastHour,
      color: health.errorsLastHour > 0 ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-gray-50',
      accent: health.errorsLastHour > 0 ? 'text-red-700 font-bold' : 'text-gray-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`border-l-4 rounded-lg p-3 ${c.color}`}
        >
          <p className="text-xs text-gray-500 uppercase font-medium">{c.label}</p>
          <p className={`text-2xl font-bold mt-1 ${c.accent}`}>{fmtNum(c.value)}</p>
        </div>
      ))}
    </div>
  );
}

function WorkflowCard({
  workflow,
  isExpanded,
  onToggle,
}: {
  workflow: ActiveWorkflow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const style = STATUS_STYLES[workflow.status] ?? STATUS_STYLES.pending;
  const completedSteps = Object.values(workflow.stepStatus).filter((s) => s === 'completed').length;
  const totalSteps = Object.keys(workflow.stepStatus).length;

  return (
    <div className={`rounded-lg border-l-4 ${style.border} border border-gray-200 ${style.bg}`}>
      <button
        onClick={onToggle}
        className="w-full text-left p-4"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400 select-none">{isExpanded ? '▼' : '▶'}</span>

          {workflow.status === 'running' ? (
            <span className="relative flex h-3 w-3 flex-shrink-0">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.dot} opacity-75`} />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${style.dot}`} />
            </span>
          ) : (
            <span className={`inline-flex h-3 w-3 rounded-full flex-shrink-0 ${style.dot}`} />
          )}

          <span className="text-sm font-semibold text-gray-900">
            {formatWorkflowName(workflow.workflowName)}
          </span>

          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.text} ${style.bg}`}>
            {workflow.status}
          </span>

          {workflow.currentStep && (
            <span className="text-xs text-gray-500 font-mono">
              {formatStepName(workflow.currentStep)}
            </span>
          )}

          {totalSteps > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                Step {completedSteps}/{totalSteps}
              </span>
              <div className="h-1.5 w-20 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {workflow.tenantId && (
            <span className="text-xs text-gray-400 font-mono">
              tenant: {workflow.tenantId.slice(0, 8)}...
            </span>
          )}

          {workflow.retryCount > 0 && (
            <span className="text-xs text-orange-600 font-medium">
              retry #{workflow.retryCount}
            </span>
          )}

          <span className="text-xs font-mono text-blue-600 ml-auto flex-shrink-0">
            <Elapsed iso={workflow.startedAt} />
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-gray-500">ID:</span>{' '}
              <span className="font-mono text-gray-700">{workflow.id.slice(0, 12)}...</span>
            </div>
            <div>
              <span className="text-gray-500">Source:</span>{' '}
              <span className="font-mono text-gray-700">{workflow.source}</span>
            </div>
            {workflow.triggerEventId && (
              <div>
                <span className="text-gray-500">Trigger Event:</span>{' '}
                <span className="font-mono text-gray-700">{workflow.triggerEventId.slice(0, 12)}...</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Started:</span>{' '}
              <span className="text-gray-700">{workflow.startedAt ? fmtDateTime(workflow.startedAt) : '--'}</span>
            </div>
          </div>

          {/* Step Status */}
          {Object.keys(workflow.stepStatus).length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">Steps:</p>
              <div className="space-y-1">
                {Object.entries(workflow.stepStatus).map(([step, status]) => (
                  <div key={step} className="flex items-center gap-2 text-xs">
                    <span>
                      {status === 'completed' ? '✓' : status === 'failed' ? '✗' : status === 'running' ? '⏳' : '○'}
                    </span>
                    <span className="font-mono text-gray-700">{formatStepName(step)}</span>
                    <span className={`px-1.5 py-0.5 rounded ${
                      status === 'completed' ? 'bg-green-100 text-green-700' :
                      status === 'failed' ? 'bg-red-100 text-red-700' :
                      status === 'running' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step Results (expandable) */}
          {Object.keys(workflow.stepResults).length > 0 && (
            <details className="text-xs">
              <summary className="text-gray-500 font-medium cursor-pointer hover:text-gray-700">
                Step Results (JSON)
              </summary>
              <pre className="mt-1 p-2 bg-white border border-gray-200 rounded text-gray-700 font-mono overflow-auto max-h-48 text-xs">
                {JSON.stringify(workflow.stepResults, null, 2)}
              </pre>
            </details>
          )}

          {/* Payload */}
          {workflow.payload && Object.keys(workflow.payload).length > 0 && (
            <details className="text-xs">
              <summary className="text-gray-500 font-medium cursor-pointer hover:text-gray-700">
                Payload (JSON)
              </summary>
              <pre className="mt-1 p-2 bg-white border border-gray-200 rounded text-gray-700 font-mono overflow-auto max-h-48 text-xs">
                {JSON.stringify(workflow.payload, null, 2)}
              </pre>
            </details>
          )}

          {/* Error */}
          {workflow.lastError && (
            <div className="p-2 bg-red-50 border border-red-200 rounded">
              <p className="text-xs text-red-700 font-medium">Error:</p>
              <pre className="text-xs text-red-800 font-mono whitespace-pre-wrap mt-1">
                {workflow.lastError}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineSection({ pipeline }: { pipeline: PipelineState }) {
  const curationStatusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700',
    claimed: 'bg-yellow-100 text-yellow-700',
    curation_in_progress: 'bg-orange-100 text-orange-700',
    review_requested: 'bg-purple-100 text-purple-700',
    pushed_to_pipeline: 'bg-green-100 text-green-700',
    dismissed: 'bg-gray-100 text-gray-600',
  };

  const stageColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    review: 'bg-yellow-100 text-yellow-700',
    final: 'bg-blue-100 text-blue-700',
    submitted: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Ingestion Sources */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Ingestion Sources</h3>
        {pipeline.lastRunBySource.length === 0 ? (
          <p className="text-sm text-gray-400">No completed pipeline jobs</p>
        ) : (
          <div className="space-y-2">
            {pipeline.lastRunBySource.map((s) => (
              <div key={s.source} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-gray-700">{s.source}</span>
                  <span className="text-xs text-gray-400 ml-2">({s.count} jobs)</span>
                </div>
                <span className="text-xs text-gray-500">
                  {s.lastRun ? <TimeAgo iso={s.lastRun} /> : 'never'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Curation Queue */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Curation Queue</h3>
        {pipeline.curationCounts.length === 0 ? (
          <p className="text-sm text-gray-400">No curated solicitations</p>
        ) : (
          <div className="space-y-2">
            {pipeline.curationCounts.map((c) => (
              <div key={c.status} className="flex items-center justify-between text-sm">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${curationStatusColors[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {c.status.replace(/_/g, ' ')}
                </span>
                <span className="font-bold text-gray-700">{c.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Proposals by Stage */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Proposals by Stage</h3>
        {pipeline.proposalCounts.length === 0 ? (
          <p className="text-sm text-gray-400">No proposals</p>
        ) : (
          <div className="space-y-2">
            {pipeline.proposalCounts.map((p) => (
              <div key={p.stage} className="flex items-center justify-between text-sm">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${stageColors[p.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                  {p.stage}
                </span>
                <span className="font-bold text-gray-700">{p.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth = 0,
  expandedNodes,
  toggleNode,
}: {
  node: EventTreeNode;
  depth?: number;
  expandedNodes: Set<string>;
  toggleNode: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const nsColor = NAMESPACE_COLORS[node.namespace] ?? { text: 'text-gray-600', bg: 'bg-gray-50' };

  // Status icon
  let statusIcon: string;
  if (node.error) {
    statusIcon = '✗';
  } else if (node.phase === 'end') {
    statusIcon = '✓';
  } else if (node.phase === 'start') {
    statusIcon = '⏳';
  } else {
    statusIcon = '●';
  }

  const statusColor = node.error
    ? 'text-red-600'
    : node.phase === 'end'
      ? 'text-green-600'
      : node.phase === 'start'
        ? 'text-yellow-600'
        : 'text-gray-500';

  // Connector symbols
  const prefix = depth === 0 ? '' : '├── ';

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <div className="flex items-start gap-1.5 py-1 group">
        {depth > 0 && (
          <span className="text-gray-300 font-mono text-xs select-none flex-shrink-0 mt-0.5">{prefix}</span>
        )}

        {hasChildren ? (
          <button
            onClick={() => toggleNode(node.id)}
            className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5 w-4"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        <span className={`text-sm flex-shrink-0 ${statusColor}`}>{statusIcon}</span>

        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${nsColor.text} ${nsColor.bg}`}>
          {node.namespace}.{node.type}
        </span>

        <span className="text-xs text-gray-400">:{node.phase}</span>

        {node.durationMs !== null && (
          <span className="text-xs font-mono text-gray-500">({formatDuration(node.durationMs)})</span>
        )}

        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
          <TimeAgo iso={node.createdAt} />
        </span>

        {node.tenantId && (
          <span className="text-xs text-gray-400 font-mono flex-shrink-0">
            {node.tenantId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Payload preview on hover/expand */}
      {isExpanded && (node.payload || node.error) && (
        <div className="ml-8 mb-1">
          {node.error && (
            <div className="text-xs p-1.5 bg-red-50 border border-red-200 rounded mb-1">
              <span className="text-red-700 font-medium">Error: </span>
              <span className="text-red-800 font-mono">{truncateJson(node.error, 200)}</span>
            </div>
          )}
          {node.payload && Object.keys(node.payload).length > 0 && (
            <div className="text-xs text-gray-500 font-mono">
              {truncateJson(node.payload, 200)}
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {isExpanded && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          expandedNodes={expandedNodes}
          toggleNode={toggleNode}
        />
      ))}
    </div>
  );
}

function ProcessTrees({
  trees,
  expandedNodes,
  toggleNode,
}: {
  trees: EventTreeNode[];
  expandedNodes: Set<string>;
  toggleNode: (id: string) => void;
}) {
  if (trees.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        No process trees in the last 24 hours
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
      {trees.map((tree) => (
        <div key={tree.id} className="p-3">
          <TreeNode
            node={tree}
            expandedNodes={expandedNodes}
            toggleNode={toggleNode}
          />
        </div>
      ))}
    </div>
  );
}

function ErrorsTable({ errors }: { errors: ErrorEvent[] }) {
  if (errors.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        No recent errors
      </div>
    );
  }

  return (
    // `overflow-x-auto`: a clipped table has no scrollbar, so its right columns cannot be read.
    <div className="border border-gray-200 rounded-lg overflow-x-auto bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Error</th>
            <th className="px-3 py-2 font-medium">Tenant</th>
            <th className="px-3 py-2 font-medium">Actor</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((err) => {
            const nsColor = NAMESPACE_COLORS[err.namespace] ?? { text: 'text-gray-600', bg: 'bg-gray-50' };
            const errorMsg = err.error
              ? (typeof err.error === 'object' && 'message' in err.error
                  ? String(err.error.message)
                  : truncateJson(err.error, 100))
              : 'Unknown error';

            return (
              <tr key={err.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  <TimeAgo iso={err.createdAt} />
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${nsColor.text} ${nsColor.bg}`}>
                    {err.namespace}.{err.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-red-700 font-mono max-w-xs truncate">
                  {errorMsg}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                  {err.tenantId ? err.tenantId.slice(0, 8) + '...' : '-'}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {err.actorEmail ?? '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventVolumeChart({ data }: { data: EventVolumeRow[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
        No events in the last 24 hours
      </div>
    );
  }

  // Group by hour, stack by namespace
  const hourMap = new Map<string, Map<string, number>>();
  const allNamespaces = new Set<string>();

  for (const row of data) {
    allNamespaces.add(row.namespace);
    if (!hourMap.has(row.hour)) {
      hourMap.set(row.hour, new Map());
    }
    hourMap.get(row.hour)!.set(row.namespace, row.count);
  }

  const hours = Array.from(hourMap.keys()).sort();
  const namespaces = Array.from(allNamespaces).sort();

  // Find max total for scaling
  let maxTotal = 0;
  for (const nsMap of hourMap.values()) {
    let total = 0;
    for (const count of nsMap.values()) total += count;
    if (total > maxTotal) maxTotal = total;
  }

  if (maxTotal === 0) maxTotal = 1;

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {namespaces.map((ns) => {
          const color = NAMESPACE_COLORS[ns] ?? { bar: 'bg-gray-400', text: 'text-gray-600' };
          return (
            <div key={ns} className="flex items-center gap-1.5 text-xs">
              <span className={`inline-block w-3 h-3 rounded ${color.bar}`} />
              <span className={color.text}>{ns}</span>
            </div>
          );
        })}
      </div>

      {/* Bar chart */}
      {/* Scrolls rather than overflowing: twenty-four hourly bars plus their gaps are wider than
          a phone, and the page's MAIN is `overflow-x-clip`, so the most recent hours — the ones an
          operator actually wants — were the ones cut off. */}
      <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 160 }}>
        {hours.map((hour) => {
          const nsMap = hourMap.get(hour)!;
          let total = 0;
          for (const count of nsMap.values()) total += count;
          const heightPct = (total / maxTotal) * 100;

          return (
            <div
              key={hour}
              className="flex-1 flex flex-col justify-end group relative"
              style={{ height: '100%' }}
            >
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  <div className="font-medium">{formatHour(hour)}</div>
                  {namespaces.map((ns) => {
                    const count = nsMap.get(ns) ?? 0;
                    if (count === 0) return null;
                    return (
                      <div key={ns}>{ns}: {count}</div>
                    );
                  })}
                  <div className="font-medium border-t border-gray-700 mt-0.5 pt-0.5">Total: {total}</div>
                </div>
              </div>

              {/* Stacked bar */}
              <div
                className="w-full rounded-t overflow-hidden flex flex-col-reverse"
                style={{ height: `${heightPct}%`, minHeight: total > 0 ? 2 : 0 }}
              >
                {namespaces.map((ns) => {
                  const count = nsMap.get(ns) ?? 0;
                  if (count === 0) return null;
                  const segmentPct = (count / total) * 100;
                  const color = NAMESPACE_COLORS[ns] ?? { bar: 'bg-gray-400' };
                  return (
                    <div
                      key={ns}
                      className={`w-full ${color.bar}`}
                      style={{ height: `${segmentPct}%`, minHeight: 1 }}
                    />
                  );
                })}
              </div>

              {/* Hour label - show every 3rd to avoid overlap */}
              {hours.indexOf(hour) % 3 === 0 && (
                <div className="text-center mt-1">
                  <span className="text-xs text-gray-400 font-mono">{formatHour(hour)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Content Pipeline sub-components ─────────────────────────────────

const CONTENT_STATUS_COLORS: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-700',
  private: 'bg-purple-100 text-purple-700',
  archived: 'bg-gray-100 text-gray-500',
};

const CONTENT_EVENT_LABELS: Record<string, { label: string; color: string }> = {
  'content.page_published': { label: 'Published', color: 'bg-green-100 text-green-700' },
  'content.submitted_for_review': { label: 'Submitted', color: 'bg-yellow-100 text-yellow-700' },
  'content.approved': { label: 'Approved', color: 'bg-blue-100 text-blue-700' },
  'content.rejected': { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  'content.drafts_saved': { label: 'Draft Saved', color: 'bg-gray-100 text-gray-700' },
  'content.ai_generation_completed': { label: 'AI Generated', color: 'bg-purple-100 text-purple-700' },
};

function ContentPipelineSection({ data }: { data: ContentPipelineData }) {
  const published = data.blocksByStatus.find((s) => s.status === 'published')?.count ?? 0;
  const draft = data.blocksByStatus.find((s) => s.status === 'draft')?.count ?? 0;
  const pending = data.blocksByStatus.find((s) => s.status === 'pending')?.count ?? 0;
  const recentPublications = data.recentEvents.filter((e) => e.type === 'content.page_published').length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border-l-4 border-green-400 bg-green-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Published Blocks</p>
          <p className="text-2xl font-bold mt-1 text-green-700">{published}</p>
        </div>
        <div className="border-l-4 border-gray-400 bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Draft Blocks</p>
          <p className="text-2xl font-bold mt-1 text-gray-700">{draft}</p>
        </div>
        <div className="border-l-4 border-yellow-400 bg-yellow-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Pending Review</p>
          <p className={`text-2xl font-bold mt-1 ${pending > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>{pending}</p>
        </div>
        <div className="border-l-4 border-blue-400 bg-blue-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Recent Publications</p>
          <p className="text-2xl font-bold mt-1 text-blue-700">{recentPublications}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Per-page status */}
        <div className="border border-gray-200 rounded-lg bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Blocks by Status</h3>
          {data.blocksByStatus.length === 0 ? (
            <p className="text-sm text-gray-400">No content blocks found</p>
          ) : (
            <div className="space-y-2">
              {data.blocksByStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CONTENT_STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {s.status}
                  </span>
                  <span className="font-bold text-gray-700">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pages with pending reviews */}
        <div className="border border-gray-200 rounded-lg bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Pages with Pending Reviews</h3>
          {data.pendingByPage.length === 0 ? (
            <p className="text-sm text-gray-400">No pending reviews</p>
          ) : (
            <div className="space-y-2">
              {data.pendingByPage.map((p) => (
                <div key={p.page} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">{p.page}</span>
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                    {p.pendingCount} pending
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content Event Timeline */}
      <div className="border border-gray-200 rounded-lg bg-white">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Content Event Timeline (7d)</h3>
        </div>
        {data.recentEvents.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No content events in the last 7 days</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.recentEvents.map((evt) => {
              const evtMeta = CONTENT_EVENT_LABELS[evt.type] ?? { label: evt.type, color: 'bg-gray-100 text-gray-600' };
              const actor = evt.publishedBy || evt.submittedBy || '--';
              return (
                <div key={evt.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="text-xs text-gray-400 whitespace-nowrap w-16 flex-shrink-0">
                    <TimeAgo iso={evt.createdAt} />
                  </span>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${evtMeta.color}`}>
                    {evtMeta.label}
                  </span>
                  {evt.page && (
                    <span className="text-xs text-gray-600 font-medium">{evt.page}</span>
                  )}
                  {evt.blocksPublished && (
                    <span className="text-xs text-gray-500">{evt.blocksPublished} blocks</span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">{actor}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Email Automation sub-components ────────────────────────────────

const AUTOMATION_STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
};

const EMAIL_EVENT_LABELS: Record<string, { label: string; color: string }> = {
  'email.sent': { label: 'Sent', color: 'bg-green-100 text-green-700' },
  'email.approved': { label: 'Approved', color: 'bg-blue-100 text-blue-700' },
  'email.rejected': { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  'email.claimed': { label: 'Claimed', color: 'bg-yellow-100 text-yellow-700' },
  'action.send_email': { label: 'Send Email', color: 'bg-teal-100 text-teal-700' },
  'action.notify_admin': { label: 'Notify Admin', color: 'bg-purple-100 text-purple-700' },
  'action.enroll_drip': { label: 'Enroll Drip', color: 'bg-indigo-100 text-indigo-700' },
};

function EmailAutomationSection({ data }: { data: EmailAutomationData }) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const recentLogs = data.automationLogs.filter((l) => new Date(l.executedAt).getTime() > oneDayAgo);
  const rulesFired24h = recentLogs.length;
  const emailsSent = data.emailEvents.filter((e) => e.type === 'email.sent').length;
  const emailsPendingHitl = data.emailEvents.filter((e) => e.type === 'email.claimed').length;
  const failures = recentLogs.filter((l) => l.status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border-l-4 border-blue-400 bg-blue-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Rules Fired (24h)</p>
          <p className="text-2xl font-bold mt-1 text-blue-700">{rulesFired24h}</p>
        </div>
        <div className="border-l-4 border-green-400 bg-green-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Emails Sent</p>
          <p className="text-2xl font-bold mt-1 text-green-700">{emailsSent}</p>
        </div>
        <div className="border-l-4 border-yellow-400 bg-yellow-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase font-medium">Emails Pending HITL</p>
          <p className={`text-2xl font-bold mt-1 ${emailsPendingHitl > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>{emailsPendingHitl}</p>
        </div>
        <div className="border-l-4 rounded-lg p-3" style={{ borderColor: failures > 0 ? '#f87171' : '#d1d5db', backgroundColor: failures > 0 ? '#fef2f2' : '#f9fafb' }}>
          <p className="text-xs text-gray-500 uppercase font-medium">Failures (24h)</p>
          <p className={`text-2xl font-bold mt-1 ${failures > 0 ? 'text-red-700' : 'text-gray-400'}`}>{failures}</p>
        </div>
      </div>

      {/* Automation Rule Execution Log */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Automation Rule Execution Log</h3>
        </div>
        {data.automationLogs.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No automation executions recorded</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.automationLogs.map((log) => (
                <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    <TimeAgo iso={log.executedAt} />
                  </td>
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">
                    {log.ruleName}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                    {log.triggerNamespace}.{log.triggerType}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {log.actionType.replace(/_/g, ' ')}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${AUTOMATION_STATUS_COLORS[log.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-red-700 font-mono max-w-xs truncate">
                    {log.errorMessage ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Email Lifecycle Events */}
      <div className="border border-gray-200 rounded-lg bg-white">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Email Lifecycle Events (7d)</h3>
        </div>
        {data.emailEvents.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No email events in the last 7 days</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Phase</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.emailEvents.map((evt) => {
                const evtMeta = EMAIL_EVENT_LABELS[evt.type] ?? { label: evt.type, color: 'bg-gray-100 text-gray-600' };
                const details = evt.payload ? truncateJson(evt.payload, 100) : '';
                return (
                  <tr key={evt.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      <TimeAgo iso={evt.createdAt} />
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${evtMeta.color}`}>
                        {evtMeta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{evt.phase}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono max-w-xs truncate">
                      {details || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────

export function SystemStateClient({
  health,
  activeWorkflows,
  pipelineState,
  eventTrees,
  recentErrors,
  eventVolume,
  contentPipeline,
  emailAutomation,
}: {
  health: HealthSummary;
  activeWorkflows: ActiveWorkflow[];
  pipelineState: PipelineState;
  eventTrees: EventTreeNode[];
  recentErrors: ErrorEvent[];
  eventVolume: EventVolumeRow[];
  contentPipeline: ContentPipelineData;
  emailAutomation: EmailAutomationData;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  // Tick every second to update elapsed times
  useEffect(() => {
    if (activeWorkflows.length === 0) return;
    const id = setInterval(() => {
      setTick((t: number) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [activeWorkflows.length]);

  const toggleWorkflow = (id: string) => {
    setExpandedWorkflows((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNode = (id: string) => {
    setExpandedNodes((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAllTrees = () => {
    const allIds = new Set<string>();
    function collectIds(nodes: EventTreeNode[]) {
      for (const n of nodes) {
        allIds.add(n.id);
        collectIds(n.children);
      }
    }
    collectIds(eventTrees);
    setExpandedNodes(allIds);
  };

  const collapseAllTrees = () => {
    setExpandedNodes(new Set());
  };

  return (
    <div className="space-y-6">
      {/* Health Summary Bar — always visible */}
      <HealthBar health={health} />

      {/* Tab navigation */}
      {/* `overflow-x-auto`: at 390px the tab row is 506px wide and the page's MAIN is
          `overflow-x-clip`, so the last tabs were unreachable rather than merely off-screen. */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-0 -mb-px whitespace-nowrap">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.key === 'errors' && recentErrors.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold rounded-full bg-red-100 text-red-700">
                  {recentErrors.length}
                </span>
              )}
              {tab.key === 'workflows' && activeWorkflows.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold rounded-full bg-blue-100 text-blue-700">
                  {activeWorkflows.length}
                </span>
              )}
              {tab.key === 'content' && contentPipeline.pendingByPage.reduce((sum, p) => sum + p.pendingCount, 0) > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold rounded-full bg-yellow-100 text-yellow-700">
                  {contentPipeline.pendingByPage.reduce((sum, p) => sum + p.pendingCount, 0)}
                </span>
              )}
              {tab.key === 'email' && emailAutomation.automationLogs.filter((l) => l.status === 'failed' && (Date.now() - new Date(l.executedAt).getTime()) < 86_400_000).length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold rounded-full bg-red-100 text-red-700">
                  {emailAutomation.automationLogs.filter((l) => l.status === 'failed' && (Date.now() - new Date(l.executedAt).getTime()) < 86_400_000).length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Auto-refresh indicator */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Auto-refreshing every 30s
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Active Workflows Summary */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Active Workflows</h2>
              {activeWorkflows.length > 0 && (
                <button
                  onClick={() => setActiveTab('workflows')}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View all
                </button>
              )}
            </div>
            {activeWorkflows.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-400">
                No active workflows
              </div>
            ) : (
              <div className="space-y-2">
                {activeWorkflows.slice(0, 5).map((w) => (
                  <WorkflowCard
                    key={w.id}
                    workflow={w}
                    isExpanded={Boolean(expandedWorkflows.has(w.id))}
                    onToggle={() => toggleWorkflow(w.id)}
                  />
                ))}
                {activeWorkflows.length > 5 && (
                  <p className="text-sm text-gray-500 text-center py-2">
                    +{activeWorkflows.length - 5} more workflows
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Pipeline Summary */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Pipeline State</h2>
            <PipelineSection pipeline={pipelineState} />
          </section>

          {/* Recent Errors Summary */}
          {recentErrors.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  Recent Errors
                  <span className="ml-2 text-sm font-normal text-red-600">({recentErrors.length})</span>
                </h2>
                <button
                  onClick={() => setActiveTab('errors')}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View all
                </button>
              </div>
              <ErrorsTable errors={recentErrors.slice(0, 5)} />
            </section>
          )}

          {/* Event Volume */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Event Volume (24h)</h2>
              <button
                onClick={() => setActiveTab('volume')}
                className="text-sm text-blue-600 hover:underline"
              >
                Full chart
              </button>
            </div>
            <EventVolumeChart data={eventVolume} />
          </section>
        </div>
      )}

      {/* ── Workflows Tab ─────────────────────────────────────────── */}
      {activeTab === 'workflows' && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Active Workflows ({activeWorkflows.length})
          </h2>
          {activeWorkflows.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
              No active workflows
            </div>
          ) : (
            <div className="space-y-2">
              {activeWorkflows.map((w) => (
                <WorkflowCard
                  key={w.id}
                  workflow={w}
                  isExpanded={Boolean(expandedWorkflows.has(w.id))}
                  onToggle={() => toggleWorkflow(w.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Pipeline Tab ──────────────────────────────────────────── */}
      {activeTab === 'pipeline' && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Pipeline State</h2>
          <PipelineSection pipeline={pipelineState} />
        </section>
      )}

      {/* ── Content Pipeline Tab ────────────────────────────────────── */}
      {activeTab === 'content' && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Content Pipeline</h2>
          <ContentPipelineSection data={contentPipeline} />
        </section>
      )}

      {/* ── Email Automation Tab ─────────────────────────────────────── */}
      {activeTab === 'email' && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Email Automation</h2>
          <EmailAutomationSection data={emailAutomation} />
        </section>
      )}

      {/* ── Process Trees Tab ─────────────────────────────────────── */}
      {activeTab === 'trees' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">
              Process Flow Trees ({eventTrees.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={expandAllTrees}
                className="text-xs text-blue-600 hover:underline"
              >
                Expand all
              </button>
              <button
                onClick={collapseAllTrees}
                className="text-xs text-blue-600 hover:underline"
              >
                Collapse all
              </button>
            </div>
          </div>
          <ProcessTrees
            trees={eventTrees}
            expandedNodes={expandedNodes}
            toggleNode={toggleNode}
          />
        </section>
      )}

      {/* ── Errors Tab ────────────────────────────────────────────── */}
      {activeTab === 'errors' && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Recent Errors ({recentErrors.length})
          </h2>
          <ErrorsTable errors={recentErrors} />
        </section>
      )}

      {/* ── Event Volume Tab ──────────────────────────────────────── */}
      {activeTab === 'volume' && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Event Volume (24h)</h2>
          <EventVolumeChart data={eventVolume} />
        </section>
      )}
    </div>
  );
}
