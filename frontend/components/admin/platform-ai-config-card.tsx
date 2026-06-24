'use client';

import { useEffect, useState } from 'react';

interface PlatformConfig {
  defaultMonthlyBudget: number;
  defaultRateLimitPerHour: number;
  platformMonthlyCap: number | null;
  aiEnabled: boolean;
}

/**
 * Pipeline-wide AI controls (master_admin only). Edits the singleton
 * platform_agent_config: defaults applied to tenants without an override, a
 * hard platform-wide monthly spend cap, and the master AI on/off switch.
 */
export function PlatformAiConfigCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [budget, setBudget] = useState('');
  const [rate, setRate] = useState('');
  const [capEnabled, setCapEnabled] = useState(false);
  const [cap, setCap] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);

  function applyConfig(c: PlatformConfig) {
    setBudget(String(c.defaultMonthlyBudget));
    setRate(String(c.defaultRateLimitPerHour));
    setCapEnabled(c.platformMonthlyCap != null);
    setCap(c.platformMonthlyCap != null ? String(c.platformMonthlyCap) : '');
    setAiEnabled(c.aiEnabled);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/agents/platform-config');
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed to load platform config' }));
          if (!cancelled) setError(json.error || 'Failed to load platform config');
          return;
        }
        const json = await res.json();
        if (!cancelled && json.data) applyConfig(json.data as PlatformConfig);
      } catch {
        if (!cancelled) setError('Network error loading platform config');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setError(null);
    setNotice(null);

    const budgetNum = Number(budget);
    const rateNum = Number(rate);
    const capNum = Number(cap);
    if (!Number.isFinite(budgetNum) || budgetNum < 0) {
      setError('Default monthly budget must be a non-negative number.');
      return;
    }
    if (!Number.isInteger(rateNum) || rateNum < 1) {
      setError('Default rate limit must be a whole number ≥ 1.');
      return;
    }
    if (capEnabled && (!Number.isFinite(capNum) || capNum < 0)) {
      setError('Platform cap must be a non-negative number.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/agents/platform-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultMonthlyBudget: budgetNum,
          defaultRateLimitPerHour: rateNum,
          platformMonthlyCap: capEnabled ? capNum : null,
          aiEnabled,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Failed to save');
        return;
      }
      if (json.data) applyConfig(json.data as PlatformConfig);
      setNotice('Saved.');
    } catch {
      setError('Network error while saving');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-400 py-4">Loading pipeline AI settings…</div>;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-2xl">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-base font-semibold">Pipeline AI Defaults &amp; Cap</h3>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span className={aiEnabled ? 'text-green-700' : 'text-red-600 font-medium'}>
            AI {aiEnabled ? 'enabled' : 'disabled'}
          </span>
        </label>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Applies to every tenant without an explicit override. The cap is an absolute
        ceiling on total monthly AI spend across all tenants and admin/system tasks.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Default monthly budget ($ / tenant)</span>
          <input
            type="number" min="0" step="0.01" value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Default rate limit (calls / hour / tenant)</span>
          <input
            type="number" min="1" step="1" value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-4">
        <label className="inline-flex items-center gap-2 text-sm mb-1">
          <input
            type="checkbox"
            checked={capEnabled}
            onChange={(e) => setCapEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-gray-700">Enforce a platform-wide monthly cap</span>
        </label>
        <input
          type="number" min="0" step="0.01" value={cap} disabled={!capEnabled}
          placeholder="e.g. 1500.00"
          onChange={(e) => setCap(e.target.value)}
          className="mt-1 w-full sm:w-1/2 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {notice && <span className="text-sm text-green-600">{notice}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
