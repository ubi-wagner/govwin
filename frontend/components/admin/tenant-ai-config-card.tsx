'use client';

import { useState } from 'react';

interface Props {
  tenantId: string;
  initialMonthlyBudget: number | null;
  initialRateLimitPerHour: number | null;
  defaultMonthlyBudget: number;
  defaultRateLimitPerHour: number;
}

/**
 * Per-tenant AI limits, editable from the admin account profile.
 * Empty = inherit the platform default; monthly budget 0 = disable AI for
 * this account. PATCHes /api/admin/tenants/[id]/agent-config.
 */
export function TenantAiConfigCard({
  tenantId,
  initialMonthlyBudget,
  initialRateLimitPerHour,
  defaultMonthlyBudget,
  defaultRateLimitPerHour,
}: Props) {
  const [budget, setBudget] = useState(initialMonthlyBudget != null ? String(initialMonthlyBudget) : '');
  const [rate, setRate] = useState(initialRateLimitPerHour != null ? String(initialRateLimitPerHour) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setError(null);
    setNotice(null);

    let budgetVal: number | null = null;
    if (budget.trim() !== '') {
      budgetVal = Number(budget);
      if (!Number.isFinite(budgetVal) || budgetVal < 0) {
        setError('Monthly budget must be a non-negative number (or blank to inherit).');
        return;
      }
    }
    let rateVal: number | null = null;
    if (rate.trim() !== '') {
      rateVal = Number(rate);
      if (!Number.isInteger(rateVal) || rateVal < 1) {
        setError('Rate limit must be a whole number ≥ 1 (or blank to inherit).');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/agent-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyBudget: budgetVal, rateLimitPerHour: rateVal }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Failed to save');
        return;
      }
      setNotice('Saved.');
    } catch {
      setError('Network error while saving');
    } finally {
      setSaving(false);
    }
  }

  const budgetDisabled = budget.trim() === '0';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
      <h2 className="text-lg font-semibold mb-1">AI Budget &amp; Limits</h2>
      <p className="text-xs text-gray-500 mb-4">
        Leave blank to inherit the pipeline default. Set the monthly budget to{' '}
        <span className="font-mono">0</span> to disable AI for this account.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Monthly budget ($)</span>
          <input
            type="number" min="0" step="0.01" value={budget}
            placeholder={`default ${defaultMonthlyBudget.toFixed(2)}`}
            onChange={(e) => setBudget(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <span className="text-[11px] text-gray-400 mt-0.5 block">
            {budget.trim() === ''
              ? `Inheriting default ($${defaultMonthlyBudget.toFixed(2)}/mo)`
              : budgetDisabled
                ? 'AI disabled for this account'
                : 'Custom override'}
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-600">Rate limit (calls / hour)</span>
          <input
            type="number" min="1" step="1" value={rate}
            placeholder={`default ${defaultRateLimitPerHour}`}
            onChange={(e) => setRate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <span className="text-[11px] text-gray-400 mt-0.5 block">
            {rate.trim() === ''
              ? `Inheriting default (${defaultRateLimitPerHour}/hr)`
              : 'Custom override'}
          </span>
        </label>
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
