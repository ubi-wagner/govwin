'use client';

import { useCallback, useEffect, useState } from 'react';

// The workflow TEMPLATE CATALOG — the roster of every workflow the running build defines
// (process_templates, code-synced at pipeline boot), with a per-template instance rollup
// and the activation switch that gates whether new instances launch. This is the "see
// every workflow" surface that complements the live-instance monitor below it.

interface TemplateRow {
  workflowName: string;
  description: string | null;
  triggerKey: string | null;
  source: string | null;
  active: boolean;
  activeDate: string | null;
  inactiveDate: string | null;
  inactivatedBy: string | null;
  lastSeenAt: string | null;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  total: number;
  lastLaunchedAt: string | null;
}

function prettyName(name: string): string {
  return name.replace(/^On/, '').replace(/([A-Z])/g, ' $1').trim();
}

function CountChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  if (!value) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${tone}`}>
      <span className="font-bold">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

export function WorkflowCatalog() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workflows/templates');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load catalog');
        return;
      }
      setTemplates(Array.isArray(body?.data?.templates) ? body.data.templates : []);
      setError(null);
    } catch {
      setError('Network error loading catalog');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (name: string, nextActive: boolean) => {
      setToggling((p) => ({ ...p, [name]: true }));
      // Optimistic flip; reconcile from the server response.
      setTemplates((prev) =>
        prev ? prev.map((t) => (t.workflowName === name ? { ...t, active: nextActive } : t)) : prev,
      );
      try {
        const res = await fetch('/api/admin/workflows/templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowName: name, active: nextActive }),
        });
        if (!res.ok) {
          // Revert on failure.
          setTemplates((prev) =>
            prev ? prev.map((t) => (t.workflowName === name ? { ...t, active: !nextActive } : t)) : prev,
          );
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? 'Toggle failed');
        } else {
          setError(null);
          void load();
        }
      } catch {
        setTemplates((prev) =>
          prev ? prev.map((t) => (t.workflowName === name ? { ...t, active: !nextActive } : t)) : prev,
        );
        setError('Network error');
      } finally {
        setToggling((p) => ({ ...p, [name]: false }));
      }
    },
    [load],
  );

  const activeCount = templates?.filter((t) => t.active).length ?? 0;
  const total = templates?.length ?? 0;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-900">Workflow Catalog</span>
          <span className="text-sm text-gray-500">
            {total} template{total === 1 ? '' : 's'} · {activeCount} active
          </span>
        </span>
        <span className="text-gray-400 text-sm">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
          {templates === null ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
              Loading catalog…
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
              No templates in the catalog yet — the pipeline syncs them on boot.
            </div>
          ) : (
            templates.map((t) => (
              <div
                key={t.workflowName}
                className={`rounded-lg border border-gray-200 bg-white p-3 border-l-4 ${
                  t.active ? 'border-l-green-500' : 'border-l-gray-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                          t.active ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                        aria-hidden
                      />
                      <span className="font-medium text-gray-900">{prettyName(t.workflowName)}</span>
                      {!t.active && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-medium">
                          inactive
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="mt-0.5 text-sm text-gray-600">{t.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {t.triggerKey && (
                        <code className="text-xs text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded font-mono">
                          {t.triggerKey}
                        </code>
                      )}
                      <CountChip label="running" value={t.running} tone="bg-blue-50 text-blue-700" />
                      <CountChip label="paused" value={t.paused} tone="bg-yellow-50 text-yellow-700" />
                      <CountChip label="done" value={t.completed} tone="bg-green-50 text-green-700" />
                      <CountChip label="failed" value={t.failed} tone="bg-red-50 text-red-700" />
                      {t.total === 0 && (
                        <span className="text-xs text-gray-400">no instances yet</span>
                      )}
                    </div>
                    {!t.active && t.inactivatedBy && (
                      <p className="mt-1 text-xs text-gray-400">
                        deactivated by {t.inactivatedBy}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={toggling[t.workflowName]}
                    onClick={() => toggle(t.workflowName, !t.active)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 ${
                      t.active
                        ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {toggling[t.workflowName] ? '…' : t.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-gray-400 px-1">
            Deactivating a template refuses new launches (existing instances finish); the toggle
            is audited to the event stream. Templates are code-defined and re-synced on deploy.
          </p>
        </div>
      )}
    </section>
  );
}
