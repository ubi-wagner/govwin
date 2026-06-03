'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PageVersion } from '@/lib/content-admin';
import { ImageUploadField } from '@/components/admin/image-upload-field';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export default function DocEditorClient({
  type,
  slug,
  isNew,
  active,
  draft,
}: {
  type: string;
  slug: string;
  isNew: boolean;
  active: PageVersion | null;
  draft: PageVersion | null;
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

  const field = 'w-full border rounded px-2 py-1 text-sm mt-1';
  const lbl = 'text-xs font-medium text-gray-500';

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between mt-2 mb-4">
        <h1 className="text-2xl font-bold">{isNew ? `New ${type.replace('_', ' ')}` : title || slug}</h1>
        <div className="text-xs text-gray-500">
          {type}
          {active ? ` · live v${active.versionNo}` : ' · not live'}
          {draft ? ` · draft v${draft.versionNo}` : ''}
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
