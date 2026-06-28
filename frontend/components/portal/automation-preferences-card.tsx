'use client';

/**
 * Customer automation setup (tenant_admin). The choices the customer makes at
 * portal purchase (and can edit later) for the milestone automations driven by
 * the proposal lifecycle events. Reads/writes
 * /api/portal/[slug]/automation-preferences.
 */
import { useEffect, useState } from 'react';

interface Prefs {
  notifyTeamOnDocumentLocked: boolean;
  notifyCollaboratorsGetReady: boolean;
  notifyOnStageAdvanced: boolean;
  notifyOnNewPriorityOpp: boolean;
  aiReviewOnAdvance: boolean;
  autoAdvanceWhenAllLocked: boolean;
}

const GROUPS: { title: string; items: { key: keyof Prefs; label: string; help: string }[] }[] = [
  {
    title: 'Notifications',
    items: [
      { key: 'notifyTeamOnDocumentLocked', label: 'Document ready', help: 'Email the team when every section of a document is accepted & locked.' },
      { key: 'notifyCollaboratorsGetReady', label: 'Collaborator "get ready"', help: 'Give collaborators a heads-up as their stage approaches.' },
      { key: 'notifyOnStageAdvanced', label: 'Stage advanced', help: 'Notify when a proposal advances to the next stage.' },
      { key: 'notifyOnNewPriorityOpp', label: 'New priority opportunity', help: 'Alert when a new high-alignment opportunity appears in your Spotlight.' },
    ],
  },
  {
    title: 'AI agents',
    items: [
      { key: 'aiReviewOnAdvance', label: 'AI review on advance', help: 'When a stage advances, AI agents review grammar, flow, and compliance and post recommendations into each section.' },
    ],
  },
  {
    title: 'Flow',
    items: [
      { key: 'autoAdvanceWhenAllLocked', label: 'Auto-advance when all locked', help: 'Advance the proposal automatically once every section is accepted & locked (otherwise advance manually).' },
    ],
  },
];

export function AutomationPreferencesCard({ tenantSlug }: { tenantSlug: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/automation-preferences`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: 'Failed to load' }));
          if (!cancelled) setError(j.error || 'Failed to load preferences');
          return;
        }
        const j = await res.json();
        if (!cancelled) setPrefs(j.data.preferences as Prefs);
      } catch {
        if (!cancelled) setError('Network error loading preferences');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  function toggle(key: keyof Prefs) {
    setPrefs((p) => (p ? { ...p, [key]: !p[key] } : p));
    setSaved(false);
  }

  async function handleSave() {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/automation-preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Failed to save' }));
        setError(j.error || 'Failed to save preferences');
        return;
      }
      setSaved(true);
    } catch {
      setError('Network error saving preferences');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-400 py-6">Loading automation preferences…</div>;
  if (error && !prefs) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</div>;
  if (!prefs) return null;

  return (
    <div className="space-y-6">
      {GROUPS.map((group) => (
        <div key={group.title} className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{group.title}</h2>
          <div className="space-y-3">
            {group.items.map((item) => (
              <label key={item.key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs[item.key]}
                  onChange={() => toggle(item.key)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-800">{item.label}</span>
                  <span className="block text-xs text-gray-500">{item.help}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save automation preferences'}
        </button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
