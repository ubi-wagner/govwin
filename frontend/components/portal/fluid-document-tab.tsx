'use client';

/**
 * FluidDocumentTab — the workspace "Document" tab (fluid-canvas F1).
 *
 * Lazily fetches the whole-proposal assembled canvas (GET …/document) the first time
 * the tab is opened, then renders it as one continuous fluid document with an outline
 * rail + the selection→atomize toolbar (FluidDocumentView). Kept as a thin data wrapper
 * so the heavy renderer only loads when the reader actually opens the tab.
 */
import { useEffect, useState } from 'react';
import type { AssembledProposal } from '@/lib/canvas/assemble-proposal';
import { FluidDocumentView } from '@/components/canvas/fluid-document-view';

interface Props {
  tenantSlug: string;
  proposalId: string;
  /** Substitution variables for header/footer (proposal title, etc.). */
  variables?: Record<string, string>;
}

export function FluidDocumentTab({ tenantSlug, proposalId, variables }: Props) {
  const [assembled, setAssembled] = useState<AssembledProposal | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/document`, { cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !j?.data) { setState('error'); return; }
        const data = j.data as AssembledProposal;
        if (!data.outline?.length) { setState('empty'); return; }
        setAssembled(data);
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, [tenantSlug, proposalId]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        <span className="animate-pulse">Assembling the document…</span>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-8 text-center text-sm text-rose-600">
        Could not assemble the document view. Try reloading.
      </div>
    );
  }
  if (state === 'empty' || !assembled) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
        This proposal has no sections yet.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-2 md:p-3 h-[calc(100vh-14rem)] min-h-[520px]">
      <FluidDocumentView assembled={assembled} tenantSlug={tenantSlug} proposalId={proposalId} variables={variables} />
    </div>
  );
}
