'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Annotation atomizer (docs/CANVAS_GEOMETRY_REDESIGN.md §7) — the box-and-tag
 * ingest. Upload (or paste) → the doc deconstructs into typed, selectable objects
 * → select the ones you want and mint them at the right GRAIN:
 *   • an image → a figure atom
 *   • a table / list → one EXTENDABLE atom, OR a GROUP of rows / items
 *   • prose → a narrative atom; select several → a GROUP ("Team Bios")
 * Then box a SECTION over the groups/atoms you made ("Team Section"). A session
 * FROM-pedigree (agency/program/phase/…) is stamped on everything so the library
 * ranks reuse by where it came from. Every atom keeps a SourceAnchor to its block.
 */

interface Taxonomy { byDimension: Record<string, Array<{ value: string; label: string }>>; openDimensions: string[] }
type PrimaryType = 'image' | 'table' | 'list' | 'heading' | 'narrative';
interface CanvasNodeLite { type: string; content: unknown }
interface Block { id: string; heading: string | null; text: string; kind: 'heading' | 'narrative'; primaryType: PrimaryType; nodes: CanvasNodeLite[]; suggestedVol: string | null }
interface Tag { dimension: string; value: string; isOther?: boolean; source?: string; confirmed?: boolean }
interface TrayItem { id: string; label: string; grain: 'primitive' | 'group'; kind: PrimaryType }

const CURATED_DIMS = ['vol', 'kind', 'fmt', 'party_role', 'access'];
const OPEN_DIMS = ['tech', 'party', 'topic'];
const PROGRAMS = ['', 'sbir', 'sttr', 'baa', 'ota', 'cso', 'rif'];
const PHASES = ['', '1', '2', '3'];

const TYPE_BADGE: Record<PrimaryType, { label: string; cls: string }> = {
  image: { label: 'figure', cls: 'text-fuchsia-600' },
  table: { label: 'table', cls: 'text-cyan-600' },
  list: { label: 'list', cls: 'text-amber-600' },
  heading: { label: 'heading', cls: 'text-indigo-500' },
  narrative: { label: 'text', cls: 'text-gray-400' },
};

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Split a table node into one-row table nodes (header repeated) — for "group of rows". */
function splitTableRows(node: CanvasNodeLite): CanvasNodeLite[] {
  const c = node.content as { headers?: unknown[]; rows?: unknown[][]; header_style?: unknown };
  return (c.rows ?? []).map((row) => ({ type: 'table', content: { headers: c.headers ?? [], rows: [row], header_style: c.header_style } }));
}
/** Split a list node into one-item list nodes — for "group of items". */
function splitListItems(node: CanvasNodeLite): CanvasNodeLite[] {
  const c = node.content as { items?: unknown[] };
  return (c.items ?? []).map((item) => ({ type: node.type, content: { items: [item] } }));
}

export function Atomizer({ tenantSlug }: { tenantSlug: string }) {
  const [raw, setRaw] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tax, setTax] = useState<Taxonomy | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  // Session FROM-pedigree — stamped on every atom/group/section created this session.
  const [ctx, setCtx] = useState({ agency: '', program: '', phase: '', sol: '', topic: '' });
  // Table/list grain choice.
  const [tableAsRows, setTableAsRows] = useState(false);
  const [listAsItems, setListAsItems] = useState(false);
  // The section tray — atoms/groups you've minted, to box into a section.
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [traySel, setTraySel] = useState<Set<string>>(new Set());
  const [sectionLabel, setSectionLabel] = useState('');

  useEffect(() => {
    fetch(`/api/portal/${tenantSlug}/taxonomy`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setTax(j.data)).catch(() => {});
  }, [tenantSlug]);

  const upload = useCallback(async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/upload`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        const d = j.data as { referenceAtomId: string | null; blocks: Block[] };
        setBlocks(d.blocks); setReferenceId(d.referenceAtomId); setSel(new Set());
        setMsg(`Uploaded — ${d.blocks.length} objects. Select what to atomize, at the grain you want.`);
      } else setMsg(j.error || 'Upload failed');
    } catch { setMsg('Upload failed'); } finally { setBusy(false); }
  }, [tenantSlug]);

  const shred = useCallback(() => {
    setBlocks(raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map((text, i): Block => ({
      id: `b${i}`, heading: null, text, kind: text.length < 70 && !/[.!?]$/.test(text) ? 'heading' : 'narrative',
      primaryType: text.length < 70 && !/[.!?]$/.test(text) ? 'heading' : 'narrative',
      nodes: [{ type: text.length < 70 && !/[.!?]$/.test(text) ? 'heading' : 'text_block', content: text.length < 70 ? { level: 2, text } : { text } }],
      suggestedVol: null,
    })));
    setSel(new Set()); setReferenceId(null); setMsg(null);
  }, [raw]);

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedBlocks = useMemo(() => blocks.filter((b) => sel.has(b.id)), [blocks, sel]);
  const singleType = useMemo(() => (selectedBlocks.length === 1 ? selectedBlocks[0].primaryType : null), [selectedBlocks]);

  const addTag = (dimension: string, value: string, isOther = false) => {
    const v = value.trim(); if (!v) return;
    setTags((p) => (p.some((t) => t.dimension === dimension && t.value === v) ? p : [...p, { dimension, value: v, isOther }]));
  };
  const removeTag = (i: number) => setTags((p) => p.filter((_, x) => x !== i));

  /** Session pedigree → tags stamped on every create. */
  const ctxTags = useCallback((): Tag[] => {
    const out: Tag[] = [];
    if (ctx.agency.trim()) out.push({ dimension: 'agency', value: slug(ctx.agency), isOther: true });
    const prog = ctx.program.match(/sbir|sttr|baa|ota|cso|rif/)?.[0]; if (prog) out.push({ dimension: 'program', value: prog });
    if (ctx.phase) out.push({ dimension: 'phase', value: `phase_${ctx.phase}` });
    if (ctx.sol.trim()) out.push({ dimension: 'sol', value: slug(ctx.sol), isOther: true });
    if (ctx.topic.trim()) out.push({ dimension: 'topic', value: slug(ctx.topic), isOther: true });
    return out;
  }, [ctx]);

  const post = useCallback(async (body: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch(`/api/portal/${tenantSlug}/atoms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error || 'Create failed'); return null; }
    return (await res.json()).data.atomId as string;
  }, [tenantSlug]);

  const kindTag = (t: PrimaryType): Tag[] => (t === 'image' ? [{ dimension: 'kind', value: 'figure' }] : t === 'table' ? [{ dimension: 'kind', value: 'table' }] : t === 'list' ? [{ dimension: 'kind', value: 'list' }] : []);
  const anchor = (ids: string[]) => (referenceId ? [{ sourceAtomId: referenceId, blockIds: ids }] : undefined);
  const allTags = (extra: Tag[]) => [...tags, ...ctxTags(), ...extra].map((t) => ({ ...t, source: 'admin', confirmed: true }));

  const make = useCallback(async () => {
    if (selectedBlocks.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const made: TrayItem[] = [];

      // Single table/list can be minted as a GROUP of rows/items.
      if (selectedBlocks.length === 1 && ((singleType === 'table' && tableAsRows) || (singleType === 'list' && listAsItems))) {
        const b = selectedBlocks[0];
        const node = b.nodes.find((n) => n.type === 'table' || n.type === 'bulleted_list' || n.type === 'numbered_list')!;
        const parts = singleType === 'table' ? splitTableRows(node) : splitListItems(node);
        const memberIds: string[] = [];
        for (let r = 0; r < parts.length; r++) {
          const id = await post({ grain: 'primitive', title: `${title.trim() || b.text.slice(0, 40)} — ${singleType === 'table' ? 'row' : 'item'} ${r + 1}`, canvasNodes: [parts[r]], source: 'upload', status: 'approved', tags: allTags(kindTag(singleType)), sourceAnchor: anchor([b.id]) });
          if (id) memberIds.push(id);
        }
        if (memberIds.length) {
          const gid = await post({ grain: 'group', title: title.trim() || b.text.slice(0, 60), memberAtomIds: memberIds, source: 'upload', status: 'approved', tags: allTags(kindTag(singleType)), sourceAnchor: anchor([b.id]) });
          if (gid) made.push({ id: gid, label: title.trim() || `${singleType} group (${memberIds.length})`, grain: 'group', kind: singleType });
        }
      } else if (selectedBlocks.length > 1) {
        // Several objects → member atoms + a GROUP over them (e.g. Team Bios).
        const memberIds: string[] = [];
        for (const b of selectedBlocks) {
          const id = await post({ grain: 'primitive', title: b.text.slice(0, 60), content: b.text || null, canvasNodes: b.nodes, source: 'upload', status: 'approved', tags: allTags(kindTag(b.primaryType)), sourceAnchor: anchor([b.id]) });
          if (id) memberIds.push(id);
        }
        if (memberIds.length) {
          const gid = await post({ grain: 'group', title: title.trim() || selectedBlocks[0].text.slice(0, 60), memberAtomIds: memberIds, source: 'upload', status: 'approved', tags: allTags([]), sourceAnchor: anchor(selectedBlocks.map((b) => b.id)) });
          if (gid) made.push({ id: gid, label: title.trim() || `group (${memberIds.length})`, grain: 'group', kind: 'narrative' });
        }
      } else {
        // Single object → one atom at its natural grain (figure / table / list / narrative).
        const b = selectedBlocks[0];
        const id = await post({ grain: 'primitive', title: title.trim() || b.text.slice(0, 60), content: b.text || null, canvasNodes: b.nodes, source: 'upload', status: 'approved', tags: allTags(kindTag(b.primaryType)), sourceAnchor: anchor([b.id]) });
        if (id) made.push({ id, label: title.trim() || b.text.slice(0, 40) || TYPE_BADGE[b.primaryType].label, grain: 'primitive', kind: b.primaryType });
      }

      if (made.length) {
        setTray((p) => [...p, ...made]);
        setMsg(`Minted ${made.map((m) => m.grain).join(', ')} → added to the section tray. Tags: ${tags.length + ctxTags().length}.`);
        setSel(new Set()); setTitle(''); setTableAsRows(false); setListAsItems(false);
      }
    } catch { setMsg('Create failed'); } finally { setBusy(false); }
  }, [selectedBlocks, singleType, tableAsRows, listAsItems, title, tags, ctxTags, post, referenceId]);

  const makeSection = useCallback(async () => {
    const members = tray.filter((t) => traySel.has(t.id)).map((t) => t.id);
    if (members.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const gid = await post({ grain: 'group', title: sectionLabel.trim() || 'Section', summary: `Section — ${members.length} groups/atoms`, memberAtomIds: members, source: 'upload', status: 'approved', tags: allTags([{ dimension: 'kind', value: 'section' }]) });
      if (gid) {
        setTray((p) => [...p.filter((t) => !traySel.has(t.id)), { id: gid, label: `§ ${sectionLabel.trim() || 'Section'} (${members.length})`, grain: 'group', kind: 'narrative' }]);
        setTraySel(new Set()); setSectionLabel('');
        setMsg(`Boxed a section over ${members.length} groups/atoms.`);
      }
    } catch { setMsg('Section create failed'); } finally { setBusy(false); }
  }, [tray, traySel, sectionLabel, post, tags, ctxTags]);

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm';
  const ctxRow = (k: keyof typeof ctx, label: string, ph: string) => (
    <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-14">{label}</span>
      <input value={ctx[k]} onChange={(e) => setCtx((c) => ({ ...c, [k]: e.target.value }))} placeholder={ph} className={`${inputCls} flex-1`} /></div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: source + deconstructed objects */}
      <div className="lg:col-span-2 space-y-3">
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <label className="block text-xs text-gray-500 mb-1">Upload a document, or paste content, to deconstruct</label>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" placeholder="Paste a bio, a past-performance blurb, a whole team section…" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={shred} disabled={!raw.trim() || busy} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:opacity-50">Deconstruct</button>
            <label className="text-sm text-blue-600 hover:underline cursor-pointer">or upload a file
              <input type="file" accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.md" className="hidden" disabled={busy}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            </label>
            <span className="text-[11px] text-gray-400">figures, tables & lists are detected — nothing atomizes until you select</span>
          </div>
        </div>
        {blocks.length > 0 && (
          <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
            <div className="px-4 py-2 text-xs text-gray-500 flex justify-between">
              <span>{blocks.length} objects — select what to atomize</span>
              <span>{sel.size} selected</span>
            </div>
            {blocks.map((b) => {
              const badge = TYPE_BADGE[b.primaryType];
              return (
                <label key={b.id} className={`flex gap-2 px-4 py-2 cursor-pointer text-sm ${sel.has(b.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} className="mt-1" />
                  <span className="flex-1 min-w-0">
                    <span className={`text-[10px] uppercase mr-2 font-medium ${badge.cls}`}>{badge.label}</span>
                    <span className={b.primaryType === 'heading' ? 'font-semibold text-gray-800' : 'text-gray-700'}>{(b.heading && b.heading !== b.text ? `${b.heading} — ` : '') + b.text.slice(0, 160) || `[${badge.label}]`}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: session context · make atom/group · section tray */}
      <div className="space-y-3">
        <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-2">
          <h3 className="text-sm font-semibold">Session context <span className="font-normal text-gray-400">(the &quot;FROM&quot; pedigree)</span></h3>
          <p className="text-[11px] text-gray-500 -mt-1">Stamped on every atom you mint this session, so reuse ranks by where it came from.</p>
          {ctxRow('agency', 'agency', 'e.g. Navy')}
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-14">program</span>
            <select value={ctx.program} onChange={(e) => setCtx((c) => ({ ...c, program: e.target.value }))} className={`${inputCls} flex-1`}>{PROGRAMS.map((p) => <option key={p} value={p}>{p ? p.toUpperCase() : 'add…'}</option>)}</select></div>
          <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-14">phase</span>
            <select value={ctx.phase} onChange={(e) => setCtx((c) => ({ ...c, phase: e.target.value }))} className={`${inputCls} flex-1`}>{PHASES.map((p) => <option key={p} value={p}>{p ? `Phase ${p}` : 'add…'}</option>)}</select></div>
          {ctxRow('sol', 'solicit.', 'e.g. DON26BX03')}
          {ctxRow('topic', 'topic', 'e.g. N-P002')}
        </div>

        <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
          <h3 className="text-sm font-semibold">Mint {sel.size > 1 ? `${sel.size} objects` : singleType ? TYPE_BADGE[singleType].label : 'atom'}</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={sel.size > 1 ? 'Group label (e.g. Team Bios)' : 'Title (optional)'} className={`${inputCls} w-full`} />
          {singleType === 'table' && (
            <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={tableAsRows} onChange={(e) => setTableAsRows(e.target.checked)} />as a <b>group of rows</b> (each row a reusable atom)</label>
          )}
          {singleType === 'list' && (
            <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={listAsItems} onChange={(e) => setListAsItems(e.target.checked)} />as a <b>group of items</b> (each item a reusable atom)</label>
          )}
          {sel.size > 1 && <p className="text-[11px] text-gray-500">Several objects → a <b>group</b> ({sel.size} member atoms), e.g. &quot;Team Bios&quot;.</p>}

          <div className="space-y-1.5">
            {CURATED_DIMS.map((dim) => (
              <div key={dim} className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">{dim}</span>
                <select className={`${inputCls} flex-1`} value="" onChange={(e) => e.target.value && addTag(dim, e.target.value)}><option value="">add…</option>{(tax?.byDimension[dim] ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            ))}
            {OPEN_DIMS.map((dim) => <FreeTag key={dim} dim={dim} onAdd={(v) => addTag(dim, v, true)} inputCls={inputCls} />)}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">{tags.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">{t.dimension}:{t.value}<button onClick={() => removeTag(i)} className="text-gray-400 hover:text-rose-600">×</button></span>
            ))}</div>
          )}
          <button onClick={make} disabled={busy || sel.size === 0} className="w-full text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-2 disabled:opacity-50">
            {busy ? 'Minting…' : sel.size > 1 ? 'Make group' : (singleType === 'table' && tableAsRows) || (singleType === 'list' && listAsItems) ? 'Make group' : 'Make atom'}
          </button>
          {msg && <p className="text-xs text-gray-600">{msg}</p>}
        </div>

        {/* Section tray — box a section over the atoms/groups you minted */}
        {tray.length > 0 && (
          <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/40 space-y-2">
            <h3 className="text-sm font-semibold">Section tray <span className="font-normal text-gray-400">({tray.length})</span></h3>
            <p className="text-[11px] text-gray-500 -mt-1">Select groups/atoms and box a <b>section</b> over them (e.g. &quot;Team Section&quot;).</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {tray.map((t) => (
                <label key={t.id} className={`flex items-center gap-2 text-xs px-2 py-1 rounded cursor-pointer ${traySel.has(t.id) ? 'bg-indigo-100' : 'hover:bg-white'}`}>
                  <input type="checkbox" checked={traySel.has(t.id)} onChange={() => setTraySel((p) => { const n = new Set(p); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} />
                  <span className={`text-[9px] uppercase ${t.grain === 'group' ? 'text-indigo-500' : 'text-gray-400'}`}>{t.grain}</span>
                  <span className="flex-1 truncate text-gray-700">{t.label}</span>
                </label>
              ))}
            </div>
            <input value={sectionLabel} onChange={(e) => setSectionLabel(e.target.value)} placeholder="Section label (e.g. Team Section)" className={`${inputCls} w-full`} />
            <button onClick={makeSection} disabled={busy || traySel.size === 0} className="w-full text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded px-3 py-1.5 disabled:opacity-50">
              Box section ({traySel.size})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FreeTag({ dim, onAdd, inputCls }: { dim: string; onAdd: (v: string) => void; inputCls: string }) {
  const [v, setV] = useState('');
  return (
    <div className="flex items-center gap-2"><span className="text-[11px] text-gray-400 w-16">{dim}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } }} placeholder="free + Enter" className={`${inputCls} flex-1`} /></div>
  );
}
