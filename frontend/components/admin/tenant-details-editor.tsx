'use client';
/**
 * Edit a company's own information — the fields `PATCH /api/admin/tenants/[tenantId]` has always
 * accepted and nothing has ever called.
 *
 * ── THE CAPABILITY WAS BUILT AND HAD NO WAY IN ───────────────────────────────────────────────
 * The route validates and updates name · legal_name · website · billing_email · product_tier ·
 * subscription_status · lifecycle_stage · status. The tenant detail page loaded every one of those
 * columns and rendered them in a read-only `<dl>`, so an rfp_admin could see a customer's legal
 * name was wrong and had no way to fix it short of SQL. That is the UNSURFACED class the
 * capability reconciliation exists to find: not a broken feature, an unreachable one.
 *
 * ── WHY THE STATE FIELDS SIT APART FROM THE TEXT ONES ────────────────────────────────────────
 * `status` and `subscription_status` decide whether a customer can sign in and whether they are
 * billed. Typing a new legal name and suspending a company are not the same act, and a single
 * "Save" over one grid makes them look like it — so the lifecycle selects carry their own note and
 * a suspension asks for confirmation. Archiving stays where it was, on its own control: license
 * slumber is a bigger act again and already has one.
 *
 * Only CHANGED fields are sent. A PATCH that replays every value would overwrite a concurrent
 * edit with what this page happened to load, which is the shape of a last-write-wins bug that
 * nobody notices until two admins are working at once.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export interface TenantDetails {
  name: string;
  legalName: string | null;
  website: string | null;
  billingEmail: string | null;
  productTier: string;
  subscriptionStatus: string;
  lifecycleStage: string | null;
  status: string;
}

const TIERS = ['starter', 'professional', 'enterprise'];
const SUBSCRIPTION = ['trialing', 'active', 'past_due', 'canceled'];
const LIFECYCLE = ['lead', 'onboarding', 'active', 'at_risk', 'churned'];
const STATUS = ['active', 'suspended'];

export function TenantDetailsEditor({ tenantId, initial }: { tenantId: string; initial: TenantDetails }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<TenantDetails>(initial);

  const set = <K extends keyof TenantDetails>(k: K, v: TenantDetails[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Empty string means "cleared" for a nullable text field, not "unchanged".
  const norm = (v: string | null) => (v === null || v.trim() === '' ? null : v.trim());

  function changed(): Partial<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (form.name.trim() && form.name.trim() !== initial.name) out.name = form.name.trim();
    if (norm(form.legalName) !== norm(initial.legalName)) out.legal_name = norm(form.legalName);
    if (norm(form.website) !== norm(initial.website)) out.website = norm(form.website);
    if (norm(form.billingEmail) !== norm(initial.billingEmail)) out.billing_email = norm(form.billingEmail);
    if (form.productTier !== initial.productTier) out.product_tier = form.productTier;
    if (form.subscriptionStatus !== initial.subscriptionStatus) out.subscription_status = form.subscriptionStatus;
    if ((form.lifecycleStage ?? '') !== (initial.lifecycleStage ?? '')) out.lifecycle_stage = norm(form.lifecycleStage);
    if (form.status !== initial.status) out.status = form.status;
    return out;
  }

  async function save() {
    const patch = changed();
    const n = Object.keys(patch).length;
    if (n === 0) { toast('Nothing changed', 'info'); return; }
    // Suspension locks every non-admin user of this company out at once. A blocking confirm is
    // right here for the same reason it is right on archive: it is not undone by another click.
    if (patch.status === 'suspended'
        && !confirm('Suspend this company? Everyone at it loses access until you set it back to active. Nobody is deleted.')) return;

    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json?.error ?? `Could not save (${res.status})`);
        return;
      }
      toast(`Saved — ${n} field${n === 1 ? '' : 's'} updated`, 'success');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setForm(initial); setErr(null); setOpen(true); }}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Edit company details
      </button>
    );
  }

  const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none';
  const lbl = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={lbl} htmlFor="t-name">Company name</label>
          <input id="t-name" className={field} value={form.name}
                 onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className={lbl} htmlFor="t-legal">Legal name</label>
          <input id="t-legal" className={field} value={form.legalName ?? ''}
                 placeholder="as it appears on the contract"
                 onChange={(e) => set('legalName', e.target.value)} />
        </div>
        <div>
          <label className={lbl} htmlFor="t-web">Website</label>
          <input id="t-web" className={field} value={form.website ?? ''} placeholder="https://"
                 onChange={(e) => set('website', e.target.value)} />
        </div>
        <div>
          <label className={lbl} htmlFor="t-bill">Billing email</label>
          <input id="t-bill" className={field} type="email" value={form.billingEmail ?? ''}
                 onChange={(e) => set('billingEmail', e.target.value)} />
        </div>
      </div>

      <div className="mt-4 border-t border-blue-200/70 pt-3">
        <p className="mb-2 text-xs text-gray-600">
          These decide whether the company can sign in and how it is billed — separate from the
          details above.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className={lbl} htmlFor="t-tier">Product tier</label>
            <select id="t-tier" className={field} value={form.productTier}
                    onChange={(e) => set('productTier', e.target.value)}>
              {TIERS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="t-sub">Subscription</label>
            <select id="t-sub" className={field} value={form.subscriptionStatus}
                    onChange={(e) => set('subscriptionStatus', e.target.value)}>
              {SUBSCRIPTION.map((v) => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="t-life">Lifecycle</label>
            <select id="t-life" className={field} value={form.lifecycleStage ?? ''}
                    onChange={(e) => set('lifecycleStage', e.target.value)}>
              <option value="">—</option>
              {LIFECYCLE.map((v) => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="t-status">Access</label>
            <select id="t-status" className={field} value={form.status}
                    onChange={(e) => set('status', e.target.value)}>
              {STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>

      {err && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-800">{err}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={save} disabled={busy}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={() => { setOpen(false); setErr(null); }} disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
