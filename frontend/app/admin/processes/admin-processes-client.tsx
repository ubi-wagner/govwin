'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  filterAndSortProcesses,
  type ProcessHealth,
} from '@/lib/process/health';

export interface AdminProcessRow {
  id: string;
  workflowName: string;
  status: string;
  currentStep: string | null;
  deadline: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  lastErrorStep: string | null;
  updatedAt: string | null;
  tenantId: string | null;
  tenantName: string | null;
  openTasks: number;
}

const HEALTH_STYLE: Record<ProcessHealth, { dot: string; chip: string; label: string }> = {
  failing: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'Failing' },
  stalled: { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Stalled' },
  waiting: { dot: 'bg-yellow-500', chip: 'bg-yellow-50 text-yellow-800 border-yellow-200', label: 'Awaiting' },
  running: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Running' },
  done: { dot: 'bg-gray-400', chip: 'bg-gray-50 text-gray-600 border-gray-200', label: 'Done' },
};

function fmtWorkflow(n: string) {
  return n.replace(/^On/, '').replace(/([A-Z])/g, ' $1').trim();
}
function fmtStep(n: string | null) {
  return n ? n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}
function rel(iso: string | null) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

const HEALTH_OPTIONS: Array<ProcessHealth | 'all'> = ['all', 'failing', 'stalled', 'waiting', 'running'];

export function AdminProcessesClient({
  rows,
  loadError,
}: {
  rows: AdminProcessRow[];
  loadError: boolean;
}) {
  const router = useRouter();
  const [tenant, setTenant] = useState<string>('all');
  const [health, setHealth] = useState<ProcessHealth | 'all'>('all');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Tenant filter options from the data.
  const tenants = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const id = r.tenantId ?? '__admin__';
      m.set(id, r.tenantName ?? (r.tenantId ? r.tenantId.slice(0, 8) : 'Admin / system'));
    }
    return Array.from(m.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    const tenantId = tenant === 'all' ? null : tenant === '__admin__' ? null : tenant;
    // '__admin__' means tenantId IS NULL — handle explicitly since the helper's
    // null means "all". For the admin bucket, post-filter to null tenants.
    let out = filterAndSortProcesses(rows, { tenantId, health });
    if (tenant === '__admin__') out = out.filter((r) => (r.tenantId ?? null) === null);
    return out;
  }, [rows, tenant, health]);

  const counts = useMemo(() => {
    const c: Record<ProcessHealth, number> = { failing: 0, stalled: 0, waiting: 0, running: 0, done: 0 };
    for (const r of filterAndSortProcesses(rows, {})) c[r.health] += 1;
    return c;
  }, [rows]);

  const advance = useCallback(
    async (id: string, step: string | null) => {
      if (!window.confirm(`Advance the "${fmtStep(step)}" gate to the next step?`)) return;
      setBusy((p) => ({ ...p, [id]: true }));
      setErrors((p) => { const n = { ...p }; delete n[id]; return n; });
      try {
        const res = await fetch(`/api/admin/workflows/${id}/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'Advanced from the admin process ledger' }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: 'Failed' }));
          setErrors((p) => ({ ...p, [id]: j.error ?? 'Advance failed' }));
        } else {
          router.refresh();
        }
      } catch {
        setErrors((p) => ({ ...p, [id]: 'Network error' }));
      } finally {
        setBusy((p) => ({ ...p, [id]: false }));
      }
    },
    [router],
  );

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Couldn&apos;t load processes — system error, not an empty list. Retry shortly.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters + summary */}
      <div className="flex flex-wrap items-center gap-2">
        {(['failing', 'stalled', 'waiting', 'running'] as ProcessHealth[])
          .filter((h) => counts[h] > 0)
          .map((h) => (
            <button
              key={h}
              onClick={() => setHealth(health === h ? 'all' : h)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${HEALTH_STYLE[h].chip} ${health === h ? 'ring-2 ring-offset-1 ring-gray-300' : ''}`}
            >
              <span className={`h-2 w-2 rounded-full ${HEALTH_STYLE[h].dot}`} />
              {HEALTH_STYLE[h].label} {counts[h]}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          <select
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          >
            <option value="all">All tenants</option>
            {tenants.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          {health !== 'all' && (
            <button onClick={() => setHealth('all')} className="text-blue-600 hover:underline">
              clear filter
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          No active processes match.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <th className="px-3 py-2 font-medium">Health</th>
                <th className="px-3 py-2 font-medium">Tenant</th>
                <th className="px-3 py-2 font-medium">Process</th>
                <th className="px-3 py-2 font-medium">Step</th>
                <th className="px-3 py-2 font-medium">Tasks</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const style = HEALTH_STYLE[r.health];
                return (
                  <tr key={r.id} className={r.health === 'failing' ? 'bg-red-50/40' : ''}>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.chip}`}>
                        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.tenantName ?? <span className="text-gray-400">admin/system</span>}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{fmtWorkflow(r.workflowName)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{fmtStep(r.currentStep)}</td>
                    <td className="px-3 py-2 text-gray-600">{r.openTasks > 0 ? r.openTasks : '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{rel(r.updatedAt)} ago</td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'paused' && (
                        <button
                          onClick={() => advance(r.id, r.currentStep)}
                          disabled={busy[r.id]}
                          className="rounded border border-yellow-400 bg-white px-2 py-1 text-xs font-medium text-yellow-800 hover:bg-yellow-50 disabled:opacity-50"
                        >
                          {busy[r.id] ? '…' : 'Advance'}
                        </button>
                      )}
                      {errors[r.id] && <span className="ml-2 text-xs text-red-600">{errors[r.id]}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
