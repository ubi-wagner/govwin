'use client';

/**
 * RFP-admin "Add company" — creates a company + its admin POC directly (the we/expert
 * path, vs. the customer self-serve /apply → accept flow). After creating, staff can
 * shadow into the tenant to help upload + atomize their documents. See
 * docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewCompanyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; email: string; tempPassword: string | null } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'),
          adminEmail: fd.get('adminEmail'),
          adminName: fd.get('adminName'),
          legalName: fd.get('legalName'),
          website: fd.get('website'),
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Failed to create company'); setBusy(false); return; }
      setDone({ slug: j.data.slug, email: j.data.adminPoc.email, tempPassword: j.data.adminPoc.tempPassword });
      setBusy(false);
      router.refresh();
    } catch {
      setErr('Network error');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setDone(null); setErr(null); }}
        className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
      >
        + New Company
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            {done ? (
              <div>
                <h2 className="text-lg font-bold text-gray-900">Company created</h2>
                <p className="mt-2 text-sm text-gray-600">
                  <span className="font-mono">{done.slug}</span> is live with{' '}
                  <span className="font-medium">{done.email}</span> as admin POC.
                  {done.tempPassword && (
                    <> Temporary password: <span className="font-mono bg-gray-100 px-1 rounded">{done.tempPassword}</span> (they change it on first login).</>
                  )}
                </p>
                <p className="mt-2 text-xs text-gray-500">You can shadow into their space to help upload &amp; atomize their documents.</p>
                <div className="mt-5 flex justify-end">
                  <button onClick={() => setOpen(false)} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit}>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Add a company</h2>
                <p className="text-xs text-gray-500 mb-4">Creates the company and its admin point of contact.</p>
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-700">Company name *</span>
                    <input name="name" required className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-700">Admin POC email *</span>
                    <input name="adminEmail" type="email" required className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-700">Admin POC name</span>
                    <input name="adminName" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-gray-700">Legal name</span>
                      <input name="legalName" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-700">Website</span>
                      <input name="website" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </label>
                  </div>
                </div>
                {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {busy ? 'Creating…' : 'Create company'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
