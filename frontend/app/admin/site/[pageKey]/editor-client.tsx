'use client';

import { useState } from 'react';
import type { PageVersion, PageBlock } from '@/lib/content-admin';
import { ImageUploadField } from '@/components/admin/image-upload-field';

function shortActor(s: string | null): string {
  return !s ? 'system' : s.includes('@') ? s.split('@')[0] : s;
}
function fmtWhen(d: Date | string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface EditBlock {
  section: string;
  displayOrder: number;
  title: string;
  body: string;
  excerpt: string;
  featuredImage: string;
  metaText: string;
  slug?: string;
  tags?: string[];
}

function toEdit(b: PageBlock): EditBlock {
  return {
    section: b.section ?? 'section',
    displayOrder: b.displayOrder ?? 0,
    title: b.title ?? '',
    body: b.body ?? '',
    excerpt: b.excerpt ?? '',
    featuredImage: b.featuredImage ?? '',
    metaText: JSON.stringify(b.metadata ?? {}, null, 2),
    slug: b.slug,
    tags: b.tags,
  };
}

function toBlocks(edits: EditBlock[], pageKey: string): PageBlock[] {
  return edits.map((b, i) => {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = b.metaText.trim() ? JSON.parse(b.metaText) : {};
    } catch {
      metadata = {};
    }
    return {
      section: b.section,
      displayOrder: i,
      title: b.title,
      body: b.body,
      excerpt: b.excerpt,
      featuredImage: b.featuredImage.trim() || null,
      metadata,
      slug: b.slug,
      // Keep tags in lockstep with the section so the public render (buildLookup)
      // and the editor agree on grouping — section is authoritative.
      tags: [pageKey, b.section],
    };
  });
}

// page_key → public path for the preview link (most are /{pageKey}).
const PREVIEW_PATHS: Record<string, string> = {
  homepage: '/',
  security: '/infosec',
  'get-started': '/pricing',
  // Header/footer show on every page; preview against the homepage. (Chrome
  // preview reflects the published version — publish to see edits live.)
  'site-chrome': '/',
};

export default function EditorClient({
  pageKey,
  active,
  draft,
}: {
  pageKey: string;
  active: PageVersion | null;
  draft: PageVersion | null;
}) {
  const initial = (draft ?? active)?.blocks ?? [];
  const [blocks, setBlocks] = useState<EditBlock[]>(initial.map(toEdit));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);

  const previewPath = PREVIEW_PATHS[pageKey] ?? `/${pageKey}`;

  function update(i: number, patch: Partial<EditBlock>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function add() {
    setBlocks((bs) => [...bs, { section: 'section', displayOrder: bs.length, title: '', body: '', excerpt: '', featuredImage: '', metaText: '{}' }]);
  }
  function remove(i: number) {
    setBlocks((bs) => bs.filter((_, idx) => idx !== i));
  }

  async function postJSON(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, json };
  }

  function versionOf(json: Record<string, unknown>): unknown {
    const data = json.data as Record<string, unknown> | undefined;
    return data?.versionNo;
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const { ok, json } = await postJSON(`/api/admin/site/pages/${encodeURIComponent(pageKey)}/save`, {
        blocks: toBlocks(blocks, pageKey),
        note: note || 'Saved',
      });
      setMsg(ok ? `Saved draft v${versionOf(json)}.` : String(json.error ?? 'Save failed'));
      if (ok) setNote('');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await postJSON(`/api/admin/site/pages/${encodeURIComponent(pageKey)}/save`, {
        blocks: toBlocks(blocks, pageKey),
        note: note || 'Pre-publish save',
      });
      if (!saved.ok) {
        setMsg(String(saved.json.error ?? 'Save failed'));
        return;
      }
      const { ok, json } = await postJSON(`/api/admin/site/pages/${encodeURIComponent(pageKey)}/publish`, {
        note: note || 'Published',
      });
      setMsg(ok ? `Published v${versionOf(json)} — live.` : String(json.error ?? 'Publish failed'));
      if (ok) setNote('');
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    await save();
    setPreviewNonce((n) => n + 1);
    setPreview(true);
  }

  return (
    <div className="pb-24">
      <div className="mt-2 mb-5">
        <h1 className="text-2xl font-bold">{pageKey}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {active ? (
            <span className="text-gray-500">
              <span className="text-green-700 font-medium">Live v{active.versionNo}</span> · published {fmtWhen(active.publishedAt)} by {shortActor(active.createdBy)}
            </span>
          ) : (
            <span className="text-gray-500">Using page defaults — publish to make it live</span>
          )}
          {draft && (
            <span className="text-yellow-700">
              Draft v{draft.versionNo} · saved {fmtWhen(draft.createdAt)} by {shortActor(draft.createdBy)}
            </span>
          )}
        </div>
        {(draft ?? active)?.auditNote && (
          <div className="mt-1 text-xs text-gray-400">Last note: &ldquo;{(draft ?? active)?.auditNote}&rdquo;</div>
        )}
      </div>

      <div className="space-y-4">
        {blocks.map((b, i) => (
          <div key={i} className="border rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between mb-2">
              <input
                className="text-xs font-mono bg-gray-100 px-2 py-1 rounded w-48"
                value={b.section}
                onChange={(e) => update(i, { section: e.target.value })}
              />
              <button className="text-xs text-red-600 hover:underline" onClick={() => remove(i)}>
                remove
              </button>
            </div>
            <input
              className="w-full border rounded px-2 py-1 mb-2 text-sm"
              placeholder="Title"
              value={b.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <textarea
              className="w-full border rounded px-2 py-1 mb-2 text-sm"
              rows={3}
              placeholder="Body"
              value={b.body}
              onChange={(e) => update(i, { body: e.target.value })}
            />
            <input
              className="w-full border rounded px-2 py-1 mb-2 text-sm"
              placeholder="Excerpt"
              value={b.excerpt}
              onChange={(e) => update(i, { excerpt: e.target.value })}
            />
            <ImageUploadField
              className="mb-2"
              value={b.featuredImage}
              onChange={(url) => update(i, { featuredImage: url })}
              placeholder="Image URL (optional), or upload →"
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-xs font-mono"
              rows={3}
              placeholder="metadata (JSON)"
              value={b.metaText}
              onChange={(e) => update(i, { metaText: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Tip: in titles/headings use <code>*text*</code> for an accent and a new line for a line break.
            </p>
          </div>
        ))}
        <button className="text-sm text-blue-600 hover:underline" onClick={add}>
          + Add block
        </button>
      </div>

      <div className="fixed bottom-0 left-64 right-0 bg-white border-t px-8 py-3 flex items-center gap-3">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          placeholder="Audit note (what changed?)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button onClick={openPreview} disabled={busy} className="px-4 py-2 rounded border text-sm disabled:opacity-50">
          Preview
        </button>
        <button disabled={busy} onClick={save} className="px-4 py-2 rounded border text-sm disabled:opacity-50">
          Save draft
        </button>
        <button
          disabled={busy}
          onClick={publish}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          Publish
        </button>
      </div>
      {msg && <div className="fixed bottom-20 right-8 text-sm bg-gray-900 text-white px-3 py-1.5 rounded shadow">{msg}</div>}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex flex-col">
          <div className="bg-white px-4 py-2 flex items-center justify-between border-b">
            <div className="text-sm font-medium">Preview (draft) &mdash; {pageKey}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPreview(false)} className="px-3 py-1.5 rounded border text-sm">
                Close
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  await publish();
                  setPreview(false);
                }}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              >
                Publish
              </button>
            </div>
          </div>
          <iframe
            key={previewNonce}
            src={`${previewPath}?_preview=1&_t=${previewNonce}`}
            className="flex-1 w-full bg-white"
            title="Draft preview"
          />
        </div>
      )}
    </div>
  );
}
