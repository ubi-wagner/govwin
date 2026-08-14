'use client';

/**
 * Template Stable Gallery (template bridge Phase 2, docs/TEMPLATE_BRIDGE_DESIGN.md).
 *
 * The tenant's OWNED pristine-template shelf, presented as cards "across the
 * bridge" — a 1:1 mirror of the opportunity-card gallery. Every card is a
 * skeleton the tenant owns (copied on creation via the template bridge, mig 177);
 * nothing here is a live shared read. From a card the tenant can:
 *   • Preview the pristine canvas (read-only, anchors {like_this} intact), and
 *   • "Use this template" → copy-create-add a fresh, editable document into the
 *     workspace (the instance is the artifact; the skeleton is reusable).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CanvasRenderer } from '@/components/canvas/canvas-renderer';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';
import { toast } from '@/lib/toast';

// Field names arrive camelCase via @/lib/db's snake→camel transform.
interface TemplateCard {
  id: string;
  templateKey: string;
  title: string;
  category: string;
  agency: string | null;
  format: string;
  bridgeVersion: number;
  updateAvailable: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  dod_dow: 'DoD / DoW', nsf: 'NSF', doe: 'DOE',
  marketing: 'Marketing', commercialization: 'Commercialization', investment: 'Investment',
  tech: 'Tech Overviews', company: 'Company', grants: 'Grants',
};

const FORMAT_BADGE: Record<string, { label: string; cls: string }> = {
  document: { label: 'DOC', cls: 'bg-blue-100 text-blue-700' },
  deck: { label: 'DECK', cls: 'bg-orange-100 text-orange-700' },
  spreadsheet: { label: 'SHEET', cls: 'bg-green-100 text-green-700' },
};

export function TemplateStableGallery({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [cards, setCards] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [usingId, setUsingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ card: TemplateCard; doc: CanvasDocument | null; loading: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/template-cards`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) setCards((json.data?.cards ?? []) as TemplateCard[]);
        else setError(json.error ?? 'Could not load templates');
      } catch {
        if (!cancelled) setError('Could not load templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((c) => [c.title, CATEGORY_LABEL[c.category] ?? c.category, c.agency ?? '']
      .join(' ').toLowerCase().includes(needle));
  }, [cards, q]);

  const grouped = useMemo(() => {
    const by = new Map<string, TemplateCard[]>();
    for (const c of filtered) {
      const k = c.category;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(c);
    }
    return Array.from(by.entries()).sort((a, b) => (CATEGORY_LABEL[a[0]] ?? a[0]).localeCompare(CATEGORY_LABEL[b[0]] ?? b[0]));
  }, [filtered]);

  const openPreview = useCallback(async (card: TemplateCard) => {
    setPreview({ card, doc: null, loading: true });
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/template-cards/${card.id}`);
      const json = await res.json();
      if (res.ok) setPreview({ card, doc: (json.data?.card?.canvasDocument ?? null) as CanvasDocument | null, loading: false });
      else { setPreview(null); toast.error(json.error ?? 'Could not load preview'); }
    } catch {
      setPreview(null); toast.error('Could not load preview');
    }
  }, [tenantSlug]);

  const useTemplate = useCallback(async (card: TemplateCard) => {
    setUsingId(card.id);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/template-cards/${card.id}/use`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not create the document');
      toast.success('Document created from template');
      router.push(`/portal/${tenantSlug}/documents/${json.data.documentId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the document');
      setUsingId(null);
    }
  }, [tenantSlug, router]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Templates</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Your stable of pristine starting points — agency proposal volumes, brochures, capability
            decks and more. Every template is yours to reuse; using one creates a fresh, editable
            document you fill in. The skeleton stays put.
          </p>
        </div>
        <Link href={`/portal/${tenantSlug}/documents`} className="text-sm text-blue-600 hover:underline whitespace-nowrap mt-1">
          Your documents →
        </Link>
      </div>

      <div className="my-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter templates…"
          className="w-full max-w-sm border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {loading && <p className="text-sm text-gray-400 py-10 text-center">Loading your templates…</p>}
      {error && !loading && <p className="text-sm text-red-600 py-6">{error}</p>}
      {!loading && !error && cards.length === 0 && (
        <div className="border rounded-lg bg-gray-50 py-10 text-center">
          <p className="text-sm text-gray-500">No templates on your shelf yet.</p>
        </div>
      )}
      {!loading && !error && cards.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-gray-400 py-8 text-center">No templates match “{q}”.</p>
      )}

      <div className="space-y-8">
        {grouped.map(([category, list]) => (
          <section key={category}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              {CATEGORY_LABEL[category] ?? category} <span className="text-gray-300">· {list.length}</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((card) => {
                const badge = FORMAT_BADGE[card.format] ?? { label: card.format.toUpperCase(), cls: 'bg-gray-100 text-gray-600' };
                return (
                  <div key={card.id} className="border rounded-xl bg-white p-4 flex flex-col gap-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                      {card.updateAvailable && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="A newer version of this template is available">
                          Update available
                        </span>
                      )}
                    </div>
                    <div className="min-h-[2.5rem]">
                      <h3 className="text-sm font-semibold text-gray-900 leading-snug">{card.title}</h3>
                      {card.agency && <p className="text-xs text-gray-500 mt-0.5">{card.agency}</p>}
                    </div>
                    <div className="flex items-center gap-2 mt-auto pt-1">
                      <button
                        onClick={() => useTemplate(card)}
                        disabled={usingId === card.id}
                        className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {usingId === card.id ? 'Creating…' : 'Use this template'}
                      </button>
                      <button
                        onClick={() => openPreview(card)}
                        className="px-3 py-1.5 border text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {preview && (
        <PreviewDrawer
          card={preview.card}
          doc={preview.doc}
          loading={preview.loading}
          busy={usingId === preview.card.id}
          onClose={() => setPreview(null)}
          onUse={() => useTemplate(preview.card)}
        />
      )}
    </div>
  );
}

function PreviewDrawer({ card, doc, loading, busy, onClose, onUse }: {
  card: TemplateCard; doc: CanvasDocument | null; loading: boolean; busy: boolean;
  onClose: () => void; onUse: () => void;
}) {
  const noop = useCallback((_id: string | null) => {}, []);
  const noopUpdate = useCallback((_id: string, _c: CanvasNode['content']) => {}, []);
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="ml-auto relative h-full w-full max-w-3xl bg-gray-50 shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-3 border-b bg-white">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">{card.title}</h2>
            <p className="text-xs text-gray-500">{card.agency ? `${card.agency} · ` : ''}Pristine template — anchors stay until you fill them</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onUse} disabled={busy} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Creating…' : 'Use this template'}
            </button>
            <button onClick={onClose} className="px-3 py-1.5 border text-gray-600 text-xs rounded-lg hover:bg-gray-50">Close</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading && <p className="text-sm text-gray-400 py-10 text-center">Loading preview…</p>}
          {!loading && !doc && <p className="text-sm text-gray-400 py-10 text-center">Preview unavailable.</p>}
          {!loading && doc && (
            <div className="border rounded-lg overflow-hidden bg-white">
              <CanvasRenderer document={doc} selectedNodeId={null} onSelectNode={noop} onUpdateNode={noopUpdate} readOnly />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
