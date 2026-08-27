'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * One deliverable, with the two controls that make it a deliverable rather than a label.
 *
 * ── WHY THIS COMPONENT EXISTS ────────────────────────────────────────────────────────────────
 * The upload and accept routes shipped before any UI called them, and
 * `reconcile-capability.mjs` reported the pair as **UNSURFACED** — built, addressable, reachable by
 * nothing. That is the exact class the reconciliation exists to catch, and it caught it in a
 * feature written the same week.
 *
 * ── TWO CONTROLS, BECAUSE THEY ARE TWO FACTS ─────────────────────────────────────────────────
 * Uploading is not accepting. Any assigned employee may attach a file — it is the everyday act of
 * project work. Only a tenant admin accepts, because acceptance is what closes a CLIN.
 *
 * Replacing a file REVOKES a prior acceptance (the server clears it), so the confirm below says so
 * rather than letting someone discover it afterwards.
 */
export interface DeliverableView {
  id: string;
  title: string;
  filename: string | null;
  storageKey: string | null;
  acceptedAt: string | null;
  /** An AUTHORED canvas document backing this deliverable — the same editor, compliance floor and
   *  docx/pptx/xlsx/pdf export the build portal uses. A sibling of the uploaded file, not a
   *  replacement: both attach evidence, and neither is acceptance. */
  documentId?: string | null;
  documentTitle?: string | null;
}

export function DeliverableRow({
  deliverable, basePath, canAccept, tenantSlug,
}: {
  deliverable: DeliverableView;
  basePath: string;
  canAccept: boolean;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'upload' | 'accept' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const accepted = Boolean(deliverable.acceptedAt);
  const authored = Boolean(deliverable.documentId);
  // "Attached" is the honest word now: a deliverable is satisfied by an uploaded file OR a document
  // written here. Acceptance is still the separate act.
  const uploaded = Boolean(deliverable.storageKey) || authored;

  async function upload(file: File) {
    // A replacement clears acceptance server-side. Saying so first is the difference between a
    // deliberate act and a surprise.
    if (accepted && !confirm(
      `"${deliverable.title}" is already accepted. Replacing the file revokes that acceptance and `
      + 'the milestone will no longer be closeable until it is accepted again. Continue?',
    )) return;

    setBusy('upload');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${basePath}/deliverables/${deliverable.id}`, { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json?.error ?? 'Upload failed', 'error');
        return;
      }
      toast(accepted ? 'File replaced — acceptance revoked' : 'File uploaded', 'success');
      router.refresh();
    } catch {
      toast('Upload failed', 'error');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Start the canvas document that satisfies this deliverable, then open the editor on it. */
  async function author(preset: string) {
    setBusy('upload');
    try {
      const res = await fetch(`${basePath}/deliverables/${deliverable.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'author', preset }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not start the document', 'error'); return; }
      const id = json?.data?.document?.documentId;
      toast('Document started', 'success');
      if (id) window.location.href = `/portal/${tenantSlug}/documents/${id}`;
      else router.refresh();
    } catch {
      toast('Could not start the document', 'error');
    } finally { setBusy(null); }
  }

  async function accept() {
    setBusy('accept');
    try {
      const res = await fetch(`${basePath}/deliverables/${deliverable.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json?.error ?? 'Could not accept', 'error');
        return;
      }
      toast('Deliverable accepted', 'success');
      router.refresh();
    } catch {
      toast('Could not accept', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-gray-900">{deliverable.title}</span>

      {accepted ? (
        <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-800 ring-1 ring-inset ring-green-600/20">
          accepted
        </span>
      ) : uploaded ? (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
          uploaded — not accepted
        </span>
      ) : (
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 ring-1 ring-inset ring-gray-500/20">
          nothing attached
        </span>
      )}

      {deliverable.filename && (
        <span className="text-xs text-gray-500">{deliverable.filename}</span>
      )}
      {authored && (
        <a
          href={`/portal/${tenantSlug}/documents/${deliverable.documentId}`}
          className="text-xs text-blue-700 hover:underline"
        >
          {deliverable.documentTitle || 'Open the document'}
        </a>
      )}

      <span className="ml-auto flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          aria-label={`Upload a file for ${deliverable.title}`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        />
        {!authored && !accepted && (
          <select
            aria-label={`Draft a document for ${deliverable.title}`}
            disabled={busy !== null}
            defaultValue=""
            onChange={(e) => { const v = e.target.value; if (v) void author(v); e.target.value = ''; }}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
          >
            <option value="">Draft…</option>
            <option value="letter">Report</option>
            <option value="deck">Slide deck</option>
            <option value="sheet">Workbook</option>
            <option value="flier">One-pager</option>
          </select>
        )}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'upload' ? 'Uploading…' : uploaded ? 'Replace file' : 'Upload file'}
        </button>

        {/* Accept is tenant_admin only AND needs a file. The server refuses both cases with its own
            message; hiding the button when there is nothing to accept means the message is a
            backstop rather than the first thing a person meets. */}
        {canAccept && uploaded && !accepted && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void accept()}
            className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-50"
          >
            {busy === 'accept' ? 'Accepting…' : 'Accept'}
          </button>
        )}
      </span>
    </li>
  );
}
