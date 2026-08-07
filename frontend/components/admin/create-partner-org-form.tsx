'use client';

/**
 * RFP-admin: create a new partner-manager (EconDev org). POSTs to /api/admin/partners, which makes
 * the partner_admin user + their partner_org tenant, and returns a temp password to relay.
 * See docs/PARTNER_MANAGER_DESIGN.md D4.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 mt-1';
const label = 'block text-sm font-medium text-gray-700';

export function CreatePartnerOrgForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [website, setWebsite] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; tempPassword: string; adminEmail: string } | null>(null);

  function close() {
    setOpen(false); setOrgName(''); setLegalName(''); setWebsite(''); setAdminName(''); setAdminEmail('');
    setErr(null); setDone(null); setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgName, legalName: legalName || undefined, website: website || undefined, adminName, adminEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json?.error || `Failed (${res.status})`); return; }
      setDone({ slug: json.data.slug, tempPassword: json.data.tempPassword, adminEmail });
      router.refresh();
    } catch { setErr('Network error'); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700">
        + New partner org
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onClick={close}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 mt-10" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div>
            <h2 className="text-lg font-semibold mb-1">Partner org created</h2>
            <p className="text-sm text-gray-600 mb-4">Relay these credentials to the partner admin — they&rsquo;ll reset the password on first login.</p>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 text-sm space-y-2">
              <div><span className="text-gray-500">Admin login</span><br /><span className="font-semibold">{done.adminEmail}</span></div>
              <div><span className="text-gray-500">Temp password</span><br /><code className="font-mono font-bold text-indigo-700 tracking-wide">{done.tempPassword}</code></div>
              <div><span className="text-gray-500">Their console</span><br /><span className="font-mono text-xs">/partner</span> &middot; own org <span className="font-mono text-xs">/portal/{done.slug}</span></div>
            </div>
            <p className="text-xs text-red-500 mt-3">The temp password forces a reset on first login (never stored in plaintext).</p>
            <button onClick={close} className="mt-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700">Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 className="text-lg font-semibold mb-1">New partner-manager org</h2>
            <p className="text-sm text-gray-500 mb-4">Creates an EconDev partner that runs a stable of client companies (owner-scoped, no /admin reach).</p>
            <div className="space-y-3">
              <div><label className={label}>Organization name <span className="text-red-500">*</span></label><input className={input} value={orgName} onChange={(e) => setOrgName(e.target.value)} required placeholder="Youngstown Business Incubator" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Legal name</label><input className={input} value={legalName} onChange={(e) => setLegalName(e.target.value)} /></div>
                <div><label className={label}>Website</label><input className={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Admin name <span className="text-red-500">*</span></label><input className={input} value={adminName} onChange={(e) => setAdminName(e.target.value)} required placeholder="Stephanie Gaffney" /></div>
                <div><label className={label}>Admin email <span className="text-red-500">*</span></label><input type="email" className={input} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required /></div>
              </div>
            </div>
            {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
            <div className="flex gap-2 mt-5">
              <button type="submit" disabled={busy || !orgName.trim() || !adminName.trim() || !adminEmail.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create partner org'}
              </button>
              <button type="button" onClick={close} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
