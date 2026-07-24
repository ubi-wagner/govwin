'use client';

/**
 * Canvas Editor Page — wraps CanvasEditor with save/export wiring.
 *
 * One shell, two targets (the canvas itself is identical — only the persistence
 * routes and back-link differ, docs/CANVAS_GEOMETRY_REDESIGN.md §8a):
 *   • SECTION mode  — a proposal volume section (proposalId + sectionId given).
 *   • DOCUMENT mode — a standalone tenant document (documentId given, Tier 2 #3).
 * The proposal-scoped section tools (atomize-node, comments, complete-&-lock)
 * light up only in section mode because proposalId/sectionId aren't threaded to
 * the editor for a standalone document.
 */

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import type { CanvasCapabilities } from '@/lib/canvas/capabilities';
import { CanvasEditor } from './canvas-editor';

interface Props {
  canvasDocument: CanvasDocument;
  /** Section mode: the proposal section this canvas belongs to. */
  sectionId?: string;
  proposalId?: string;
  /** Document mode: the standalone tenant_documents row this canvas belongs to. */
  documentId?: string;
  /** Foundation mode: a library foundation artifact (decompose-on-save). */
  foundationId?: string;
  actorId: string;
  actorName: string;
  readOnly?: boolean;
  /** Resolved tool set (role × stage × permission) — threaded to the canvas. */
  capabilities?: CanvasCapabilities;
  /** Process stage — orders the sidebar toolbox. */
  stage?: string;
  tenantSlug?: string;
  initialVersion?: number;
}

export function CanvasEditorPage({
  canvasDocument,
  sectionId,
  proposalId,
  documentId,
  foundationId,
  actorId,
  actorName,
  readOnly = false,
  capabilities,
  stage,
  tenantSlug,
  initialVersion,
}: Props) {
  const router = useRouter();
  // The DB row version this editor loaded — sent as baseVersion so the save is a
  // real optimistic lock (reject if someone else saved since load), and synced
  // forward from each successful save so subsequent saves stay in step.
  const versionRef = useRef<number | undefined>(initialVersion);

  const isFoundation = Boolean(foundationId);
  const isDocument = Boolean(documentId);

  const saveUrl = isFoundation
    ? `/api/portal/${tenantSlug}/library/foundation/${foundationId}/save`
    : isDocument
      ? `/api/portal/${tenantSlug}/documents/${documentId}/save`
      : tenantSlug
        ? `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/save`
        : `/api/admin/proposals/${proposalId}/sections/${sectionId}`;

  const exportUrl = isFoundation
    ? `/api/portal/${tenantSlug}/library/foundation/${foundationId}/export`
    : isDocument
      ? `/api/portal/${tenantSlug}/documents/${documentId}/export`
      : tenantSlug
        ? `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/export`
        : `/api/admin/proposals/${proposalId}/sections/${sectionId}/export`;

  const backUrl = isFoundation
    ? `/portal/${tenantSlug}/atoms`
    : isDocument
      ? `/portal/${tenantSlug}/documents`
      : tenantSlug
        ? `/portal/${tenantSlug}/proposals/${proposalId}`
        : `/admin/proposals/${proposalId}`;

  const backLabel = isFoundation ? 'Back to Library' : isDocument ? 'Back to Documents' : 'Back to Proposal';

  const handleSave = useCallback(async (doc: CanvasDocument & { __revisionMeta?: { source: string; aiInstruction: string } }) => {
    // Extract revision metadata if present (set by AI revision panel)
    const meta = doc.__revisionMeta;
    const payload: Record<string, unknown> = { content: doc };
    if (versionRef.current != null) payload.baseVersion = versionRef.current;
    if (meta) {
      payload.source = meta.source;
      payload.aiInstruction = meta.aiInstruction;
    }
    const resp = await fetch(saveUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      // On a 409 the row changed under us — reflect the new base version and
      // surface a clear conflict so the user reloads rather than silently losing work.
      if (resp.status === 409 && typeof json.currentVersion === 'number') versionRef.current = json.currentVersion;
      throw new Error(
        resp.status === 409
          ? `This ${isDocument ? 'document' : 'section'} was changed by someone else since you opened it. Reload to get the latest before saving.`
          : json.error ?? `Save failed (HTTP ${resp.status})`,
      );
    }
    const okJson = await resp.json().catch(() => null);
    if (okJson?.data?.version != null) versionRef.current = okJson.data.version;
  }, [saveUrl, isDocument]);

  const handleExport = useCallback(async (doc: CanvasDocument, format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => {
    const resp = await fetch(exportUrl, {
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
  }, [exportUrl]);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link
          href={backUrl}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; {backLabel}
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
          capabilities={capabilities}
          stage={stage}
          onLocked={() => router.refresh()}
          proposalId={isDocument ? undefined : proposalId}
          sectionId={isDocument ? undefined : sectionId}
          tenantSlug={tenantSlug}
          variables={{
            company_name: 'Your Company',
            topic_number: 'TBD',
          }}
        />
      </div>
    </div>
  );
}
