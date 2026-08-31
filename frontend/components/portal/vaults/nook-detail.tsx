'use client';

/**
 * NookDetail (P8.9) — the shared two-sided collaboration-vault workspace
 * (docs/LIBRARY_AND_VAULTS_DESIGN.md §5). Rendered inside the tenant portal (side='tenant')
 * and on the collaborator surface (side='collaborator'); the same component, gated by the
 * server-resolved `rights` so the UI can never offer an action the API would refuse.
 *
 *   • Members (tenant-manage only): invite partner emails · revoke.
 *   • Content (both): add an artifact · download (WHOLE-only for collaborators, ANY grain for
 *     the tenant) · ingest a whole artifact into the proposal library (tenant only).
 *
 * The instruction-based-sharing copy (P8.8) rides on the upload control per side.
 */
import { useState, useEffect, useCallback } from 'react';

interface Rights { upload: boolean; downloadWhole: boolean; downloadGrain: boolean; ingest: boolean; manage: boolean }
interface Artifact { id: string; title: string | null; grain: string; createdAt: string }
interface Member { id: string; email: string; userId: string | null; status: string }

const FORMS = [
  { value: 'doc', label: 'Document', hint: '.docx' }, { value: 'ppt', label: 'Deck', hint: '.pptx' },
  { value: 'sheet', label: 'Sheet', hint: '.xlsx' }, { value: 'pdf', label: 'PDF', hint: '.pdf' },
];
const DL = ['docx', 'pptx', 'xlsx', 'pdf'];

export function NookDetail({ apiBase, side, rights, partnerName, partnerOrg }: {
  apiBase: string;                 // e.g. /api/portal/<slug>/vaults/<id>
  side: 'tenant' | 'collaborator';
  rights: Rights;
  partnerName: string;
  partnerOrg?: string | null;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState('doc');
  const [inviteEmail, setInviteEmail] = useState('');

  const loadArtifacts = useCallback(() => {
    fetch(`${apiBase}/atoms`).then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => setArtifacts(b.data ?? [])).catch(() => setArtifacts([]));
  }, [apiBase]);
  const loadMembers = useCallback(() => {
    if (!rights.manage) return;
    fetch(`${apiBase}/members`).then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => setMembers(b.data ?? [])).catch(() => setMembers([]));
  }, [apiBase, rights.manage]);
  useEffect(() => { loadArtifacts(); loadMembers(); }, [loadArtifacts, loadMembers]);

  const addArtifact = useCallback(async () => {
    if (!title.trim()) { setError('Name the artifact first.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/atoms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), form }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not add the artifact.'); return; }
      setTitle(''); setAdding(false); setNotice('Artifact added to the nook.'); loadArtifacts();
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [title, form, apiBase, loadArtifacts]);

  const invite = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not invite.'); return; }
      setInviteEmail(''); loadMembers();
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [inviteEmail, apiBase, loadMembers]);

  const revoke = useCallback(async (memberId: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/members`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || 'Could not revoke.'); return; }
      loadMembers();
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [apiBase, loadMembers]);

  const ingest = useCallback(async (atomId: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`${apiBase}/atoms/${atomId}/ingest`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not ingest.'); return; }
      setNotice('Harvested into your proposal library.');
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [apiBase]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{partnerName}</h1>
        <p className="mt-1 text-sm text-gray-500">
          A segregated collaboration vault {partnerOrg ? `with ${partnerOrg}` : ''} — {side === 'tenant'
            ? 'copy content in for the partner, and harvest their uploads into your proposal library.'
            : 'upload your content here; the customer will review and use it for the proposal.'}
        </p>
      </div>

      {error && <p className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}

      {/* Members — tenant-manage only */}
      {rights.manage && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Partner access</h2>
          <div className="mb-3 flex gap-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="partner@company.com"
              onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
              className="w-64 rounded border px-2.5 py-1.5 text-sm" />
            <button onClick={invite} disabled={busy || !inviteEmail.trim()} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Invite</button>
          </div>
          {members === null ? <p className="text-sm text-gray-400">Loading…</p> : members.length === 0 ? (
            <p className="text-sm text-gray-400">No partners invited yet.</p>
          ) : (
            <ul className="divide-y rounded border">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-gray-700">{m.email} <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{m.status}</span></span>
                  {m.status !== 'revoked' && <button onClick={() => revoke(m.id)} disabled={busy} className="text-xs text-gray-400 hover:text-rose-600">Revoke</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Content */}
      <section className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Artifacts {artifacts && <span className="font-normal text-gray-400">({artifacts.length})</span>}</h2>
          {rights.upload && <button onClick={() => { setAdding((v) => !v); setError(null); }} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">＋ Add artifact</button>}
        </div>

        {adding && rights.upload && (
          <div className="mb-4 rounded border border-blue-200 bg-blue-50/50 p-3">
            <p className="mb-2 text-[11px] text-amber-700">
              {side === 'tenant'
                ? 'You are copying a COPY into the nook — nothing is linked from your main library. Only add content you are comfortable with the partner using.'
                : 'Only upload content you are comfortable with the customer using for their proposals. What you add here is shared for this collaboration.'}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-500">Name</label>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addArtifact(); }} placeholder="e.g. Partner facilities" className="w-56 rounded border px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-500">Form</label>
                <select value={form} onChange={(e) => setForm(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
                  {FORMS.map((f) => <option key={f.value} value={f.value}>{f.label} ({f.hint})</option>)}
                </select>
              </div>
              <button onClick={addArtifact} disabled={busy || !title.trim()} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        )}

        {artifacts === null ? <p className="text-sm text-gray-400">Loading…</p> : artifacts.length === 0 ? (
          <p className="rounded border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No artifacts in this nook yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {artifacts.map((a) => (
              <li key={a.id} className="rounded border p-3 hover:border-gray-300">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-800" title={a.title || 'Untitled'}>{a.title || 'Untitled'}</div>
                    <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{a.grain}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {rights.downloadWhole && (
                      <div className="flex gap-1.5">
                        {DL.map((fmt) => <a key={fmt} href={`${apiBase}/atoms/${a.id}/download?format=${fmt}`} className="text-[11px] text-gray-500 hover:text-gray-800">.{fmt}</a>)}
                      </div>
                    )}
                    {rights.ingest && <button onClick={() => ingest(a.id)} disabled={busy} className="text-xs text-blue-600 hover:underline disabled:opacity-50">Harvest → library</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!rights.downloadGrain && side === 'collaborator' && (
          <p className="mt-3 text-[11px] text-gray-400">You can download whole artifacts; the customer harvests individual sections into their proposal.</p>
        )}
      </section>
    </div>
  );
}
