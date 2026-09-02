'use client';

/**
 * The note box under every guide step — "this is wrong / this is broken / this is harder than it
 * should be", captured at the moment you notice it.
 *
 * ── WHY IT CARRIES EVIDENCE YOU DID NOT TYPE ─────────────────────────────────────────────────
 * "This step was confusing" is a diary entry: a week later nobody can act on it. What makes a note
 * worth reading cold is the context around it, and none of that context is something a person
 * should have to write down while they are mid-curation. So the box captures it:
 *
 *   the ANCHOR   route + step id, so the note files against the thing it is about
 *   the URL      including the id in hand — which solicitation, which finding
 *   the TITLE    what the page called itself at that moment
 *
 * Attribution is deliberately NOT sent: the route takes the signed-in user server-side. The whole
 * value of a shared board is that you can trust who said what, and a client-supplied author is not
 * that.
 *
 * ── AND WHY IT NEVER BLOCKS ──────────────────────────────────────────────────────────────────
 * Writing a note must never interrupt the work that prompted it. It posts, says so, and gets out
 * of the way; a failure is reported in place rather than thrown, and `addNote` on the server is
 * itself non-throwing for the same reason.
 */
import { useState } from 'react';

type Disposition = 'gap' | 'defect' | 'friction';

const CHOICES: { key: Disposition; label: string; hint: string }[] = [
  { key: 'gap', label: 'Guide is wrong', hint: 'the guide is silent or misleading here' },
  { key: 'defect', label: 'Product is wrong', hint: 'it did not do what it says' },
  { key: 'friction', label: 'Harder than it should be', hint: 'it works; it costs too much' },
];

export function GuideNoteBox({ anchor, step }: { anchor: string; step: string }) {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<Disposition>('gap');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const note = text.trim();
    if (!note) return;
    setState('saving');
    setErr(null);
    try {
      // The context the reader would otherwise have to remember. Collected here, not typed.
      const seen = typeof window !== 'undefined'
        ? { url: window.location.pathname + window.location.search, title: document.title }
        : {};
      const res = await fetch('/api/admin/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anchor,
          disposition,
          note: `[${step}] ${note}\n\nseen at: ${JSON.stringify(seen)}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((json as { error?: string })?.error ?? `Could not save (${res.status})`);
        setState('error');
        return;
      }
      setText('');
      setState('saved');
    } catch {
      setErr('Could not save the note');
      setState('error');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setState('idle'); }}
        className="mt-2 text-[12px] font-medium text-sky-700 underline-offset-2 hover:underline"
      >
        {state === 'saved' ? 'Noted — add another' : 'Something wrong here? Note it'}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded border border-sky-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.hint}
            onClick={() => setDisposition(c.key)}
            className={`rounded px-2 py-1 text-[12px] ${
              disposition === c.key
                ? 'bg-sky-700 font-medium text-white'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        aria-label={`Note about: ${step}`}
        placeholder="What happened, and what you expected. The route, the step and the record you had open are captured for you."
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-[13px]"
      />
      {err && <p className="mt-1 text-[12px] text-red-700">{err}</p>}
      {state === 'saved' && <p className="mt-1 text-[12px] text-green-700">Saved to the board.</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={state === 'saving' || !text.trim()}
          className="rounded bg-sky-700 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : 'Save note'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setText(''); setErr(null); }}
          className="text-[12px] text-gray-600 hover:underline"
        >
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-gray-400">goes to the shared board · /admin/notes</span>
      </div>
    </div>
  );
}
