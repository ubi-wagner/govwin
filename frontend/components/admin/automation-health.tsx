/**
 * Automation Health roll-up for /admin/automation (UI-gaps R2/R5/R11). The signals were
 * scattered (rule counts here, log under System State's mislabeled "Email Automation" tab,
 * workflow stats elsewhere, agent cost on /admin/agents) and, critically, agent spend was
 * never plotted against the ceiling the framework sets. This gives the admin one surface:
 * fires/errors/ToDos/workflows + agent-spend-vs-ceiling + a correctly-statused firings log.
 * Presentational (server-rendered from props).
 */

export interface AutomationHealthProps {
  logStatus: { success: number; error: number; deferred: number; skipped: number; running: number };
  openTodos: number;
  instances: { failed: number; active: number };
  agent: { spend: number; ceiling: number | null };
  firings: Array<{
    id: string; status: string; actionType: string; executedAt: string | null;
    ruleName: string | null; detail: string | null;
  }>;
}

// The engine writes success/deferred/skipped/error/running to automation_log — it NEVER writes
// 'failed' (mig 120), so the old system-state tab that counted status==='failed' under-reported.
// Here error + deferred are the failure-ish states.
const STATUS_STYLE: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  deferred: 'bg-amber-100 text-amber-700',
  skipped: 'bg-gray-100 text-gray-500',
  running: 'bg-blue-100 text-blue-700',
};

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`rounded-lg border p-4 ${tone === 'bad' ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === 'bad' ? 'text-rose-700' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

export function AutomationHealth({ logStatus, openTodos, instances, agent, firings }: AutomationHealthProps) {
  const errCount = logStatus.error + logStatus.deferred;
  const spendPct = agent.ceiling && agent.ceiling > 0 ? Math.min(100, Math.round((agent.spend / agent.ceiling) * 100)) : null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Automation health</h2>

      <div className="grid gap-3 sm:grid-cols-4 mb-4">
        <Tile label="Fired (24h)" value={logStatus.success} sub={`${logStatus.skipped} skipped`} />
        <Tile label="Errors (24h)" value={errCount} sub={`${logStatus.deferred} deferred`} tone={errCount > 0 ? 'bad' : 'ok'} />
        <Tile label="Open ToDos" value={openTodos} />
        <Tile label="Workflows running" value={instances.active} sub={`${instances.failed} failed`} tone={instances.failed > 0 ? 'bad' : 'ok'} />
      </div>

      {/* Agent spend vs the framework ceiling — the one number that tells an admin agents aren't running away. */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-semibold uppercase tracking-wide text-gray-400">Agent spend this month</span>
          <span className="text-gray-600">
            ${agent.spend.toFixed(2)}{agent.ceiling != null ? ` / $${agent.ceiling.toFixed(2)} ceiling` : ''}
          </span>
        </div>
        {spendPct != null ? (
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full ${spendPct >= 90 ? 'bg-rose-500' : spendPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${spendPct}%` }} />
          </div>
        ) : (
          <div className="text-[11px] text-gray-400">No ceiling set on the framework.</div>
        )}
      </div>

      {/* Recent firings — automation_log finally has a real home (was buried + mis-statused). */}
      <div id="firings">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Recent firings</div>
        {firings.length === 0 ? (
          <div className="text-sm text-gray-400 py-2">No automation firings recorded yet.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {firings.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <div className="min-w-0 flex items-baseline gap-2">
                  <span className="text-gray-800 shrink-0">{f.ruleName ?? f.actionType}</span>
                  {f.detail && <span className="text-[11px] text-gray-400 truncate">{f.detail}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[f.status] ?? 'bg-gray-100 text-gray-500'}`}>{f.status}</span>
                  <span className="text-[11px] text-gray-400">{f.executedAt ? new Date(f.executedAt).toLocaleString() : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
