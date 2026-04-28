'use client';

/**
 * Canvas Editor Page — wraps CanvasEditor with save/export wiring.
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CanvasEditor } from './canvas-editor';
import { useTool } from '@/lib/hooks/use-tool';

interface Props {
  canvasDocument: CanvasDocument;
  sectionId: string;
  proposalId: string;
  actorId: string;
  actorName: string;
  readOnly?: boolean;
  tenantSlug?: string;
}

export function CanvasEditorPage({
  canvasDocument,
  sectionId,
  proposalId,
  actorId,
  actorName,
  readOnly = false,
  tenantSlug,
}: Props) {
  const router = useRouter();
  const { invoke } = useTool();

  const saveUrl = tenantSlug
    ? `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/save`
    : `/api/admin/proposals/${proposalId}/sections/${sectionId}`;

  const backUrl = tenantSlug
    ? `/portal/${tenantSlug}/proposals/${proposalId}`
    : `/admin/proposals/${proposalId}`;

  const handleSave = useCallback(async (doc: CanvasDocument) => {
    const resp = await fetch(saveUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: doc }),
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new Error(json.error ?? `Save failed (HTTP ${resp.status})`);
    }
  }, [saveUrl]);

  const handleExport = useCallback(async (doc: CanvasDocument, format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => {
    const resp = await fetch(`/api/admin/proposals/${proposalId}/sections/${sectionId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: doc, format }),
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new Error(json.error ?? `Export failed (HTTP ${resp.status})`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `${doc.metadata.title || 'document'}.${format}`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }, [proposalId, sectionId]);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link
          href={backUrl}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; Back to Proposal
        </Link>
        <span className="text-sm text-gray-400">{canvasDocument.metadata.title}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <CanvasEditor
          initialDocument={canvasDocument}
          onSave={handleSave}
          onExport={handleExport}
          actorId={actorId}
          actorName={actorName}
          readOnly={readOnly}
          variables={{
            company_name: 'Your Company',
            topic_number: 'TBD',
          }}
        />
      </div>
    </div>
  );
}
