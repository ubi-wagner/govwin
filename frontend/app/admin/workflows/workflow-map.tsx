'use client';

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowMap — the "see every workflow, organised by spine" surface.
//
// It supersedes the old flat Workflow Catalog: the roster of all 29 registered
// workflows, grouped into the two lifecycle spines (discovery/finder ·
// build/capture) plus the platform lane, each rendered as a step-kind ribbon
// that expands into the full DAG (WorkflowGraph). Live counts + the
// activate/deactivate switch are merged in from /api/admin/workflows/templates
// (process_templates); a workflow the boot-sync hasn't written yet still shows
// its designed flow (from the code-defined shape catalog) with a "designed" tag.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  WORKFLOW_SHAPES,
  SPINES,
  buildGraph,
  triggerType,
  type WorkflowShape,
} from './workflow-shapes';
import { WorkflowGraph, WorkflowGraphLegend, type StepKind } from './workflow-graph';

interface TemplateRow {
  workflowName: string;
  active: boolean;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  total: number;
  inactivatedBy: string | null;
}

const KIND_DOT: Record<StepKind, string> = {
  TRIGGER: 'bg-indigo-400',
  ACTION: 'bg-slate-400',
  AI_INVOKE: 'bg-purple-400',
  API_CALL: 'bg-cyan-400',
  TODO: 'bg-amber-400',
  HITL_WAIT: 'bg-amber-400',
  NOTIFY: 'bg-blue-400',
  CONDITION: 'bg-teal-400',
  END: 'bg-green-500',
};

const LAUNCH_BADGE: Record<WorkflowShape['launch'], { label: string; cls: string }> = {
  event: { label: 'event-triggered', cls: 'bg-slate-100 text-slate-600' },
  imperative: { label: 'launched', cls: 'bg-purple-100 text-purple-700' },
  scheduled: { label: 'scheduled', cls: 'bg-cyan-100 text-cyan-700' },
};

function CountChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  if (!value) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${tone}`}>
      <span className="font-bold">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

function WorkflowRow({
  shape,
  row,
  expanded,
  onToggleExpand,
  onToggleActive,
  toggling,
}: {
  shape: WorkflowShape;
  row: TemplateRow | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleActive: (next: boolean) => void;
  toggling: boolean;
}) {
  const synced = !!row;
  const active = row?.active ?? false;
  const badge = LAUNCH_BADGE[shape.launch];
  // Only lay out the full DAG when the row is expanded (cheap, but avoids doing
  // it for all 29 rows on every live-refresh render).
  const graph = expanded ? buildGraph(shape) : null;

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white border-l-4 ${
        !synced ? 'border-l-gray-200' : active ? 'border-l-green-500' : 'border-l-gray-300'
      }`}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900">{shape.title}</span>
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
              {synced ? (
                !active && (
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[11px] font-medium">inactive</span>
                )
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-400 text-[11px] font-medium" title="Designed in code; the pipeline boot-sync writes it to process_templates on deploy.">
                  designed
                </span>
              )}
              <code className="text-[11px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded font-mono">{shape.trigger}</code>
            </div>
            <p className="mt-1 text-sm text-gray-600">{shape.description}</p>

            {/* Step-kind ribbon — a compact always-on visual of the flow */}
            <button
              type="button"
              onClick={onToggleExpand}
              className="mt-2 flex items-center gap-1 flex-wrap text-left hover:opacity-80"
              title="View the full flow"
            >
              <span className={`inline-flex h-3 w-3 rounded-full ${KIND_DOT.TRIGGER}`} title={`trigger: ${triggerType(shape.trigger)}`} />
              <span className="text-gray-300 text-xs">›</span>
              {shape.steps.map((s, i) => (
                <span key={s.name} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-gray-200 text-xs">·</span>}
                  <span className={`inline-flex h-3 w-3 rounded-full ${KIND_DOT[s.kind]}`} title={`${s.name} (${s.kind})`} />
                </span>
              ))}
              <span className="text-gray-300 text-xs">›</span>
              <span className={`inline-flex h-3 w-3 rounded-full ${KIND_DOT.END}`} title="complete" />
              <span className="ml-1.5 text-xs text-gray-400">
                {shape.steps.length} step{shape.steps.length === 1 ? '' : 's'} · {expanded ? 'hide flow ▲' : 'view flow ▼'}
              </span>
            </button>

            {/* Live rollup */}
            {row && (row.running || row.paused || row.completed || row.failed) ? (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <CountChip label="running" value={row.running} tone="bg-blue-50 text-blue-700" />
                <CountChip label="paused" value={row.paused} tone="bg-yellow-50 text-yellow-700" />
                <CountChip label="done" value={row.completed} tone="bg-green-50 text-green-700" />
                <CountChip label="failed" value={row.failed} tone="bg-red-50 text-red-700" />
              </div>
            ) : null}
          </div>

          {/* Activation switch — only for templates the sync has written */}
          {synced && (
            <button
              type="button"
              disabled={toggling}
              onClick={() => onToggleActive(!active)}
              className={`flex-shrink-0 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 ${
                active
                  ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {toggling ? '…' : active ? 'Deactivate' : 'Activate'}
            </button>
          )}
        </div>

        {/* Expanded full DAG */}
        {expanded && graph && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <WorkflowGraph nodes={graph.nodes} edges={graph.edges} />
            <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
              <WorkflowGraphLegend />
              <span className="text-[11px] text-gray-400">
                {shape.launch === 'event'
                  ? `Fires automatically on ${triggerType(shape.trigger)}.`
                  : shape.launch === 'scheduled'
                    ? 'Fired on a cron schedule by the pipeline.'
                    : 'Launched on demand (a launcher below or a product action emits the trigger).'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkflowMap() {
  const [rows, setRows] = useState<Record<string, TemplateRow>>({});
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workflows/templates');
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.data?.templates)) {
        const map: Record<string, TemplateRow> = {};
        for (const t of body.data.templates as TemplateRow[]) map[t.workflowName] = t;
        setRows(map);
        setError(null);
      } else if (!res.ok) {
        setError(body?.error ?? 'Failed to load live template state');
      }
    } catch {
      setError('Network error loading live template state');
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggleActive = useCallback(
    async (name: string, next: boolean) => {
      setToggling((p) => ({ ...p, [name]: true }));
      setRows((prev) => (prev[name] ? { ...prev, [name]: { ...prev[name], active: next } } : prev));
      try {
        const res = await fetch('/api/admin/workflows/templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowName: name, active: next }),
        });
        if (!res.ok) {
          setRows((prev) => (prev[name] ? { ...prev, [name]: { ...prev[name], active: !next } } : prev));
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? 'Toggle failed');
        } else {
          setError(null);
          void load();
        }
      } catch {
        setRows((prev) => (prev[name] ? { ...prev, [name]: { ...prev[name], active: !next } } : prev));
        setError('Network error');
      } finally {
        setToggling((p) => ({ ...p, [name]: false }));
      }
    },
    [load],
  );

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const total = WORKFLOW_SHAPES.length;
  const syncedCount = Object.keys(rows).length;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-lg font-semibold text-gray-900">Workflow Map</span>
          <span className="text-sm text-gray-500">
            {total} workflows · discovery + build spines + platform{syncedCount ? ` · ${syncedCount} synced` : ''}
          </span>
        </span>
        <span className="text-gray-400 text-sm">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-6">
          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{error}</div>
          )}
          {SPINES.map((spine) => {
            const shapes = WORKFLOW_SHAPES.filter((s) => s.spine === spine.key);
            return (
              <div key={spine.key}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-gray-900">{spine.title}</h3>
                  <span className="text-xs text-gray-400">{shapes.length} workflows</span>
                </div>
                <p className="mt-0.5 mb-2 text-sm text-gray-500">{spine.blurb}</p>
                <div className="space-y-2">
                  {shapes.map((shape) => (
                    <WorkflowRow
                      key={shape.workflowName}
                      shape={shape}
                      row={rows[shape.workflowName]}
                      expanded={expanded.has(shape.workflowName)}
                      onToggleExpand={() => toggleExpand(shape.workflowName)}
                      onToggleActive={(next) => toggleActive(shape.workflowName, next)}
                      toggling={toggling[shape.workflowName] ?? false}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 px-1">
            The flow of each workflow is code-defined (pipeline/src/workflows) and mirrored here; the boot-sync writes
            name/trigger/active to the catalog. Deactivating refuses new launches (running instances finish) and is
            audited to the event stream.
          </p>
        </div>
      )}
    </section>
  );
}
