'use client';

/**
 * Admin — Template Stable (template bridge Phase 3, docs/TEMPLATE_BRIDGE_DESIGN.md).
 *
 * The master roster behind the tenant-owned template shelves. Shows each master's
 * bridge head version + fan-out REACH (how many tenants carry the latest), and lets
 * an admin PUSH new/changed catalog templates out ("Sync from catalog") or version-up
 * a single master ("Push") — the forward-only write side of the bridge.
 *
 * Route: /admin/template-stable
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

interface MasterRow {
  id: string;
  templateKey: string;
  title: string;
  category: string;
  agency: string | null;
  format: string;
  version: number;
  status: string;
  bridgeVersion: number;
  tenantsTotal: number;
  tenantsCurrent: number;
}

interface SyncResult {
  key: string; title: string; action: 'created' | 'updated' | 'unchanged' | 'error';
  version?: number; tenantsApplied?: number; error?: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  dod_dow: 'DoD / DoW', nsf: 'NSF', doe: 'DOE', nasa: 'NASA', nih: 'NIH',
  marketing: 'Marketing', commercialization: 'Commercialization', investment: 'Investment',
  tech: 'Tech Overviews', company: 'Company', grants: 'Grants', forms: 'Proposal Forms',
};

const FORMAT_BADGE: Record<string, { label: string; cls: string }> = {
  document: { label: 'DOC', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  deck: { label: 'DECK', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  spreadsheet: { label: 'SHEET', cls: 'bg-green-50 text-green-700 border-green-200' },
};

export default function AdminTemplateStablePage() {
  const [masters, setMasters] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/template-stable');
      const json = await res.json();
      if (res.ok) setMasters((json.data?.masters ?? []) as MasterRow[]);
      else setError(json.error ?? 'Could not load the stable');
    } catch {
      setError('Could not load the stable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sync = useCallback(async () => {
    setSyncing(true); setNotice(null); setError(null);
    try {
      const res = await fetch('/api/admin/template-stable/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed');
      const s = json.data?.summary ?? {};
      const parts: string[] = [];
      if (s.created) parts.push(`${s.created} new`);
      if (s.updated) parts.push(`${s.updated} versioned-up`);
      if (s.unchanged) parts.push(`${s.unchanged} unchanged`);
      if (s.errored) parts.push(`${s.errored} errored`);
      setNotice(`Sync complete — ${parts.join(' · ') || 'nothing to do'}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const push = useCallback(async (m: MasterRow) => {
    setPushingId(m.id); setNotice(null); setError(null);
    try {
      const res = await fetch(`/api/admin/template-stable/${m.id}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'republished' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Push failed');
      setNotice(`Pushed “${m.title}” → v${json.data.version} to ${json.data.tenantsApplied} tenant(s).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setPushingId(null);
    }
  }, [load]);

  const grouped = useMemo(() => {
    const by = new Map<string, MasterRow[]>();
    for (const m of masters) { if (!by.has(m.category)) by.set(m.category, []); by.get(m.category)!.push(m); }
    return Array.from(by.entries()).sort((a, b) => (CATEGORY_LABEL[a[0]] ?? a[0]).localeCompare(CATEGORY_LABEL[b[0]] ?? b[0]));
  }, [masters]);

  const totalReach = useMemo(() => {
    const behind = masters.filter((m) => m.tenantsTotal > 0 && m.tenantsCurrent < m.tenantsTotal).length;
    return { count: masters.length, behind };
  }, [masters]);

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Template Stable</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            The forward-only master roster behind every tenant&apos;s owned template shelf. Each master
            fans out to all tenants as a copy; pushing a new version lands it forward (existing
            documents untouched). {totalReach.count} masters{totalReach.behind ? ` · ${totalReach.behind} with tenants behind` : ''}.
          </p>
        </div>
        <button onClick={sync} disabled={syncing} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 whitespace-nowrap">
          {syncing ? 'Syncing…' : 'Sync from catalog'}
        </button>
      </div>

      {notice && <p className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}
      {error && <p className="mb-3 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
      {loading && <p className="text-sm text-gray-400 py-10 text-center">Loading the stable…</p>}
      {!loading && masters.length === 0 && !error && (
        <div className="border rounded-lg bg-gray-50 py-10 text-center">
          <p className="text-sm text-gray-500">No masters yet — click “Sync from catalog” to seed the stable.</p>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([category, list]) => (
          <section key={category}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {CATEGORY_LABEL[category] ?? category} <span className="text-gray-300">· {list.length}</span>
            </h2>
            <div className="space-y-2">
              {list.map((m) => {
                const badge = FORMAT_BADGE[m.format] ?? { label: m.format.toUpperCase(), cls: 'bg-gray-50 text-gray-600 border-gray-200' };
                const behind = m.tenantsTotal > 0 && m.tenantsCurrent < m.tenantsTotal;
                return (
                  <div key={m.id} className="flex items-center gap-4 p-3 bg-white border rounded-lg">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${badge.cls}`}>{badge.label}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{m.title}</span>
                        {m.agency && <span className="text-[11px] text-gray-400">{m.agency}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400 font-mono">
                        <span>master v{m.version}</span>
                        <span>bridge v{m.bridgeVersion}</span>
                        <span className={behind ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                          {m.tenantsCurrent}/{m.tenantsTotal} tenants current
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => push(m)}
                      disabled={pushingId === m.id}
                      className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {pushingId === m.id ? 'Pushing…' : 'Push new version'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
