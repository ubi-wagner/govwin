'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Atomizer — hand-shred a document into library atoms. Paste (or, later, upload) →
 * the text deconstructs into selectable objects → box/multi-select the ones you like →
 * "Make atom" (a primitive, or a group whose members are the selected objects) → tag
 * against the unified taxonomy (auto-suggested + confirmed) → save. Only what you
 * select becomes atoms; the rest stays available to atomize later.
 */

interface Taxonomy { byDimension: Record<string, Array<{ value: string; label: string }>>; openDimensions: string[] }
interface Block { id: string; text: string; kind: 'heading' | 'narrative' }
interface Tag { dimension: string; value: string; isOther?: boolean }

// The dimensions the atomizer surfaces (mold + subject + access). Open dims are free-text.
const CURATED_DIMS = ['vol', 'kind', 'fmt', 'agency', 'program', 'phase', 'party_role', 'access'];
const OPEN_DIMS = ['tech', 'party', 'topic', 'sol'];

function deconstruct(raw: string): Block[] {
  return raw
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text, i) => ({
      id: `b${i}`,
      text,
      kind: text.length < 70 && !/[.!?]$/.test(text) ? 'heading' : 'narrative',
    }));
}

export function Atomizer({ tenantSlug }: { tenantSlug: string }) {
  const [raw, setRaw] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tax, setTax] = useState<Taxonomy | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [asGroup, setAsGroup] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/upload`, { method: 'POST', body: fd });
      if (res.ok) {
        const d = (await res.json()).data as { referenceAtomId: string | null; blocks: Array<{ id: string; heading: string | null; text: string; kind: string }> };
        setBlocks(d.blocks.map((b) => ({ id: b.id, text: b.heading && b.heading !== b.text ? `${b.heading}\n${b.text}` : (b.text || b.heading || ''), kind: b.kind === 'heading' ? 'heading' : 'narrative' })));
        setReferenceId(d.referenceAtomId); setSel(new Set());
        setMsg(`Uploaded — ${d.blocks.length} objects registered. Select what to atomize.`);
      } else { setMsg((await res.json().catch(() => ({}))).error || 'Upload failed'); }
    } catch { setMsg('Upload failed'); } finally { setBusy(false); }
  }, [tenantSlug]);

  useEffect(() => {
    fetch(`/api/portal/${tenantSlug}/taxonomy`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setTax(j.data)).catch(() => {});
  }, [tenantSlug]);

  const shred = useCallback(() => { setBlocks(deconstruct(raw)); setSel(new Set()); setMsg(null); }, [raw]);
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedBlocks = useMemo(() => blocks.filter((b) => sel.has(b.id)), [blocks, sel]);
  const words = useMemo(() => selectedBlocks.map((b) => b.text.trim().split(/\s+/).length).reduce((a, b) => a + b, 0), [selectedBlocks]);

  const addTag = (dimension: string, value: string, isOther = false) => {
    const v = value.trim(); if (!v) return;
    setTags((p) => (p.some((t) => t.dimension === dimension && t.value === v) ? p : [...p, { dimension, value: v, isOther }]));
  };
  const removeTag = (i: number) => setTags((p) => p.filter((_, x) => x !== i));

  const make = useCallback(async () => {
    if (selectedBlocks.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const canvasNodes = selectedBlocks.map((b) => ({
        type: b.kind === 'heading' ? 'heading' : 'text_block',
        content: b.kind === 'heading' ? { level: 2, text: b.text } : { text: b.text },
      }));
      const content = selectedBlocks.map((b) => b.text).join('\n\n');
      const grain = asGroup && selectedBlocks.length > 1 ? 'group' : 'primitive';

      // A group is created as N primitives (its members) + the group over them.
      let memberAtomIds: string[] | undefined;
      if (grain === 'group') {
        const ids: string[] = [];
        for (const b of selectedBlocks) {
          const res = await fetch(`/api/portal/${tenantSlug}/atoms`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grain: 'primitive', title: b.text.slice(0, 60), content: b.text,
              canvasNodes: [{ type: b.kind === 'heading' ? 'heading' : 'text_block', content: b.kind === 'heading' ? { level: 2, text: b.text } : { text: b.text } }],
              source: 'upload', status: 'approved',
              sourceAnchor: referenceId ? [{ sourceAtomId: referenceId, blockIds: [b.id] }] : undefined }),
          });
          if (res.ok) ids.push((await res.json()).data.atomId);
        }
        memberAtomIds = ids;
      }

      const res = await fetch(`/api/portal/${tenantSlug}/atoms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grain, title: title.trim() || selectedBlocks[0].text.slice(0, 60),
          content: grain === 'group' ? null : content,
          canvasNodes: grain === 'group' ? null : canvasNodes,
          summary: summary.trim() || null,
          memberAtomIds,
          source: 'upload', status: 'approved',
          tags: tags.map((t) => ({ ...t, source: 'admin', confirmed: true })),
          sourceAnchor: referenceId ? [{ sourceAtomId: referenceId, blockIds: selectedBlocks.map((b) => b.id) }] : undefined,
        }),
      });
      if (res.ok) {
        const d = (await res.json()).data;
        setMsg(`Created ${grain} atom (${d.size?.words ?? words} words${memberAtomIds ? `, ${memberAtomIds.length} members` : ''}). Tags: ${tags.length}.`);
        setSel(new Set()); setTags([]); setTitle(''); setSummary(''); setAsGroup(false);
      } else { setMsg((await res.json().catch(() => ({}))).error || 'Create failed'); }
    } catch { setMsg('Create failed'); } finally { setBusy(false); }
  }, [selectedBlocks, asGroup, tenantSlug, title, summary, tags, words, referenceId]);

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: paste + deconstructed objects */}
      <div className="lg:col-span-2 space-y-3">
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <label className="block text-xs text-gray-500 mb-1">Paste document content to shred</label>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" placeholder="Paste a bio, a past-performance blurb, a whole team section…" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={shred} disabled={!raw.trim() || busy} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:opacity-50">Deconstruct into objects</button>
            <label className="text-sm text-blue-600 hover:underline cursor-pointer">
              or upload a file
              <input type="file" accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md" className="hidden" disabled={busy}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            </label>
            <span className="text-[11px] text-gray-400">registers the doc + its objects; nothing is atomized until you select</span>
          </div>
        </div>
        {blocks.length > 0 && (
          <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
            <div className="px-4 py-2 text-xs text-gray-500 flex justify-between">
              <span>{blocks.length} objects — select the ones you like</span>
              <span>{sel.size} selected · {words} words</span>
            </div>
            {blocks.map((b) => (
              <label key={b.id} className={`flex gap-2 px-4 py-2 cursor-pointer text-sm ${sel.has(b.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} className="mt-1" />
                <span className="flex-1">
                  <span className={`text-[10px] uppercase mr-2 ${b.kind === 'heading' ? 'text-indigo-500' : 'text-gray-400'}`}>{b.kind}</span>
                  <span className={b.kind === 'heading' ? 'font-semibold text-gray-800' : 'text-gray-700'}>{b.text}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Right: tag + create */}
      <div className="space-y-3">
        <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
          <h3 className="text-sm font-semibold">Make atom{sel.size > 1 ? ` from ${sel.size} objects` : ''}</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={`${inputCls} w-full`} />
          <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One-line summary (helps matching)" className={`${inputCls} w-full`} />
          {sel.size > 1 && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={asGroup} onChange={(e) => setAsGroup(e.target.checked)} />
              Create as a <b>group</b> ({sel.size} member atoms) rather than one merged atom
            </label>
          )}

          {/* tags */}
          <div className="space-y-1.5">
            {CURATED_DIMS.map((dim) => (
              <div key={dim} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 w-16">{dim}</span>
                <select className={`${inputCls} flex-1`} value="" onChange={(e) => e.target.value && addTag(dim, e.target.value)}>
                  <option value="">add…</option>
                  {(tax?.byDimension[dim] ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            ))}
            {OPEN_DIMS.map((dim) => (
              <FreeTag key={dim} dim={dim} onAdd={(v) => addTag(dim, v, true)} inputCls={inputCls} />
            ))}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
                  {t.dimension}:{t.value}
                  <button onClick={() => removeTag(i)} className="text-gray-400 hover:text-rose-600">×</button>
                </span>
              ))}
            </div>
          )}

          <button onClick={make} disabled={busy || sel.size === 0} className="w-full text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-2 disabled:opacity-50">
            {busy ? 'Creating…' : sel.size > 1 && asGroup ? 'Create group' : 'Create atom'}
          </button>
          {msg && <p className="text-xs text-gray-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function FreeTag({ dim, onAdd, inputCls }: { dim: string; onAdd: (v: string) => void; inputCls: string }) {
  const [v, setV] = useState('');
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-400 w-16">{dim}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } }} placeholder="free + Enter" className={`${inputCls} flex-1`} />
    </div>
  );
}
