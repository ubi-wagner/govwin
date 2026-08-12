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
import { toast } from '@/lib/toast';

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

  const handlePublish = useCallback(async () => {
    if (!window.confirm(
      'Publish this template to the shared library? It will appear in EVERY tenant\'s template ' +
      'chooser, and become read-only here (use "Save as new" to make further edits). Save your ' +
      'content first.',
    )) return;
    try {
      const resp = await fetch(`/api/admin/templates/${templateId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publish: true }),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        toast(json.error ?? 'Publish failed', 'error');
        return;
      }
      toast('Published to the shared library — every tenant can now use this template.', 'success');
      window.location.reload(); // re-load as read-only (now a system template)
    } catch {
      toast('Network error', 'error');
    }
  }, [templateId]);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link href="/admin/templates" className="text-sm text-blue-600 hover:text-blue-800">&larr; Back to Templates</Link>
        <span className="text-sm text-gray-500 font-medium">{initialDocument.metadata.title}</span>
        {readOnly ? (
          <span className="text-xs text-amber-600">shared library template — read-only (use &ldquo;Save as new&rdquo; to edit)</span>
        ) : (
          <button
            onClick={handlePublish}
            title="Publish to the shared library so every tenant can use this template"
            className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Publish to shared library
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <CanvasEditor
          initialDocument={initialDocument}
          onSave={handleSave}
          actorId={actorId}
          actorName={actorName}
          readOnly={readOnly}
          autosaveKey={`admin-template:${templateId}`}
          variables={{ company_name: 'Your Company', topic_number: 'TBD' }}
        />
      </div>
    </div>
  );
}
