'use client';

import { useState } from 'react';
import type { PageVersion, PageBlock } from '@/lib/content-admin';

interface EditBlock {
  section: string;
  displayOrder: number;
  title: string;
  body: string;
  excerpt: string;
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
    metaText: JSON.stringify(b.metadata ?? {}, null, 2),
    slug: b.slug,
    tags: b.tags,
  };
}

function toBlocks(edits: EditBlock[]): PageBlock[] {
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
      metadata,
      slug: b.slug,
      tags: b.tags,
    };
  });
}

// page_key → public path for the preview link (most are /{pageKey}).
const PREVIEW_PATHS: Record<string, string> = {
  homepage: '/',
  security: '/infosec',
  'get-started': '/pricing',
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

  const previewPath = PREVIEW_PATHS[pageKey] ?? `/${pageKey}`;

  function update(i: number, patch: Partial<EditBlock>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function add() {
    setBlocks((bs) => [...bs, { section: 'section', displayOrder: bs.length, title: '', body: '', excerpt: '', metaText: '{}' }]);
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
        blocks: toBlocks(blocks),
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
        blocks: toBlocks(blocks),
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

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between mt-2 mb-4">
        <h1 className="text-2xl font-bold">{pageKey}</h1>
        <div className="text-xs text-gray-500">
          {active ? `live v${active.versionNo}` : 'no live version'}
          {draft ? ` · draft v${draft.versionNo}` : ''}
        </div>
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
            <textarea
              className="w-full border rounded px-2 py-1 text-xs font-mono"
              rows={3}
              placeholder="metadata (JSON)"
              value={b.metaText}
              onChange={(e) => update(i, { metaText: e.target.value })}
            />
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
        <a
          href={`${previewPath}?_preview=1`}
          target="_blank"
          rel="noreferrer"
          className="px-4 py-2 rounded border text-sm"
        >
          Preview &#8599;
        </a>
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
    </div>
  );
}
