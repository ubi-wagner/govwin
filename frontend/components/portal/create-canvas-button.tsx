'use client';

/**
 * CreateCanvasButton — the in-library "Create Canvas" action (design §2, P2.1).
 *
 * Opens a modal to mint a FOUNDATION ARTIFACT from a blank form (doc/ppt/pdf/
 * sheet) with its taxonomy (kind × form × context), via
 * `POST /api/portal/[tenantSlug]/library/canvas`. On success the new foundation
 * — decomposed into section/group/atom grains server-side — appears in the
 * library (router.refresh). Opening it in the canvas editor is P2.2.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Form = 'doc' | 'ppt' | 'pdf' | 'sheet';
type Kind = 'template' | 'document';

const FORMS: Array<{ value: Form; label: string; hint: string; icon: string }> = [
  { value: 'doc', label: 'Document', hint: '.docx', icon: '📄' },
  { value: 'ppt', label: 'Deck', hint: '.pptx', icon: '📊' },
  { value: 'sheet', label: 'Sheet', hint: '.xlsx', icon: '🧮' },
  { value: 'pdf', label: 'PDF', hint: '.pdf', icon: '📕' },
];
const CONTEXTS = ['proposal', 'marketing', 'commercialization', 'email', 'capability', 'past-performance', 'general'];

interface Props {
  tenantSlug: string;
}

export function CreateCanvasButton({ tenantSlug }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState<Form>('doc');
  const [kind, setKind] = useState<Kind>('document');
  const [context, setContext] = useState('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setTitle(''); setForm('doc'); setKind('document'); setContext('general'); setError(null); };
  const close = () => { setOpen(false); reset(); };

  const create = async () => {
    if (!title.trim()) { setError('Give it a name first.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/library/canvas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), form, kind, context }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not create the canvas.'); return; }
      // Open the new foundation straight in the canvas editor (design §2). Keep
      // busy=true through the navigation so the button reads "Opening…".
      router.push(`/portal/${tenantSlug}/library/foundation/${body.data.foundationId}`);
      return;
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        <span aria-hidden>＋</span> Create canvas
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-semibold">Create a canvas</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
            </div>

            <div className="space-y-4 p-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                  <input
                    autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                    placeholder="e.g. Capability Statement"
                    className="w-full rounded border px-2.5 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Form</label>
                  <div className="grid grid-cols-4 gap-2">
                    {FORMS.map((f) => (
                      <button
                        key={f.value} type="button" onClick={() => setForm(f.value)}
                        className={`flex flex-col items-center gap-0.5 rounded border py-2 text-xs ${
                          form === f.value ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-lg" aria-hidden>{f.icon}</span>{f.label}
                        <span className="text-[10px] text-gray-400">{f.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Kind</label>
                    <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full rounded border px-2 py-1.5 text-sm">
                      <option value="document">Document</option>
                      <option value="template">Template</option>
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
                  <button
                    onClick={create} disabled={busy || !title.trim()}
                    className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
