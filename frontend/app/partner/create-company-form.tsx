'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Create a new company (tenant) owned by the EconDev partner. POSTs to /api/partner/tenants. */
export default function CreateCompanyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/partner/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, adminEmail: adminEmail || undefined, adminName: adminName || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json?.error || `Failed (${res.status})`);
        return;
      }
      setName(''); setAdminEmail(''); setAdminName(''); setOpen(false);
      router.refresh();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ marginTop: 12, background: '#1a4a8a', color: '#fff', border: 0, borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }}
      >
        + New company
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12, border: '1px solid #e5e5e5', borderRadius: 8, padding: 16, background: '#fafafa' }}>
      <div style={{ display: 'grid', gap: 10, maxWidth: 460 }}>
        <label style={{ fontSize: 13, color: '#333' }}>
          Company name *
          <input value={name} onChange={(e) => setName(e.target.value)} required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, border: '1px solid #ccc', borderRadius: 6 }} />
        </label>
        <label style={{ fontSize: 13, color: '#333' }}>
          Founder POC email (optional — you can staff it later)
          <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, border: '1px solid #ccc', borderRadius: 6 }} />
        </label>
        <label style={{ fontSize: 13, color: '#333' }}>
          Founder POC name (optional)
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4, border: '1px solid #ccc', borderRadius: 6 }} />
        </label>
        {err && <p style={{ color: '#c0392b', fontSize: 13, margin: 0 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={busy || !name.trim()}
            style={{ background: '#1a4a8a', color: '#fff', border: 0, borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Creating…' : 'Create company'}
          </button>
          <button type="button" onClick={() => { setOpen(false); setErr(null); }}
            style={{ background: '#fff', color: '#333', border: '1px solid #ccc', borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
