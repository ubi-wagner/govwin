'use client';

/**
 * CreateCanvasButton — the in-library "Create Canvas" action (design §2, P2.1–P2.3).
 *
 * Two modes in one modal:
 *   • Blank      — mint a FOUNDATION ARTIFACT from a blank form (doc/ppt/pdf/sheet)
 *                  with its taxonomy (kind × form × context) via POST library/canvas.
 *   • Template   — "Start from a template": list the shared system-starter catalog
 *                  (GET library/system-templates) and copy one into MY library
 *                  (POST, copy-on-use with derived_from lineage).
 * Either path opens the resulting foundation straight in the canvas editor (P2.2).
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Form = 'doc' | 'ppt' | 'pdf' | 'sheet';
type Kind = 'template' | 'document';
type Tab = 'blank' | 'template';
interface SystemTemplate { id: string; title: string | null; form: string | null; format: string | null; context: string | null }

const FORMS: Array<{ value: Form; label: string; hint: string; icon: string }> = [
  { value: 'doc', label: 'Document', hint: '.docx', icon: '📄' },
  { value: 'ppt', label: 'Deck', hint: '.pptx', icon: '📊' },
  { value: 'sheet', label: 'Sheet', hint: '.xlsx', icon: '🧮' },
  { value: 'pdf', label: 'PDF', hint: '.pdf', icon: '📕' },
];
const CONTEXTS = ['proposal', 'marketing', 'commercialization', 'email', 'capability', 'past-performance', 'general'];

export function CreateCanvasButton({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('blank');
  const [title, setTitle] = useState('');
  const [form, setForm] = useState<Form>('doc');
  const [kind, setKind] = useState<Kind>('document');
  const [context, setContext] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SystemTemplate[] | null>(null);
  const [tplLoading, setTplLoading] = useState(false);

  const reset = () => { setTab('blank'); setTitle(''); setForm('doc'); setKind('document'); setContext('general'); setError(null); };
  const close = () => { setOpen(false); reset(); };

  // Lazy-load the catalog the first time the Template tab is opened.
  useEffect(() => {
    if (!open || tab !== 'template' || templates !== null) return;
    setTplLoading(true);
    fetch(`/api/portal/${tenantSlug}/library/system-templates`)
      .then((r) => r.json())
      .then((b) => setTemplates(Array.isArray(b.data) ? b.data : []))
      .catch(() => setTemplates([]))
      .finally(() => setTplLoading(false));
  }, [open, tab, templates, tenantSlug]);

  const createBlank = useCallback(async () => {
    if (!title.trim()) { setError('Give it a name first.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/library/canvas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), form, kind, context }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not create the canvas.'); return; }
      router.push(`/portal/${tenantSlug}/library/foundation/${body.data.foundationId}`);
      return;
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [title, form, kind, context, tenantSlug, router]);

  const applyTemplate = useCallback(async (foundationId: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/library/system-templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foundationId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not add the template.'); return; }
      router.push(`/portal/${tenantSlug}/library/foundation/${body.data.foundationId}`);
      return;
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [tenantSlug, router]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button" onClick={() => { setTab(t); setError(null); }}
      className={`px-3 py-1.5 text-sm font-medium border-b-2 ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
    >{label}</button>
  );

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      ><span aria-hidden>＋</span> Create canvas</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 pt-3">
              <div className="flex gap-2">{tabBtn('blank', 'Blank canvas')}{tabBtn('template', 'Start from a template')}</div>
              <button onClick={close} className="mb-2 text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
            </div>

            {tab === 'blank' ? (
              <div className="space-y-4 p-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                  <input
                    autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createBlank(); }}
                    placeholder="e.g. Capability Statement" className="w-full rounded border px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Form</label>
                  <div className="grid grid-cols-4 gap-2">
                    {FORMS.map((f) => (
                      <button
                        key={f.value} type="button" onClick={() => setForm(f.value)}
                        className={`flex flex-col items-center gap-0.5 rounded border py-2 text-xs ${form === f.value ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}
                      ><span className="text-lg" aria-hidden>{f.icon}</span>{f.label}<span className="text-[10px] text-gray-400">{f.hint}</span></button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Kind</label>
                    <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full rounded border px-2 py-1.5 text-sm">
                      <option value="document">Document</option><option value="template">Template</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Context</label>
                    <select value={context} onChange={(e) => setContext(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm">
                      {CONTEXTS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={close} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
                  <button onClick={createBlank} disabled={busy || !title.trim()} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                <p className="text-xs text-gray-500">Copy a starter template into your library — you get your own editable copy (with lineage back to the original).</p>
                {tplLoading && <p className="text-sm text-gray-400">Loading templates…</p>}
                {!tplLoading && templates && templates.length === 0 && (
                  <p className="rounded border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">No starter templates yet.</p>
                )}
                {!tplLoading && templates && templates.length > 0 && (
                  <ul className="max-h-72 divide-y overflow-y-auto rounded border">
                    {templates.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-800" title={t.title || 'Untitled'}>{t.title || 'Untitled'}</div>
                          <div className="mt-0.5 flex gap-1 text-[10px] text-gray-400">
                            {t.form && <span className="rounded bg-gray-100 px-1.5 py-0.5">{t.form}</span>}
                            {t.context && <span className="rounded bg-gray-100 px-1.5 py-0.5">{t.context}</span>}
                          </div>
                        </div>
                        <button onClick={() => applyTemplate(t.id)} disabled={busy} className="shrink-0 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                          {busy ? '…' : 'Use'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <div className="flex justify-end"><button onClick={close} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
