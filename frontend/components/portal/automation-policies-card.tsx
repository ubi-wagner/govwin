'use client';

/**
 * The tenant Automation grammar editor (#190 Phase D2). Upgrades the old 6-boolean
 * card to the per-trigger grammar: recipients × timing × escalation × channel, over the
 * fixed TRIGGER_CATALOG, grouped Discovery / Build. The escalation FLOOR (you the admin,
 * always, + managers) is shown as a locked, non-removable chip (decision ①). Reads/writes
 * /api/portal/[slug]/automation-policies.
 */
import { useEffect, useState, useCallback } from 'react';

interface PolicyRow {
  enabled: boolean;
  recipientRoles: string[];
  recipientFlags: string[];
  nudgeDays: number[];
  dueInMinutes: number | null;
  channel: string;
}
interface CatalogItem {
  scope: 'discovery' | 'build';
  triggerKey: string;
  label: string;
  help: string;
  agentCapable?: boolean;
  configured: boolean;
  row: PolicyRow | null;
}

const ROLE_OPTIONS = [
  { key: 'tenant_admin', label: 'Admins' },
  { key: 'tenant_user', label: 'Team' },
  { key: 'partner_user', label: 'Collaborators' },
];
const FLAG_OPTIONS = [
  { key: 'delegated_managers', label: 'Delegated managers' },
  { key: 'collaborators_at_stage', label: 'Stage collaborators' },
];

function defaults(item: CatalogItem): PolicyRow {
  return (
    item.row ?? {
      enabled: true,
      recipientRoles: ['tenant_admin'],
      recipientFlags: [],
      nudgeDays: [1, 3],
      dueInMinutes: null,
      channel: 'email',
    }
  );
}

export function AutomationPoliciesCard({ tenantSlug }: { tenantSlug: string }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [draft, setDraft] = useState<Record<string, PolicyRow>>({});
  // Raw nudge-days text per trigger, so typing "1, 3" isn't stripped by re-deriving the
  // input value from the parsed array on every keystroke (adversarial-sweep LOW-2).
  const [nudgeText, setNudgeText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/automation-policies`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: 'Failed to load' }));
          if (!cancelled) setError(j.error || 'Failed to load automation policies');
          return;
        }
        const j = await res.json();
        const list = j.data.policies as CatalogItem[];
        if (cancelled) return;
        setItems(list);
        setDraft(Object.fromEntries(list.map((i) => [i.triggerKey, defaults(i)])));
        setNudgeText(Object.fromEntries(list.map((i) => [i.triggerKey, defaults(i).nudgeDays.join(', ')])));
      } catch {
        if (!cancelled) setError('Network error loading automation policies');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const update = useCallback((key: string, patch: Partial<PolicyRow>) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
    setSavedKey(null);
  }, []);

  const save = useCallback(async (item: CatalogItem) => {
    const row = draft[item.triggerKey];
    setSavingKey(item.triggerKey); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/automation-policies`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: item.scope, triggerKey: item.triggerKey, ...row }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Failed to save' }));
        setError(j.error || 'Failed to save'); return;
      }
      setSavedKey(item.triggerKey);
    } catch {
      setError('Network error saving policy');
    } finally {
      setSavingKey(null);
    }
  }, [draft, tenantSlug]);

  if (loading) return <div className="text-sm text-gray-400 py-6">Loading automation policies…</div>;
  if (error && items.length === 0) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</div>;

  const groups: Array<{ scope: 'discovery' | 'build'; title: string; sub: string }> = [
    { scope: 'discovery', title: 'Discovery', sub: 'Alerts as opportunities appear and approach their close date.' },
    { scope: 'build', title: 'Build', sub: 'The gates, reviews, and nudges while a proposal is being built.' },
  ];

  return (
    <div className="space-y-6">
      {/* The escalation floor — locked, non-removable (decision ①). */}
      <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
        <span className="text-lg leading-none mt-0.5">🔒</span>
        <p className="text-sm text-rose-800">
          <span className="font-semibold">You (admin) always get the final notice.</span> Add managers to
          share it — but the last escalation can never be switched off. If no one&apos;s active, it reaches RFP Pipeline.
        </p>
      </div>

      {groups.map((g) => {
        const rows = items.filter((i) => i.scope === g.scope);
        if (rows.length === 0) return null;
        return (
          <div key={g.scope} className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900">{g.title}</h2>
            <p className="text-xs text-gray-500 mb-4">{g.sub}</p>
            <div className="space-y-4">
              {rows.map((item) => {
                const row = draft[item.triggerKey];
                if (!row) return null;
                const savedNow = savedKey === item.triggerKey;
                return (
                  <div key={item.triggerKey} className="rounded-md border border-gray-200 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={row.enabled}
                        onChange={(e) => update(item.triggerKey, { enabled: e.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-800">
                          {item.label}
                          {item.agentCapable && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 align-middle">AI-capable</span>}
                        </span>
                        <span className="block text-xs text-gray-500">{item.help}</span>
                      </span>
                    </label>

                    {row.enabled && (
                      <div className="mt-3 pl-7 grid gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Who</div>
                          <div className="flex flex-wrap gap-1.5">
                            {ROLE_OPTIONS.map((o) => {
                              const on = row.recipientRoles.includes(o.key);
                              return (
                                <button key={o.key} type="button"
                                  onClick={() => update(item.triggerKey, { recipientRoles: on ? row.recipientRoles.filter((x) => x !== o.key) : [...row.recipientRoles, o.key] })}
                                  className={`rounded-full px-2.5 py-1 text-xs border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                                  {o.label}
                                </button>
                              );
                            })}
                            {FLAG_OPTIONS.map((o) => {
                              const on = row.recipientFlags.includes(o.key);
                              return (
                                <button key={o.key} type="button"
                                  onClick={() => update(item.triggerKey, { recipientFlags: on ? row.recipientFlags.filter((x) => x !== o.key) : [...row.recipientFlags, o.key] })}
                                  className={`rounded-full px-2.5 py-1 text-xs border ${on ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                                  {o.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Escalate — nudge days</div>
                          <input type="text" value={nudgeText[item.triggerKey] ?? ''}
                            onChange={(e) => {
                              setNudgeText((m) => ({ ...m, [item.triggerKey]: e.target.value }));
                              update(item.triggerKey, { nudgeDays: e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 3) });
                            }}
                            placeholder="1, 3"
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none" />
                          <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">How</div>
                          <select value={row.channel} onChange={(e) => update(item.triggerKey, { channel: e.target.value })}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none">
                            <option value="email">Email</option>
                            <option value="todo">In-app ToDo</option>
                            <option value="both">Both</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 pl-7 flex items-center gap-3">
                      <button onClick={() => save(item)} disabled={savingKey === item.triggerKey}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        {savingKey === item.triggerKey ? 'Saving…' : 'Save'}
                      </button>
                      {savedNow && <span className="text-[11px] text-green-600">Saved</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && <div className="text-sm text-red-600">{error}</div>}
    </div>
  );
}
