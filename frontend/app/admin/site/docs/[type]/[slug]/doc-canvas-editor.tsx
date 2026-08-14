'use client';

/**
 * Site Doc Canvas Editor — canvas-native authoring for front-facing content documents
 * (blog_post / resource / guide / testimonial / team_member). The proposal Canvas is the
 * stage; a collapsible "Post details" panel holds the metadata; a top ribbon owns
 * Save draft / Publish / Retire·Restore / View live. The CanvasDocument is the source of
 * truth — the server projects the public HTML body from it on save (see
 * docs/CONTENT_STUDIO_DESIGN.md). Mirrors components/admin/template-canvas-editor.tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from '@/lib/toast';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import type { PageVersion } from '@/lib/content-admin';
import { CanvasEditor } from '@/components/canvas/canvas-editor';
import { ImageUploadField } from '@/components/admin/image-upload-field';

// Public detail path per doc type (matches the publish route). Only blog_post/resource/guide have a
// detail page; testimonial/team_member surface on a list page, so "View live" targets the list there.
const VIEW_LIVE_PATH: Record<string, (slug: string) => string> = {
  blog_post: (s) => `/resources/${encodeURIComponent(s)}`,
  resource: (s) => `/resources/${encodeURIComponent(s)}`,
  guide: (s) => `/resources/${encodeURIComponent(s)}`,
  testimonial: () => '/customers',
  team_member: () => '/team',
};

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

interface Props {
  type: string;
  slug: string;
  isNew: boolean;
  active: PageVersion | null;
  draft: PageVersion | null;
  canRestore: boolean;
  initialDocument: CanvasDocument;
  actorId: string;
  actorName: string;
}

export function SiteDocCanvasEditor({
  type, slug, isNew, active, draft, canRestore, initialDocument, actorId, actorName,
}: Props) {
  const router = useRouter();
  const src = draft ?? active;
  const meta0 = (src?.metadata ?? {}) as Record<string, unknown>;

  // ── Metadata state (the "Post details" panel) ──────────────────────────────
  const [title, setTitle] = useState(src?.title ?? '');
  const [slugVal, setSlugVal] = useState(slug);
  const [excerpt, setExcerpt] = useState(typeof meta0.excerpt === 'string' ? meta0.excerpt : '');
  const [tags, setTags] = useState(Array.isArray(meta0.tags) ? (meta0.tags as string[]).join(', ') : '');
  const [featuredImage, setFeaturedImage] = useState(typeof meta0.featuredImage === 'string' ? meta0.featuredImage : '');
  const [externalUrl, setExternalUrl] = useState(typeof meta0.externalUrl === 'string' ? meta0.externalUrl : '');
  const [author, setAuthor] = useState(typeof meta0.author === 'string' ? meta0.author : '');
  const [note, setNote] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false); // mirrored from the editor so the ribbon can disable during a save

  const effectiveSlug = isNew ? (slugVal.trim() || slugify(title)) : slug;

  // Mirror the fields into refs so the editor's async onSave closure always reads fresh values.
  // (The CanvasEditor owns the unsaved-changes nav guard for the BODY — we intentionally do NOT add
  //  a second useUnsavedChanges consumer here: two writers stomp the one shared flag and could drop
  //  the flag while the canvas is still dirty, losing body edits on in-app nav. Metadata edits are
  //  always saveable via the ribbon "Save draft".)
  const metaRef = useRef({ title, excerpt, tags, featuredImage, externalUrl, author, note, effectiveSlug, isNew });
  useEffect(() => {
    metaRef.current = { title, excerpt, tags, featuredImage, externalUrl, author, note, effectiveSlug, isNew };
  }, [title, excerpt, tags, featuredImage, externalUrl, author, note, effectiveSlug, isNew]);

  const publishAfterSaveRef = useRef(false);
  const triggerSaveRef = useRef<(() => void) | null>(null);

  // ── The editor calls this with the latest canvas. We POST canvas + metadata; the
  //    server projects the public HTML body from the canvas. Optionally publish after. ──
  const handleCanvasSave = useCallback(async (docFromEditor: CanvasDocument) => {
    // Capture + clear the publish intent immediately, so a save that throws below can never leave the
    // flag set for a later plain Save/Ctrl-S to silently publish (the inner editor's Save bypasses onSaveDraft).
    const shouldPublish = publishAfterSaveRef.current;
    publishAfterSaveRef.current = false;
    const m = metaRef.current;
    if (!m.title.trim()) { toast('Title is required — open Post details.', 'error'); throw new Error('Title is required'); }
    if (!m.effectiveSlug) { toast('Slug is required — open Post details.', 'error'); throw new Error('Slug is required'); }
    const res = await fetch(`/api/admin/site/docs/${type}/${encodeURIComponent(m.effectiveSlug)}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvas: docFromEditor,
        title: m.title,
        excerpt: m.excerpt || null,
        tags: m.tags.split(',').map((t) => t.trim()).filter(Boolean),
        featuredImage: m.featuredImage || null,
        externalUrl: m.externalUrl || null,
        author: m.author || null,
        note: m.note || 'Saved',
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as { error?: string }));
      const msg = j.error ?? `Save failed (HTTP ${res.status})`;
      toast(msg, 'error');
      throw new Error(msg);
    }
    // First save of a brand-new doc — move to the canonical URL + sync local slug so publish/status
    // target it and the editor no longer behaves as "new".
    if (m.isNew) { setSlugVal(m.effectiveSlug); router.replace(`/admin/site/docs/${type}/${encodeURIComponent(m.effectiveSlug)}`); }

    if (shouldPublish) {
      const pres = await fetch(`/api/admin/site/docs/${type}/${encodeURIComponent(m.effectiveSlug)}/publish`, { method: 'POST' });
      if (pres.ok) { toast('Published — live on the site.', 'success'); router.refresh(); }
      else { const j = await pres.json().catch(() => ({} as { error?: string })); toast(j.error ?? 'Publish failed', 'error'); }
    } else {
      toast('Draft saved.', 'success');
    }
  }, [type, router]);

  const onSaveDraft = useCallback(() => { publishAfterSaveRef.current = false; triggerSaveRef.current?.(); }, []);
  const onPublish   = useCallback(() => { publishAfterSaveRef.current = true;  triggerSaveRef.current?.(); }, []);

  // Retire the live version (reversible) or restore the most recent retired one.
  const onStatus = useCallback(async (action: 'archive' | 'restore') => {
    if (action === 'archive' && !window.confirm('Retire this posting? It is pulled from the public site (reversible — you can Restore it later).')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/site/docs/${type}/${encodeURIComponent(slug)}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (res.ok) { toast(action === 'archive' ? 'Retired — no longer public.' : 'Restored — live again.', 'success'); router.refresh(); }
      else { const j = await res.json().catch(() => ({} as { error?: string })); toast(j.error ?? 'Action failed', 'error'); }
    } finally { setBusy(false); }
  }, [type, slug, router]);

  const typeLabel = type.replace(/_/g, ' ');
  const lbl = 'text-xs font-medium text-gray-500';
  const field = 'w-full border rounded px-2 py-1 text-sm mt-1';

  return (
    <div className="h-screen flex flex-col">
      {/* Top ribbon — identity + lifecycle actions */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 shrink-0">
        <Link href="/admin/site" className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap">&larr; Site Content</Link>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{title || slug || `New ${typeLabel}`}</div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <span className="uppercase tracking-wide">{typeLabel}</span>
            {active && <span className="text-green-700">Live v{active.versionNo} · {fmtWhen(active.publishedAt)} · {shortActor(active.createdBy)}</span>}
            {draft && <span className="text-yellow-700">Draft v{draft.versionNo}</span>}
            {!active && !isNew && <span>not live</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPanelOpen((v) => !v)} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50" title="Title, slug, excerpt, tags, featured image">
            {panelOpen ? 'Hide details' : 'Post details'}
          </button>
          {!isNew && active && VIEW_LIVE_PATH[type] && (
            <a href={VIEW_LIVE_PATH[type](slug)} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50">View live &#8599;</a>
          )}
          {!isNew && active && (
            <button disabled={busy || saving} onClick={() => onStatus('archive')} className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">Retire</button>
          )}
          {!isNew && !active && canRestore && (
            <button disabled={busy || saving} onClick={() => onStatus('restore')} className="text-xs px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50">Restore</button>
          )}
          <button disabled={busy || saving} onClick={onSaveDraft} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50 disabled:opacity-50">{saving ? 'Saving…' : 'Save draft'}</button>
          <button disabled={busy || saving} onClick={onPublish} className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Working…' : 'Publish'}</button>
        </div>
      </div>

      {/* Stage — canvas + collapsible details panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <CanvasEditor
            initialDocument={initialDocument}
            onSave={handleCanvasSave}
            actorId={actorId}
            actorName={actorName}
            autosaveKey={`admin-site-doc:${type}:${isNew ? 'new' : slug}`}
            variables={{}}
            triggerSaveRef={triggerSaveRef}
            onSavingChange={setSaving}
          />
        </div>
        {panelOpen && (
          <aside className="w-72 border-l bg-gray-50 overflow-y-auto shrink-0 p-3 space-y-3">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Post details</div>
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
              <textarea className={field} rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
            </label>
            <label className="block">
              <span className={lbl}>Tags (comma-separated)</span>
              <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label className="block">
              <span className={lbl}>Author</span>
              <input className={field} value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <div className="block">
              <span className={lbl}>Featured image</span>
              <ImageUploadField className="mt-1" value={featuredImage} onChange={setFeaturedImage} />
            </div>
            <label className="block">
              <span className={lbl}>External URL (optional)</span>
              <input className={field} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
            </label>
            <label className="block">
              <span className={lbl}>Audit note</span>
              <input className={field} placeholder="What changed?" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="text-[11px] text-gray-400 leading-snug pt-1">
              The body is authored in the canvas on the left. Save writes a draft; Publish makes it live and refreshes the public page.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
