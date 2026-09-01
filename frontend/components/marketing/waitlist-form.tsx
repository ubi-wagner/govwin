'use client';

import { useState } from 'react';
import { visitorSessionId } from '@/lib/visitor-session';

/**
 * Soft lead-capture for not-ready prospects — posts to /api/waitlist (public).
 * Email required; company optional. `source` is recorded in notes so leads can be
 * attributed to where they converted.
 */
export function WaitlistForm({
  source = 'site',
  cta = 'Get the starter guide',
  placeholder = 'you@company.com',
}: {
  source?: string;
  cta?: string;
  placeholder?: string;
}) {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setMsg('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // session_id carries the campaign across the sever (migration 242) — see
        // lib/visitor-session.ts for why this line is load-bearing.
        body: JSON.stringify({ email: email.trim(), company_name: company.trim() || null,
          notes: `source: ${source}`, session_id: visitorSessionId() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus('error');
        setMsg(String(json.error ?? 'Something went wrong — please try again.'));
        return;
      }
      setStatus('done');
    } catch {
      setStatus('error');
      setMsg('Something went wrong — please try again.');
    }
  }

  if (status === 'done') {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-6">
        <p className="font-display font-bold text-navy-900">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-navy-600">
          We&apos;ll send the federal R&amp;D starter guide and let you know the moment a newcomer track opens.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-cream-200 bg-white p-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={placeholder}
          className="flex-1 border border-cream-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand-400"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="shrink-0 px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-60"
        >
          {status === 'loading' ? 'Sending…' : cta}
        </button>
      </div>
      <input
        type="text"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="Company (optional)"
        className="mt-3 w-full border border-cream-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-brand-400"
      />
      {status === 'error' && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      <p className="mt-3 text-xs text-navy-400">No spam. We&apos;ll only email you about federal R&amp;D funding and your application.</p>
    </form>
  );
}
