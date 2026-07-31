'use client';

/**
 * Reusable "start from a saved template" picker (the config-templates capability). A defined
 * workflow's config (portal guardrails, scout source config, …) is stored as a named template;
 * this component lets an admin pick a relevant prior one to seed the editor — instead of being
 * forced into a misaligned default — and save the current config back as a new named template
 * (extend-the-last). It is config-agnostic: it treats each template's `config` as opaque JSON,
 * calls `onApply(config)` to seed the host editor, and posts `{ name, config }` from
 * `currentConfig()` to save. Used by the GuardrailEditor and the scout source-setup form.
 */
import { useEffect, useState, useCallback } from 'react';

export interface TemplateItem {
  id: string; name: string; description: string | null; config: unknown;
  scope?: string; isDefault?: boolean;
}

export function TemplatePicker({
  listUrl, saveUrl, onApply, currentConfig, label, saveHint,
}: {
  listUrl: string;
  /** Omit to render a pick-only picker (e.g. scouts, where the source itself is the config). */
  saveUrl?: string;
  onApply: (config: unknown) => void;
  currentConfig?: () => unknown;
  label?: string;
  saveHint?: string;
}) {
  const canSave = Boolean(saveUrl && currentConfig);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [picked, setPicked] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(listUrl);
      if (!res.ok) return;
      const j = await res.json();
      if (Array.isArray(j?.data?.templates)) setTemplates(j.data.templates as TemplateItem[]);
    } catch { /* non-fatal — the editor still works without templates */ }
  }, [listUrl]);

  useEffect(() => { load(); }, [load]);

  const apply = useCallback((id: string) => {
    setPicked(id);
    const t = templates.find((x) => x.id === id);
    if (t) { onApply(t.config); setMsg(`Started from “${t.name}”. Tweak anything below, then save or launch.`); }
  }, [templates, onApply]);

  const save = useCallback(async () => {
    if (!saveUrl || !currentConfig) return;
    const name = saveName.trim();
    if (!name) { setMsg('Give the template a name first.'); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(saveUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: currentConfig() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error || 'Failed to save template'); return; }
      setMsg(`Saved “${name}” — it will show up next time.`);
      setSaveName(''); setShowSave(false);
      await load(); // extend-the-last: the new template appears at the top
    } catch {
      setMsg('Network error saving template');
    } finally {
      setSaving(false);
    }
  }, [saveName, saveUrl, currentConfig, load]);

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-indigo-900">{label ?? 'Start from a saved template'}</span>
        <select
          value={picked}
          onChange={(e) => apply(e.target.value)}
          className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white min-w-[200px]"
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.isDefault ? ' (default)' : ''}{t.scope === 'platform' && !t.isDefault ? ' · shared' : ''}
            </option>
          ))}
        </select>
        {canSave && (
          <button type="button" onClick={() => setShowSave((s) => !s)}
            className="text-xs text-indigo-700 hover:underline ml-auto">
            {showSave ? 'Cancel' : 'Save current as template'}
          </button>
        )}
      </div>

      {canSave && showSave && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g. USAF CSO STTR"
            className="flex-1 min-w-[200px] text-xs border border-indigo-200 rounded px-2 py-1 bg-white"
          />
          <button type="button" onClick={save} disabled={saving}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save template'}
          </button>
          {saveHint && <span className="w-full text-[11px] text-indigo-400">{saveHint}</span>}
        </div>
      )}

      {msg && <div className="mt-2 text-[11px] text-indigo-700">{msg}</div>}
    </div>
  );
}
