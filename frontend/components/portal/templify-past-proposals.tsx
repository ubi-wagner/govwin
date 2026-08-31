'use client';

/**
 * TemplifyPastProposals (#18) — the library's "reuse your past work" surface.
 *
 * A past proposal you uploaded (and atomized) is a `document_cocoon` of section atoms.
 * Here you TEMPLIFY it — turn its winning STRUCTURE into a reusable template (content
 * stripped, skeleton kept) — then REGEN: start a fresh draft from that structure, ready to
 * fill from your library. Templify → POST /templates/extract { cocoonId }; regen → POST
 * /documents { templateId } → open the new draft. Both are audited (library:* events).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TEMPLATE_TYPES: Array<{ v: string; label: string }> = [
  { v: 'technical_volume', label: 'Technical Volume' },
  { v: 'cost_volume', label: 'Cost Volume' },
  { v: 'slide_deck', label: 'Slide Deck' },
  { v: 'past_performance', label: 'Past Performance' },
  { v: 'key_personnel', label: 'Key Personnel' },
  { v: 'commercialization', label: 'Commercialization' },
  { v: 'abstract', label: 'Abstract' },
  { v: 'cover_sheet', label: 'Cover Sheet' },
  { v: 'supporting_docs', label: 'Supporting Docs' },
  { v: 'custom', label: 'Custom' },
];

interface PastProposal {
  id: string;
  name: string | null;
  programType: string | null;
  source: string | null;
  createdAt: string;
  sectionCount: number;
  templateId: string | null;
  templateName: string | null;
}

// canTemplify: POST …/templates/extract requires tenant_admin ("Only an admin can save a
// template"), but this panel is mounted on the tenant_user-accessible /atoms page and the LIST it
// renders (library/past-proposals) is floored at tenant_user — so the rows AND the button both
// appeared for a base member, and only the button 403'd. The canvas editor already gates its
// equivalent correctly (lib/canvas/capabilities.ts canManageStructure = isTenantAdmin).
export function TemplifyPastProposals({ tenantSlug, canTemplify = false }: { tenantSlug: string; canTemplify?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<PastProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // cocoonId whose modal is open
  const [regenBusy, setRegenBusy] = useState<string | null>(null); // templateId being regen'd

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/library/past-proposals`);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) setItems(json.data.pastProposals ?? []);
      else setError(json.error || 'Could not load past proposals');
    } catch {
      setError('Could not load past proposals');
    }
  }, [tenantSlug]);

  useEffect(() => { load(); }, [load]);

  // Regen: start a fresh draft from a templified structure, ready to fill from the library.
  const regen = async (templateId: string) => {
    setRegenBusy(templateId);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data?.documentId) {
        router.push(`/portal/${tenantSlug}/documents/${json.data.documentId}`);
      } else {
        setError(json.error || 'Could not start a draft');
        setRegenBusy(null);
      }
    } catch {
      setError('Could not start a draft');
      setRegenBusy(null);
    }
  };

  if (error && !items) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>;
  }
  if (items === null) {
    return <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-400">Loading your past proposals…</div>;
  }

  return (
    <section className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-indigo-900">Reuse a past proposal</h2>
        <span className="text-[11px] text-indigo-600">templify its structure → regenerate fresh drafts</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Turn a past proposal you&apos;ve uploaded into a reusable <span className="font-medium">template</span> —
        its winning structure, content stripped — then start a fresh draft from it, filled from your library.
      </p>

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-indigo-200 bg-white/60 p-4 text-center text-xs text-gray-500">
          No past proposals yet. Upload a prior proposal package below (it&apos;s atomized into your library),
          then come back here to templify it.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="rounded-md border border-gray-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800" title={p.name || 'Untitled proposal'}>{p.name || 'Untitled proposal'}</p>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {p.sectionCount} section{p.sectionCount === 1 ? '' : 's'}
                    {p.programType ? <> · <span className="uppercase">{p.programType}</span></> : null}
                    {p.templateId ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        ✓ Templated{p.templateName ? `: ${p.templateName}` : ''}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.templateId ? (
                    <button
                      onClick={() => regen(p.templateId!)}
                      disabled={regenBusy === p.templateId}
                      className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      title="Start a fresh draft from this structure, ready to fill from your library"
                    >
                      {regenBusy === p.templateId ? 'Starting…' : 'New draft'}
                    </button>
                  ) : canTemplify ? (
                    <button
                      onClick={() => setEditing(p.id)}
                      className="rounded border border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                      title="Extract this proposal's structure as a reusable template"
                    >
                      Save as template
                    </button>
                  ) : null}
                </div>
              </div>

              {editing === p.id && (
                <TemplifyForm
                  tenantSlug={tenantSlug}
                  cocoonId={p.id}
                  defaultName={p.name || 'Past proposal template'}
                  onClose={() => setEditing(null)}
                  onSaved={() => { setEditing(null); load(); }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {error && items.length > 0 && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
    </section>
  );
}

function TemplifyForm({
  tenantSlug, cocoonId, defaultName, onClose, onSaved,
}: {
  tenantSlug: string; cocoonId: string; defaultName: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(defaultName.slice(0, 120));
  const [type, setType] = useState('technical_volume');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/templates/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cocoonId, name: name.trim(), templateType: type }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        setDone(json.data.sections?.length ?? 0);
        setTimeout(onSaved, 900); // let the user see the confirmation, then refresh
      } else {
        setErr(json.error || 'Could not save template');
      }
    } catch {
      setErr('Could not save template');
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return (
      <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
        Template saved — {done} section skeleton. Use <span className="font-medium">New draft</span> to start a document from it.
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-gray-200 bg-gray-50 p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Save as reusable template</p>
      <p className="-mt-1 text-[10px] text-gray-400">Keeps the section structure; strips the content.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 outline-none"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 outline-none"
      >
        {TEMPLATE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
      </select>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={save}
          disabled={busy || !name.trim()}
          className="flex-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Extracting…' : 'Extract structure'}
        </button>
        <button onClick={onClose} className="px-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
      {err && <p className="text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}
