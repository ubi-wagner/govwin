'use client';

/**
 * Template Canvas Editor — author a document template's canvas in the full WYSIWYG
 * editor (the "create from scratch document from canvas" surface). Saves the whole
 * CanvasDocument back to the template via PATCH. System templates open read-only
 * (use "Save as new" to fork them).
 */

import { useCallback } from 'react';
import Link from 'next/link';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { CanvasEditor } from '@/components/canvas/canvas-editor';

interface Props {
  templateId: string;
  initialDocument: CanvasDocument;
  actorId: string;
  actorName: string;
  readOnly?: boolean;
}

export function TemplateCanvasEditor({ templateId, initialDocument, actorId, actorName, readOnly = false }: Props) {
  const handleSave = useCallback(async (doc: CanvasDocument) => {
    const resp = await fetch(`/api/admin/templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvasDocument: doc }),
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new Error(json.error ?? `Save failed (HTTP ${resp.status})`);
    }
  }, [templateId]);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link href="/admin/templates" className="text-sm text-blue-600 hover:text-blue-800">&larr; Back to Templates</Link>
        <span className="text-sm text-gray-500 font-medium">{initialDocument.metadata.title}</span>
        {readOnly && <span className="text-xs text-amber-600">system template — read-only (use &ldquo;Save as new&rdquo; to edit)</span>}
      </div>
      <div className="flex-1 overflow-hidden">
        <CanvasEditor
          initialDocument={initialDocument}
          onSave={handleSave}
          actorId={actorId}
          actorName={actorName}
          readOnly={readOnly}
          variables={{ company_name: 'Your Company', topic_number: 'TBD' }}
        />
      </div>
    </div>
  );
}
