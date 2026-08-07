'use client';

/**
 * Add-company flow (docs/PARTNER_MANAGER_DESIGN.md §4). Step 1 collects name + admin, runs the
 * dedup precheck, then branches: a clean/confirmed-new company goes to a thin onboarding form that
 * submits an RFP-admin-approved registration; a name that matches an existing tenant routes to the
 * manager-request path (the actionable button lands in the manager step). Replaces the old
 * instant-create form (creation is now approval-gated — D3).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Verdict = 'ok_new' | 'review_similar' | 'must_request_manager' | 'email_taken';
interface Match { id: string; slug: string; name: string; similarity: number }
interface Precheck { verdict: Verdict; exactExistingTenant: Match | null; similar: Match[]; emailInUseAsAdmin: boolean }

const inputCls = 'block w-full px-3 py-2 border border-cream-200 rounded-lg text-sm mt-1 focus:outline-none focus:border-navy-400';
const labelCls = 'block text-sm text-navy-700';
const primaryBtn = 'bg-navy-700 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-navy-900 disabled:opacity-50';
const ghostBtn = 'bg-white text-navy-700 border border-cream-200 rounded-lg px-4 py-2 text-sm hover:border-navy-300';

export default function AddCompanyFlow() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'id' | 'onboard' | 'done'>('id');
  // step 1
  const [name, setName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  // onboarding
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [companyState, setCompanyState] = useState('');
  const [description, setDescription] = useState('');
  const [partnerNotes, setPartnerNotes] = useState('');
  const [dedupDecision, setDedupDecision] = useState<'clear' | 'confirmed_new'>('clear');
  // control
  const [precheck, setPrecheck] = useState<Precheck | null>(null);
  const [claimedExisting, setClaimedExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function close() {
    setOpen(false); setStep('id'); setName(''); setAdminName(''); setAdminEmail('');
    setPhone(''); setWebsite(''); setCompanyState(''); setDescription(''); setPartnerNotes('');
    setPrecheck(null); setClaimedExisting(false); setErr(null); setDedupDecision('clear');
  }

  async function doPrecheck(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setPrecheck(null); setClaimedExisting(false);
    try {
      const res = await fetch('/api/partner/tenants/precheck', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, adminEmail }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json?.error || `Check failed (${res.status})`); return; }
      const p: Precheck = json.data;
      setPrecheck(p);
      if (p.verdict === 'email_taken') {
        setErr('That admin email already administers a company. Use a different admin email — the same person can still be added as a collaborator inside another company.');
      } else if (p.verdict === 'ok_new') {
        setDedupDecision('clear'); setStep('onboard');
      }
      // review_similar / must_request_manager render their panels below
    } catch { setErr('Network error'); } finally { setBusy(false); }
  }

  function proceedAsNew() { setDedupDecision('confirmed_new'); setErr(null); setStep('onboard'); }

  async function submitRegistration(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/partner/registrations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: name, adminName, adminEmail,
          adminPhone: phone || undefined, companyWebsite: website || undefined,
          companyState: companyState || undefined, description,
          partnerNotes: partnerNotes || undefined, dedupDecision,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json?.error || `Submit failed (${res.status})`); return; }
      setStep('done'); router.refresh();
    } catch { setErr('Network error'); } finally { setBusy(false); }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className={primaryBtn}>+ Add a company</button>;
  }

  const existingMatch = precheck?.exactExistingTenant ?? (claimedExisting ? precheck?.similar[0] ?? null : null);

  return (
    <div className="border border-cream-200 rounded-xl p-6 bg-white max-w-2xl">
      {step === 'done' ? (
        <div>
          <p className="text-base font-bold text-navy-900 mb-1">Submitted for approval</p>
          <p className="text-sm text-navy-600 mb-4">
            <span className="font-semibold">{name}</span> was sent to RFP Pipeline for review. Once approved,
            it lands in your stable — fully provisioned with buckets, the opportunity pipeline, and a starter library.
          </p>
          <button onClick={close} className={primaryBtn}>Done</button>
        </div>
      ) : step === 'onboard' ? (
        <form onSubmit={submitRegistration}>
          <p className="text-base font-bold text-navy-900 mb-1">New company — details</p>
          <p className="text-sm text-navy-500 mb-4">
            {dedupDecision === 'confirmed_new' ? 'Confirmed new. ' : ''}This is submitted to RFP Pipeline for approval.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>Company name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label className={labelCls}>Website<input className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></label>
            <label className={labelCls}>Admin name<input className={inputCls} value={adminName} onChange={(e) => setAdminName(e.target.value)} required /></label>
            <label className={labelCls}>Admin email<input type="email" className={inputCls} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required /></label>
            <label className={labelCls}>Admin phone<input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label className={labelCls}>State<input className={inputCls} value={companyState} onChange={(e) => setCompanyState(e.target.value)} placeholder="OH" /></label>
          </div>
          <label className={`${labelCls} mt-3`}>Company info / description
            <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} required placeholder="What the company does, its tech focus, target programs…" />
          </label>
          <label className={`${labelCls} mt-3`}>Partner notes (optional — for RFP review)
            <textarea className={inputCls} rows={2} value={partnerNotes} onChange={(e) => setPartnerNotes(e.target.value)} />
          </label>
          {err && <p className="text-sm text-brand-600 mt-3">{err}</p>}
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={busy || !description.trim()} className={primaryBtn}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
            <button type="button" onClick={() => setStep('id')} className={ghostBtn}>Back</button>
          </div>
        </form>
      ) : (
        <form onSubmit={doPrecheck}>
          <p className="text-base font-bold text-navy-900 mb-1">Add a company</p>
          <p className="text-sm text-navy-500 mb-4">We check for an existing company first, then set up the registration.</p>
          <div className="grid gap-3">
            <label className={labelCls}>Company name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label className={labelCls}>Company admin name<input className={inputCls} value={adminName} onChange={(e) => setAdminName(e.target.value)} required /></label>
            <label className={labelCls}>Company admin email<input type="email" className={inputCls} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required /></label>
          </div>
          {err && <p className="text-sm text-brand-600 mt-3">{err}</p>}

          {precheck && precheck.verdict === 'review_similar' && !claimedExisting && (
            <div className="mt-4 border border-citrus-300 bg-citrus-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-navy-900 mb-2">We found similar companies — is one of these yours?</p>
              <ul className="text-sm text-navy-700 mb-3 space-y-1">
                {precheck.similar.map((m) => (
                  <li key={m.id}>• {m.name} <span className="text-navy-400">({Math.round(m.similarity * 100)}% match)</span></li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button type="button" onClick={proceedAsNew} className={primaryBtn}>None of these — mine is new</button>
                <button type="button" onClick={() => setClaimedExisting(true)} className={ghostBtn}>One of these is my company</button>
              </div>
            </div>
          )}

          {(precheck?.verdict === 'must_request_manager' || (precheck?.verdict === 'review_similar' && claimedExisting)) && existingMatch && (
            <div className="mt-4 border border-navy-200 bg-cream-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-navy-900 mb-1">“{existingMatch.name}” already exists on RFP Pipeline</p>
              <p className="text-sm text-navy-600">
                You can’t register it again. To add it to your stable, request <span className="font-semibold">manager access</span> —
                the company’s admin approves, and it appears here. Manager requests open in the Manager step.
              </p>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={busy || !name.trim() || !adminName.trim() || !adminEmail.trim()} className={primaryBtn}>{busy ? 'Checking…' : 'Continue'}</button>
            <button type="button" onClick={close} className={ghostBtn}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
