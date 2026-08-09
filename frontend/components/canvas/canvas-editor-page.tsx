'use client';

/**
 * Canvas Editor Page — wraps CanvasEditor with save/export wiring and
 * the persistent SectionTopRibbon for proposal-mode sections.
 *
 * Two targets (canvas itself is identical — routes and ribbon differ):
 *   • SECTION mode  — a proposal volume section (proposalId + sectionId given).
 *     Full ribbon: breadcrumb, metadata chips, compliance, save/undo/lock/export.
 *   • DOCUMENT mode — a standalone tenant document (documentId given).
 *     Minimal top bar: back link + title only (compliance/lock don't apply).
 *
 * The ribbon owns the UX chrome (save, undo, export, lock); the inner
 * CanvasEditor's header toolbar keeps the content controls (insert/format/
 * sidebar toggle). State for ribbon-exposed actions flows up via callbacks
 * the editor exposes through an imperative handle.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from '@/lib/toast';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import type { CanvasCapabilities } from '@/lib/canvas/capabilities';
import type { ComplianceItem } from '@/components/portal/section-compliance-chip';
import { CanvasEditor } from './canvas-editor';
import { SectionTopRibbon } from './section-top-ribbon';

// ─── Public ref handle (raised from CanvasEditor via innerRef prop) ────
// We mirror save/undo/redo/lock state up so the ribbon can display it.

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
  // Section-mode extra metadata (populated by the portal section page)
  sectionNumber?: string;
  volumeName?: string;
  pageAllocation?: number | null;
  isLocked?: boolean;
  complianceItems?: ComplianceItem[];
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
  sectionNumber,
  volumeName,
  pageAllocation,
  isLocked = false,
  complianceItems,
}: Props) {
  const router = useRouter();
  const versionRef = useRef<number | undefined>(initialVersion);

  const isFoundation = Boolean(foundationId);
  // Ribbon state — mirrored from the inner editor via callbacks
  const [dirty,     setDirty]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undoSteps, setUndoSteps] = useState(0);
  const [redoSteps, setRedoSteps] = useState(0);
  const [undoTrail, setUndoTrail] = useState<string[]>([]);
  const [redoTrail, setRedoTrail] = useState<string[]>([]);
  const [nodeCount, setNodeCount] = useState(canvasDocument.nodes?.length ?? 0);
  const [docStatus, setDocStatus] = useState<string>(canvasDocument.metadata.status ?? 'empty');
  const [panelOpen, setPanelOpen] = useState(true);
  const [canvasFormat, setCanvasFormat] = useState<string>(canvasDocument.canvas?.format ?? 'letter');
  const [hasTable,   setHasTable]   = useState(() => (canvasDocument.nodes ?? []).some((n) => n.type === 'table'));

  // Imperative trigger refs — the ribbon calls these to invoke editor actions
  const triggerSaveRef  = useRef<(() => void) | null>(null);
  const triggerUndoRef  = useRef<(() => void) | null>(null);
  const triggerRedoRef  = useRef<(() => void) | null>(null);
  const triggerLockRef  = useRef<(() => void) | null>(null);
  const triggerPanelRef = useRef<(() => void) | null>(null);
  const triggerExportRef= useRef<((format: 'docx'|'pptx'|'xlsx'|'pdf') => void) | null>(null);
  const isDocument = Boolean(documentId);

  const saveUrl = isFoundation
    ? `/api/portal/${tenantSlug}/library/foundation/${foundationId}/save`
    : isDocument
      ? `/api/portal/${tenantSlug}/documents/${documentId}/save`
      : `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/save`;

  const exportUrl = isFoundation
    ? `/api/portal/${tenantSlug}/library/foundation/${foundationId}/export`
    : isDocument
      ? `/api/portal/${tenantSlug}/documents/${documentId}/export`
      : `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/export`;

  const backUrl = isFoundation
    ? `/portal/${tenantSlug}/atoms`
    : isDocument
      ? `/portal/${tenantSlug}/documents`
      : `/portal/${tenantSlug}/proposals/${proposalId}`;

  const backLabel = isFoundation
    ? 'Back to Library'
    : isDocument
      ? 'Back to Documents'
      : 'Back to Proposal';

  // ── Callbacks CanvasEditor calls to push state up into the ribbon ───
  const handleDirtyChange  = useCallback((d: boolean)  => setDirty(d),    []);
  const handleSavingChange = useCallback((s: boolean)  => setSaving(s),   []);
  const handleErrorChange  = useCallback((e: string | null) => setSaveError(e), []);
  const handleUndoCount    = useCallback((n: number)   => setUndoSteps(n), []);
  const handleRedoCount    = useCallback((n: number)   => setRedoSteps(n), []);
  const handleUndoTrail    = useCallback((t: string[]) => setUndoTrail(t), []);
  const handleRedoTrail    = useCallback((t: string[]) => setRedoTrail(t), []);
  const handleNodeCount    = useCallback((n: number)   => setNodeCount(n), []);
  const handleStatusChange = useCallback((s: string)   => setDocStatus(s), []);
  const handleFormatChange = useCallback((f: string)   => setCanvasFormat(f), []);
  const handleHasTable     = useCallback((h: boolean)  => setHasTable(h),  []);

  // ── Persistence handlers (same logic as before) ─────────────────────
  const handleSave = useCallback(async (doc: CanvasDocument & { __revisionMeta?: { source: string; aiInstruction: string } }) => {
    const meta = doc.__revisionMeta;
    const payload: Record<string, unknown> = { content: doc };
    if (versionRef.current != null) payload.baseVersion = versionRef.current;
    if (meta) { payload.source = meta.source; payload.aiInstruction = meta.aiInstruction; }
    const resp = await fetch(saveUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      if (resp.status === 409 && typeof json.currentVersion === 'number') versionRef.current = json.currentVersion;
      throw new Error(
        resp.status === 409
          ? `This ${isDocument ? 'document' : 'section'} was changed by someone else since you opened it. Reload to get the latest before saving.`
          : json.error ?? `Save failed (HTTP ${resp.status})`,
      );
    }
    const okJson = await resp.json().catch(() => null);
    if (okJson?.data?.version != null) versionRef.current = okJson.data.version;
    // Surface the compliance floor's section-local warnings (advisory, non-blocking) the save
    // route computes — otherwise the shipped save-side check is invisible to the builder.
    const warns = okJson?.data?.complianceWarnings as { code: string; message: string }[] | undefined;
    if (warns && warns.length) toast(`Compliance: ${warns.map((w) => w.message).join(' · ')}`, 'info');
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
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href:     url,
      download: `${doc.metadata.title || 'document'}.${format}`,
    }).click();
    URL.revokeObjectURL(url);
  }, [exportUrl]);

  // ── Section mode: full SectionTopRibbon ─────────────────────────────
  const sectionMode = !isDocument && Boolean(proposalId && sectionId);

  return (
    <div className="h-screen flex flex-col">

      {sectionMode ? (
        <SectionTopRibbon
          backUrl={backUrl}
          backLabel={backLabel}
          sectionTitle={canvasDocument.metadata.title || 'Untitled Section'}
          sectionNumber={sectionNumber}
          volumeName={volumeName}
          version={versionRef.current}
          status={docStatus}
          pageAllocation={pageAllocation ?? null}
          nodeCount={nodeCount}
          isLocked={isLocked}
          canLock={!!(capabilities?.canLock) && !isLocked}
          dirty={dirty}
          saving={saving}
          saveError={saveError}
          complianceItems={complianceItems}
          canExport={!!(capabilities?.canExport ?? true)}
          canUndo={undoSteps > 0}
          canRedo={redoSteps > 0}
          undoSteps={undoSteps}
          redoSteps={redoSteps}
          undoTrail={undoTrail}
          redoTrail={redoTrail}
          onSave={() => triggerSaveRef.current?.()}
          onUndo={() => triggerUndoRef.current?.()}
          onRedo={() => triggerRedoRef.current?.()}
          onLock={() => triggerLockRef.current?.()}
          onExport={(fmt) => triggerExportRef.current?.(fmt)}
          onTogglePanel={() => { setPanelOpen((prev) => !prev); triggerPanelRef.current?.(); }}
          panelOpen={panelOpen}
          canvasFormat={canvasFormat}
          hasTable={hasTable}
          readOnly={readOnly}
        />
      ) : (
        // Document mode — minimal back/title bar
        <div className="bg-white border-b px-4 py-2 flex items-center gap-4 shrink-0">
          <Link href={backUrl} className="text-sm text-blue-600 hover:text-blue-800">
            &larr; {backLabel}
          </Link>
          <span className="text-sm text-gray-400">{canvasDocument.metadata.title}</span>
        </div>
      )}

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
          // Ribbon state callbacks — the editor pushes state up so the ribbon
          // can reflect dirty/saving/undo counts without owning the doc state.
          onDirtyChange={handleDirtyChange}
          onSavingChange={handleSavingChange}
          onSaveErrorChange={handleErrorChange}
          onUndoCountChange={handleUndoCount}
          onRedoCountChange={handleRedoCount}
          onUndoTrailChange={handleUndoTrail}
          onRedoTrailChange={handleRedoTrail}
          onNodeCountChange={handleNodeCount}
          onStatusChange={handleStatusChange}
          onFormatChange={handleFormatChange}
          onHasTableChange={handleHasTable}
          // Imperative trigger refs — ribbon buttons call these
          triggerSaveRef={triggerSaveRef}
          triggerUndoRef={triggerUndoRef}
          triggerRedoRef={triggerRedoRef}
          triggerLockRef={triggerLockRef}
          triggerPanelRef={triggerPanelRef}
          triggerExportRef={triggerExportRef}
          externalPanelOpen={sectionMode ? panelOpen : undefined}
        />
      </div>
    </div>
  );
}
