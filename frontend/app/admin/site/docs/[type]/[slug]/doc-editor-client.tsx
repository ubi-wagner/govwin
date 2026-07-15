'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PageVersion } from '@/lib/content-admin';
import { ImageUploadField } from '@/components/admin/image-upload-field';
import { useUnsavedChanges } from '@/components/admin/admin-nav-context';

function shortActor(s: string | null): string {
  return !s ? 'system' : s.includes('@') ? s.split('@')[0] : s;
}
function fmtWhen(d: Date | string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export default function DocEditorClient({
  type,
  slug,
  isNew,
  active,
  draft,
  canRestore,
}: {
  type: string;
  slug: string;
  isNew: boolean;
  active: PageVersion | null;
  draft: PageVersion | null;
  canRestore: boolean;
}) {
  const router = useRouter();
  const src = draft ?? active;
  const block0 = (src?.blocks?.[0] ?? {}) as Record<string, unknown>;
  const meta = (src?.metadata ?? {}) as Record<string, unknown>;

  const [title, setTitle] = useState(src?.title ?? '');
  const [slugVal, setSlugVal] = useState(slug);
  const [body, setBody] = useState(typeof block0.body === 'string' ? block0.body : '');
  const [excerpt, setExcerpt] = useState(typeof meta.excerpt === 'string' ? meta.excerpt : '');
  const [tags, setTags] = useState(Array.isArray(meta.tags) ? (meta.tags as string[]).join(', ') : '');
  const [featuredImage, setFeaturedImage] = useState(typeof meta.featuredImage === 'string' ? meta.featuredImage : '');
  const [externalUrl, setExternalUrl] = useState(typeof meta.externalUrl === 'string' ? meta.externalUrl : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Unsaved-changes guard: compare the current field values against the last saved snapshot.
  const snapshot = JSON.stringify({ title, slugVal, body, excerpt, tags, featuredImage, externalUrl });
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  useUnsavedChanges(snapshot !== savedSnapshot);

  const effectiveSlug = isNew ? (slugVal.trim() || slugify(title)) : slug;

  function payload() {
    return {
      title,
      body,
      excerpt,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      featuredImage: featuredImage || null,
      externalUrl: externalUrl || null,
      note: note || 'Saved',
    };
  }

  async function post(path: string, b?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, json };
  }

  async function save(): Promise<boolean> {
    if (!title.trim()) {
      setMsg('Title is required');
      return false;
    }
    const s = effectiveSlug;
    if (!s) {
      setMsg('Slug is required');
      return false;
    }
    const { ok, json } = await post(`/api/admin/site/docs/${type}/${encodeURIComponent(s)}/save`, payload());
    if (!ok) {
      setMsg(String(json.error ?? 'Save failed'));
      return false;
    }
    setMsg('Saved draft.');
    setSavedSnapshot(snapshot);
    if (isNew) router.replace(`/admin/site/docs/${type}/${encodeURIComponent(s)}`);
    return true;
  }

  async function onSave() {
    setBusy(true);
    setMsg(null);
    try {
      await save();
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    setBusy(true);
    setMsg(null);
    try {
      if (!(await save())) return;
      const { ok, json } = await post(`/api/admin/site/docs/${type}/${encodeURIComponent(effectiveSlug)}/publish`);
      setMsg(ok ? 'Published — live.' : String(json.error ?? 'Publish failed'));
    } finally {
      setBusy(false);
    }
  }

  // Retire the live version (reversible via Restore — version history is kept) or
  // bring the most recent retired version back live.
  async function onStatus(action: 'archive' | 'restore') {
    if (action === 'archive' && !window.confirm('Retire this posting? It will be pulled from the public site. You can restore it later.')) return;
    setBusy(true);
    setMsg(null);
    try {
      const { ok, json } = await post(`/api/admin/site/docs/${type}/${encodeURIComponent(slug)}/status`, { action });
      if (ok) {
        setMsg(action === 'archive' ? 'Retired — no longer public.' : 'Restored — live again.');
        router.refresh();
      } else {
        setMsg(String(json.error ?? (action === 'archive' ? 'Retire failed' : 'Restore failed')));
      }
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full border rounded px-2 py-1 text-sm mt-1';
  const lbl = 'text-xs font-medium text-gray-500';

  return (
    <div className="pb-24">
      <div className="mt-2 mb-4">
        <h1 className="text-2xl font-bold">{isNew ? `New ${type.replace('_', ' ')}` : title || slug}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span className="uppercase tracking-wide">{type.replace('_', ' ')}</span>
          {active ? (
            <span><span className="text-green-700 font-medium">Live v{active.versionNo}</span> · published {fmtWhen(active.publishedAt)} by {shortActor(active.createdBy)}</span>
          ) : !isNew ? (
            <span>not live</span>
          ) : null}
          {draft && (
            <span className="text-yellow-700">Draft v{draft.versionNo} · saved {fmtWhen(draft.createdAt)} by {shortActor(draft.createdBy)}</span>
          )}
        </div>
      </div>

      <div className="space-y-3 bg-white border rounded-lg p-4">
        <label className="block">
          <span className={lbl}>Title</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {isNew && (
          <label className="block">
            <span className={lbl}>Slug</span>
            <input className={`${field} font-mono`} value={slugVal} placeholder={slugify(title) || 'auto-from-title'} onChange={(e) => setSlugVal(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className={lbl}>Excerpt</span>
          <input className={field} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        </label>
        <label className="block">
          <span className={lbl}>Body (markdown)</span>
          <textarea className={`${field} font-mono`} rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={lbl}>Tags (comma-separated)</span>
            <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="block">
            <span className={lbl}>Featured image</span>
            <ImageUploadField className="mt-1" value={featuredImage} onChange={setFeaturedImage} />
          </label>
        </div>
        <label className="block">
          <span className={lbl}>External URL (optional)</span>
          <input className={field} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
        </label>
      </div>

      <div className="fixed bottom-0 left-64 right-0 bg-white border-t px-8 py-3 flex items-center gap-3">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          placeholder="Audit note (what changed?)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {!isNew && active && (
          <button
            disabled={busy}
            onClick={() => onStatus('archive')}
            className="px-4 py-2 rounded border border-amber-300 text-amber-700 text-sm disabled:opacity-50 hover:bg-amber-50"
          >
            Retire
          </button>
        )}
        {!isNew && !active && canRestore && (
          <button
            disabled={busy}
            onClick={() => onStatus('restore')}
            className="px-4 py-2 rounded border border-green-300 text-green-700 text-sm disabled:opacity-50 hover:bg-green-50"
          >
            Restore
          </button>
        )}
        {!isNew && active && (
          <a href={`/resources/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" className="px-4 py-2 rounded border text-sm">
            View live &#8599;
          </a>
        )}
        <button disabled={busy} onClick={onSave} className="px-4 py-2 rounded border text-sm disabled:opacity-50">
          Save draft
        </button>
        <button disabled={busy} onClick={onPublish} className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">
          Publish
        </button>
      </div>
      {msg && <div className="fixed bottom-20 right-8 text-sm bg-gray-900 text-white px-3 py-1.5 rounded shadow">{msg}</div>}
    </div>
  );
}
