/**
 * /partner — the partner-manager console (docs/PARTNER_MANAGER_DESIGN.md §3a).
 *
 * A higher-order home: the partner's OWN org (kind='partner_org') shown up top, then their STABLE
 * — one rollup stat card per client company they own or manage. Owner-scoped: reads only tenants
 * the partner owns (tenants.owner_id) or manages (active partner_manager membership). Middleware
 * gates /partner at partner_admin; this page re-checks canManagePartnerTenants defensively.
 */
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isRole, canManagePartnerTenants } from '@/lib/rbac';
import { partnerOwnOrg, partnerScopeTenants } from '@/lib/partner/scope';
import { tenantRollupStats, type TenantRollup } from '@/lib/partner/rollup';
import { ensurePartnerOwnOrgProvisioned } from '@/lib/partner/own-org';
import AddCompanyFlow from './add-company-flow';
import PartnerGuide from './partner-guide';

export const dynamic = 'force-dynamic';

function enterHref(slug: string): string {
  // Reuse the tested descend path (pins the partner as tenant_admin where they hold a membership).
  return `/api/enter?slug=${encodeURIComponent(slug)}&next=${encodeURIComponent(`/portal/${slug}/dashboard`)}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-bold text-navy-900 leading-none">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-navy-400">{label}</span>
    </div>
  );
}

export default async function PartnerConsole() {
  const session = await auth();
  const u = session?.user as { id?: string; email?: string; role?: unknown; name?: string } | undefined;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id || !role || !canManagePartnerTenants(role)) redirect('/login');

  const ownOrg = await partnerOwnOrg(u.id);
  // First-visit provisioning of the own org (idempotent, best-effort — never break the console).
  if (ownOrg) {
    try { await ensurePartnerOwnOrgProvisioned(ownOrg.id, u.id, u.email ?? null); } catch { /* non-fatal */ }
  }

  const stable = await partnerScopeTenants(u.id);
  const rollupIds = [...(ownOrg ? [ownOrg.id] : []), ...stable.map((t) => t.id)];
  let rollup: Map<string, TenantRollup> = new Map();
  try { rollup = await tenantRollupStats(rollupIds); } catch { rollup = new Map(); }

  const ownStats = ownOrg ? rollup.get(ownOrg.id) : undefined;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="font-display text-2xl font-black text-navy-900">Partner Console</h1>
        <span className="text-sm text-navy-500">{u.name ?? 'Partner'}{ownOrg ? ` · ${ownOrg.name}` : ''}</span>
      </div>
      <p className="text-sm text-navy-600 mb-8">
        Your organization and the companies you support. Open any company to work inside it as its
        manager, or add a new company to your stable.
      </p>

      {/* ── Your organization ─────────────────────────────────────────── */}
      {ownOrg && (
        <section className="mb-10">
          <h2 className="text-xs font-bold uppercase tracking-wide text-navy-400 mb-2">Your organization</h2>
          <div className="bg-white border border-cream-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-base font-bold text-navy-900">{ownOrg.name}</p>
              <p className="text-sm text-navy-500">Higher-order org — run your own buckets, pipeline &amp; grants here.</p>
            </div>
            {ownStats && (
              <div className="flex gap-6">
                <Stat label="Buckets" value={ownStats.buckets} />
                <Stat label="Pins" value={ownStats.pins} />
                <Stat label="Proposals" value={ownStats.proposals} />
              </div>
            )}
            <a href={enterHref(ownOrg.slug)} className="text-sm font-semibold text-navy-700 hover:text-navy-900 whitespace-nowrap">
              Open my org workspace →
            </a>
          </div>
        </section>
      )}

      <PartnerGuide />

      {/* ── Add a company ─────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xs font-bold uppercase tracking-wide text-navy-400 mb-2">Add a company</h2>
        <AddCompanyFlow />
      </section>

      {/* ── The stable ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-navy-400 mb-3">
          Supported companies {stable.length > 0 && <span className="text-navy-400">({stable.length})</span>}
        </h2>
        {stable.length === 0 ? (
          <p className="text-sm text-navy-500">No companies yet — add your first above.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {stable.map((t) => {
              const s = rollup.get(t.id);
              return (
                <div key={t.id} className="bg-white border border-cream-200 rounded-xl p-5 hover:border-navy-300 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-base font-bold text-navy-900">{t.name}</p>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                      t.relation === 'owner' ? 'border-navy-200 text-navy-500' : 'border-award-300 text-award-700'
                    }`}>{t.relation === 'owner' ? 'Created' : 'Manager'}</span>
                  </div>
                  <p className="text-xs text-navy-500 mb-4 truncate">
                    {s?.adminPocEmail ? <>Admin: {s.adminPocName ? `${s.adminPocName} · ` : ''}{s.adminPocEmail}</> : 'No admin POC'}
                  </p>
                  <div className="flex gap-5 mb-4">
                    <Stat label="Buckets" value={s?.buckets ?? 0} />
                    <Stat label="Pins" value={s?.pins ?? 0} />
                    <Stat label="Proposals" value={s?.proposals ?? 0} />
                    <Stat label="Portals" value={s?.portals ?? 0} />
                  </div>
                  <a href={enterHref(t.slug)} className="text-sm font-semibold text-navy-700 hover:text-navy-900">
                    Open workspace →
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
