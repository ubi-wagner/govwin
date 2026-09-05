'use client';

import React, { useCallback, useState } from 'react';

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Daily 6am UTC', value: '0 6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Weekly Monday 6am UTC', value: '0 6 * * 1' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Custom', value: '__custom__' },
];

// ── Component ────────────────────────────────────────────────────────

interface CrawlSettingsProps {
  profileId: string;
  autoCrawlEnabled: boolean;
  crawlCron: string | null;
  lastCrawlAt: string | null;
  onUpdated: () => void;
}

export default function CrawlSettings({
  profileId,
  autoCrawlEnabled: initialEnabled,
  crawlCron: initialCron,
  lastCrawlAt,
  onUpdated,
}: CrawlSettingsProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [cronValue, setCronValue] = useState(initialCron ?? '0 6 * * *');
  const [isCustom, setIsCustom] = useState(
    !CRON_PRESETS.some((p) => p.value !== '__custom__' && p.value === (initialCron ?? '0 6 * * *')),
  );
  const [saving, setSaving] = useState(false);
  const [scouting, setScouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoCrawlEnabled: newEnabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to update');
      }
      onUpdated();
    } catch (err) {
      setEnabled(!newEnabled); // revert
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [enabled, profileId, onUpdated]);

  const handleCronChange = useCallback(async (value: string) => {
    if (value === '__custom__') {
      setIsCustom(true);
      return;
    }
    setIsCustom(false);
    setCronValue(value);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crawlCron: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to update');
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [profileId, onUpdated]);

  const handleCustomCronSave = useCallback(async () => {
    if (!cronValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crawlCron: cronValue.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to update');
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [cronValue, profileId, onUpdated]);

  const handleScoutNow = useCallback(async () => {
    setScouting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}/scout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to trigger scout');
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scout failed');
    } finally {
      setScouting(false);
    }
  }, [profileId, onUpdated]);

  const selectedPreset = isCustom
    ? '__custom__'
    : CRON_PRESETS.find((p) => p.value === cronValue)?.value ?? '__custom__';

  return (
    <div className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">Crawl Settings</h3>

      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-700">Auto-crawl</span>
          <p className="text-xs text-gray-400">Automatically scout this source on a schedule</p>
        </div>
        {/* The STATE was announced and the SUBJECT was not: "switch, off" tells a screen-reader
            user nothing about what is off. `aria-checked` without an accessible name is the
            half-done version of this control, and the one the probe caught. */}
        <button
          onClick={handleToggle}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
            enabled ? 'bg-indigo-600' : 'bg-gray-300'
          } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          role="switch"
          aria-checked={enabled}
          aria-label="Scheduled crawling for this source"
          title={enabled ? 'Scheduled crawling is on' : 'Scheduled crawling is off'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Schedule */}
      {enabled && (
        <div className="space-y-2">
          <label htmlFor="cron-preset" className="block text-sm font-medium text-gray-700">
            Schedule
          </label>
          <select
            id="cron-preset"
            value={selectedPreset}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleCronChange(e.target.value)}
            disabled={saving}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white disabled:opacity-50"
          >
            {CRON_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          {isCustom && (
            <div className="flex gap-2">
              <input
                type="text"
                value={cronValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCronValue(e.target.value)}
                placeholder="0 6 * * *"
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <button
                onClick={handleCustomCronSave}
                disabled={saving || !cronValue.trim()}
                className="px-3 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '...' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Last crawl */}
      <div className="text-xs text-gray-400">
        Last crawl: {formatDate(lastCrawlAt)}
      </div>

      {/* Scout Now */}
      <button
        onClick={handleScoutNow}
        disabled={scouting}
        className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {scouting ? 'Scouting...' : 'Scout Now'}
      </button>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
