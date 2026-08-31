'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The customer's act, filed by us.
 *
 * ── THE WHOLE COMPONENT IS ABOUT ONE SENTENCE ────────────────────────────────────────────────
 * It renders **"accepted by <the admin> · evidence: COR email, 2 Apr 2026"** and never *"accepted
 * by the government"*. The distinction is the ingest-provenance rule applied to acceptance: a value
 * the product did not read from the source must not look like one it did. An admin typed the
 * customer's name into a form; the product never verified that person, and the record has to say so
 * by construction rather than by anyone remembering to.
 *
 * That is also why this stands in for a COR read-only portal. Handing the contracting officer a
 * login would make the acceptance genuinely theirs — and would reopen the boundary
 * `lib/projects/access.ts` closes by refusing `partner_user` the project capability outright.
 *
 * Mobile-first, like the rest of the workspace: `min-w-0` content, a two-column grid of controls
 * below `sm`, identifiers that truncate with a `title`.
 */
export interface PanelEvidence {
  id: string;
  deliverableId: string;
  kind: string;
  customerName: string | null;
  customerRole: string | null;
  occurredOn: string | null;
  filename: string;
  note: string | null;
  uploadedByEmail: string | null;
}

const KINDS: Array<[string, string]> = [
  ['dd250', 'Signed DD-250'],
  ['cor_email', 'Email from the COR/CO'],
  ['signed_receipt', 'Signed receipt'],
  ['transmittal', 'Transmittal record'],
  ['other', 'Other evidence'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

export function EvidencePanel({
  deliverableId, label, evidence, basePath, canFile, acceptedByEmail,
}: {
  deliverableId: string;
  label: string;
  evidence: PanelEvidence[];
  basePath: string;
  canFile: boolean;
  /** The person in THIS product who accepted it — never the customer. */
  acceptedByEmail: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [filing, setFiling] = useState(false);
  const [kind, setKind] = useState('cor_email');
  const [who, setWho] = useState('');
  const [role, setRole] = useState('');
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const mine = evidence.filter((e) => e.deliverableId === deliverableId);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      if (who.trim()) form.append('customerName', who.trim());
      if (role.trim()) form.append('customerRole', role.trim());
      if (on) form.append('occurredOn', on);
      if (note.trim()) form.append('note', note.trim());
      const res = await fetch(`${basePath}/deliverables/${deliverableId}/evidence`, {
        method: 'POST', body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not file the evidence', 'error'); return; }
      setFiling(false); setWho(''); setRole(''); setOn(''); setNote(''); setFile(null);
      toast('Evidence filed', 'success');
      router.refresh();
    } catch {
      toast('Could not file the evidence', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 text-xs">
      {mine.length > 0 && (
        <ul className="space-y-1">
          {mine.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
                {KIND_LABEL[e.kind] ?? e.kind}
              </span>
              {/* "Reported by", not "signed by". The product never met this person. */}
              {e.customerName && (
                <span title={`Reported by our admin — not verified by the product`} className="text-gray-600">
                  reported: {e.customerName}{e.customerRole ? ` (${e.customerRole})` : ''}
                </span>
              )}
              {e.occurredOn && (
                <span className="text-gray-500">on {e.occurredOn.slice(0, 10)}</span>
              )}
              <span title={e.filename} className="max-w-[11rem] truncate text-gray-400 sm:max-w-none">
                📎 {e.filename}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* THE SENTENCE. Rendered from two DIFFERENT facts, side by side and never merged: who in
          this product accepted, and what they filed as backing. */}
      {acceptedByEmail && (
        <p className="mt-1 text-[11px] text-gray-500">
          accepted by <span className="font-medium text-gray-700">{acceptedByEmail}</span>
          {mine.length > 0
            ? <> · evidence: {KIND_LABEL[mine[0].kind] ?? mine[0].kind}
              {mine[0].occurredOn ? `, ${mine[0].occurredOn.slice(0, 10)}` : ''}</>
            : <> · <span className="text-amber-800">no customer evidence on file</span></>}
        </p>
      )}

      {canFile && (
        filing ? (
          <div className="mt-1.5 rounded border border-gray-200 bg-gray-50 p-2">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
              <label className="text-[11px] text-gray-600">
                Kind
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  aria-label={`Kind of evidence for ${label}`}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                >
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-gray-600">
                Their name
                <input
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  placeholder="e.g. J. Rivera"
                  aria-label={`Who on the customer side accepted ${label}`}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                />
              </label>
              <label className="text-[11px] text-gray-600">
                Their role
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="COR"
                  aria-label={`Their role on ${label}`}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                />
              </label>
              <label className="text-[11px] text-gray-600">
                Dated
                <input
                  type="date"
                  value={on}
                  onChange={(e) => setOn(e.target.value)}
                  aria-label={`When the customer accepted ${label}`}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
                />
              </label>
            </div>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-label={`Evidence file for ${label}`}
              className="mt-2 block w-full text-[11px]"
            />
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !file}
                onClick={() => void submit()}
                className="rounded bg-blue-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                File it
              </button>
              <button type="button" onClick={() => setFiling(false)} className="text-[11px] text-gray-500 hover:underline">
                Cancel
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              This records what the customer did. It does not accept the deliverable — that is still
              your decision, and the record will name you.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFiling(true)}
            className="mt-1 text-[11px] text-blue-700 hover:underline"
          >
            File customer evidence
          </button>
        )
      )}
    </div>
  );
}
