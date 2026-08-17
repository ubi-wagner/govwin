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
import { getPartnerStableTodos } from '@/lib/partner/todos';
import { ensurePartnerOwnOrgProvisioned } from '@/lib/partner/own-org';
import AddCompanyFlow from './add-company-flow';
import PartnerGuide from './partner-guide';

export const dynamic = 'force-dynamic';

function enterHref(slug: string, next?: string): string {
  // Partner-scoped descend: pins as tenant_admin, smooth hop between the partner's companies,
  // and carries the base role so "Exit to console" can ascend (docs/PARTNER_MANAGER_DESIGN.md §3b).
  // `next` (whitelisted in the enter route) lands the manager on a specific portal page — the console's
  // "Review to-dos →" deep-link is the "descend down to complete" half of the notify-up/descend bridge.
  const n = next ? `&next=${encodeURIComponent(next)}` : '';
  return `/api/partner/enter?slug=${encodeURIComponent(slug)}${n}`;
}

/** The console attention badge: open ToDos inside a company (the "notify up" signal). */
function TodoBadge({ count }: { count: number }) {
  if (count <= 0) {
    return <span className="text-[11px] uppercase tracking-wide text-navy-300">No to-dos</span>;
  }
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-award-300 bg-award-50 text-award-700">
      {count} to-do{count === 1 ? '' : 's'}
    </span>
  );
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
  const u = session?.user as { id?: string; email?: string; role?: unknown; name?: string; partnerHomeRole?: string | null } | undefined;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id) redirect('/login');
  if (!role || !canManagePartnerTenants(role)) {
    // A partner who is still DESCENDED (session pinned to tenant_admin) landed on the console —
    // ascend first, which restores partner_admin and returns here.
    if (u?.partnerHomeRole === 'partner_admin') redirect('/api/partner/exit');
    redirect('/login');
  }

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

  // "Notify up": total open ToDos across the stable + own org, and surface companies that need
  // attention first — the manager sees WHERE to descend without opening each company. Completion
  // still happens inside the company (the descend-to-complete bridge), matching the RFP-admin pattern.
  const stableSorted = [...stable].sort(
    (a, b) => (rollup.get(b.id)?.openTodos ?? 0) - (rollup.get(a.id)?.openTodos ?? 0),
  );
  const stableTodos = stable.reduce((n, t) => n + (rollup.get(t.id)?.openTodos ?? 0), 0);
  // #16: the actual open to-do ITEMS across the whole stable (+ own org) — not just the counts —
  // so the manager sees WHAT needs doing and can descend straight to it. Best-effort (returns []).
  const stableFeed = await getPartnerStableTodos(rollupIds);
  const ownTodos = ownStats?.openTodos ?? 0;
  const totalTodos = stableTodos + ownTodos;
  // Stable-wide pipeline glance (the partner's "Opportunities" signal): live builds across the
  // whole stable + own org, so the manager sees pipeline depth beside the to-do attention count.
  const totalProposals = stable.reduce((n, t) => n + (rollup.get(t.id)?.proposals ?? 0), 0) + (ownStats?.proposals ?? 0);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="font-display text-2xl font-black text-navy-900">Partner Console</h1>
        <span className="text-sm text-navy-500">{u.name ?? 'Partner'}{ownOrg ? ` · ${ownOrg.name}` : ''}</span>
      </div>
      <p className="text-sm text-navy-600 mb-4">
        Your organization and the companies you support. Open any company to work inside it as its
        manager, or add a new company to your stable.
      </p>
      {/* Attention banner — the aggregate "notify up" across the whole stable, with the pipeline
          glance beside it. Opening a company descends into its Command Center (the same tabbed
          console a tenant admin runs), where the manager acts. */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {totalTodos > 0 ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-award-300 bg-award-50 px-3 py-1.5 text-sm text-award-800">
            <span className="font-semibold">{totalTodos} open to-do{totalTodos === 1 ? '' : 's'}</span>
            <span className="text-award-700">across your companies — open a company to review &amp; complete.</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-lg border border-cream-200 bg-white px-3 py-1.5 text-sm text-navy-500">
            No open to-dos across your companies right now.
          </div>
        )}
        <div className="inline-flex items-center gap-2 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm text-navy-600">
          <span className="font-semibold text-navy-800">{totalProposals}</span>
          <span>build{totalProposals === 1 ? '' : 's'} in flight across your stable</span>
        </div>
      </div>

      {/* ── Across your stable — the actual open to-do items (#16) ──────────
             The counts above say WHERE; this says WHAT, and each row descends straight to it
             (the manager completes inside the company — the notify-up / descend-to-complete bridge). */}
      {stableFeed.length > 0 && (
        <section className="mb-10 rounded-xl border border-cream-200 bg-white p-4 sm:p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-navy-400 mb-2">To-dos across your stable</h2>
          <ul className="divide-y divide-cream-100">
            {stableFeed.slice(0, 12).map((t) => (
              <li key={t.id}>
                <a
                  href={enterHref(t.companySlug, t.inPortalHref)}
                  className="flex items-center justify-between gap-3 min-h-11 py-2 -mx-2 px-2 rounded-lg hover:bg-cream-50 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-navy-900 truncate">{t.title}</span>
                    <span className="block text-xs text-navy-500 truncate">
                      {t.companyName}{t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-navy-600">Descend &rarr;</span>
                </a>
              </li>
            ))}
          </ul>
          {stableFeed.length > 12 && (
            <p className="mt-2 text-xs text-navy-400">+ {stableFeed.length - 12} more across your companies.</p>
          )}
        </section>
      )}

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
              <div className="flex items-center gap-6">
                <Stat label="Buckets" value={ownStats.buckets} />
                <Stat label="Pins" value={ownStats.pins} />
                <Stat label="Proposals" value={ownStats.proposals} />
                <TodoBadge count={ownTodos} />
              </div>
            )}
            <div className="flex flex-col items-end gap-1 whitespace-nowrap">
              <a href={enterHref(ownOrg.slug)} className="text-sm font-semibold text-navy-700 hover:text-navy-900">
                Open my org workspace →
              </a>
              {ownTodos > 0 && (
                <a href={enterHref(ownOrg.slug, 'todos')} className="text-xs font-semibold text-award-700 hover:text-award-800">
                  Review {ownTodos} to-do{ownTodos === 1 ? '' : 's'} →
                </a>
              )}
            </div>
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
            {stableSorted.map((t) => {
              const s = rollup.get(t.id);
              const todos = s?.openTodos ?? 0;
              return (
                <div key={t.id} className={`bg-white border rounded-xl p-5 transition-colors ${
                  todos > 0 ? 'border-award-200 hover:border-award-400' : 'border-cream-200 hover:border-navy-300'
                }`}>
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-base font-bold text-navy-900">{t.name}</p>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                      t.relation === 'owner' ? 'border-navy-200 text-navy-500' : 'border-award-300 text-award-700'
                    }`}>{t.relation === 'owner' ? 'Created' : 'Manager'}</span>
                  </div>
                  <p className="text-xs text-navy-500 mb-4 truncate">
                    {s?.adminPocEmail ? <>Admin: {s.adminPocName ? `${s.adminPocName} · ` : ''}{s.adminPocEmail}</> : 'No admin POC'}
                  </p>
                  <div className="flex items-center gap-5 mb-4">
                    <Stat label="Buckets" value={s?.buckets ?? 0} />
                    <Stat label="Pins" value={s?.pins ?? 0} />
                    <Stat label="Proposals" value={s?.proposals ?? 0} />
                    <Stat label="Portals" value={s?.portals ?? 0} />
                    <TodoBadge count={todos} />
                  </div>
                  <div className="flex items-center gap-4">
                    <a href={enterHref(t.slug)} className="text-sm font-semibold text-navy-700 hover:text-navy-900">
                      Open workspace →
                    </a>
                    {todos > 0 && (
                      <a href={enterHref(t.slug, 'todos')} className="text-sm font-semibold text-award-700 hover:text-award-800">
                        Review {todos} to-do{todos === 1 ? '' : 's'} →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
