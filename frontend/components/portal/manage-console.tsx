'use client';

/**
 * ManageConsole — the tenant-admin (and descended shadow-admin) management console.
 * "Page 2" of the admin experience (Page 1 = the cockpit, where an admin acts as a
 * full-access user). Same paneled shell as the landings: a center lifecycle-home, a
 * right IndicatorRail of tiles, and one right <Drawer> per management surface.
 *
 * It governs the whole spine — subscribe → spotlight (buckets) → buy (portal) → build
 * → close out → repeat — mounting the EXISTING surfaces (Account, Buckets, Users,
 * Portals, Automation, AI usage). See docs/CUSTOMER_ADMIN_CONSOLE_DESIGN.md. Additive:
 * the standalone /billing, /profile, /buckets, /portals, /automation, /team, /agents
 * pages remain as deep links; this is their unified home.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Role } from '@/lib/rbac';
import { Drawer } from '@/components/ui/drawer';
import { IndicatorRail, type Indicator } from './indicator-rail';
import BillingPanel from './billing-panel';
import { ProfileEditor } from './profile-editor';
import SpotlightBuckets from './spotlight-buckets';
import ProposalPortals from './proposal-portals';
import { AutomationPoliciesCard } from './automation-policies-card';
import { AgentUsagePanel } from './agent-usage-panel';
import { TeamInviteForm } from './team-invite-form';
import { TeamMemberActions } from './team-member-actions';

// ─── Prop shapes (server-loaded; mirror billing/profile/team pages) ─────────

export interface ManagePurchase {
  id: string; productType: string; amountCents: number; status: string;
  createdAt: string; opportunityId: string | null;
}
export interface ManageMember {
  id: string; name: string | null; email: string; role: string;
  isActive: boolean; lastLoginAt: string | null;
}
export interface ManageAccount {
  subscriptionStatus: string;
  hasStripeCustomer: boolean;
  purchases: ManagePurchase[];
  canEdit: boolean;
  canManageBilling: boolean;
  productTier: string;
  memberSince: string | null;
  tenantInfo: { name: string; legalName: string | null; website: string | null; billingEmail: string | null } | null;
  profile: {
    naicsCodes: string[]; keywords: string[]; technologyFocus: string | null;
    companySummary: string | null; researchAreas: string[]; targetAgencies: string[];
    setAsideTypes: string[]; agencyPriorities: string[];
  } | null;
}

interface ManageConsoleProps {
  tenantSlug: string;
  companyName: string;
  role: Role;
  currentUserId: string;
  isExpert: boolean;
  counts: { buckets: number; opps: number; portals: number; proposals: number; tasks: number; library: number };
  account: ManageAccount;
  members: ManageMember[];
}

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  tenant_admin: { label: 'Admin', color: 'bg-indigo-100 text-indigo-700' },
  tenant_user: { label: 'Contributor', color: 'bg-blue-100 text-blue-700' },
  partner_user: { label: 'External', color: 'bg-amber-100 text-amber-700' },
  master_admin: { label: 'System Admin', color: 'bg-red-100 text-red-700' },
  rfp_admin: { label: 'RFP Admin', color: 'bg-purple-100 text-purple-700' },
};

const SUB_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700',
  none: 'bg-gray-100 text-gray-600',
};

export function ManageConsole({
  tenantSlug, companyName, role, currentUserId, isExpert, counts, account, members,
}: ManageConsoleProps) {
  const [active, setActive] = useState<string | null>(null);
  const close = () => setActive(null);

  const indicators: Indicator[] = [
    { key: 'account', icon: '⚙', label: 'Account', count: null },
    { key: 'buckets', icon: '▦', label: 'Buckets', count: counts.buckets },
    { key: 'users', icon: '👥', label: 'Users', count: members.length },
    { key: 'portals', icon: '🏗', label: 'Portals', count: counts.portals },
    { key: 'automation', icon: '⚡', label: 'Automation', count: null },
    { key: 'aiusage', icon: '🤖', label: 'AI usage', count: null },
  ];

  // The spine — subscribe → spotlight → buy → build → close out. Each card either opens a
  // drawer (open) or links to the full page (href).
  const spine: { key: string; label: string; value: string; open?: string; href?: string }[] = [
    { key: 'subscribe', label: 'Subscribe', value: account.subscriptionStatus, open: 'account' },
    { key: 'spotlight', label: 'Spotlight', value: `${counts.buckets} bucket${counts.buckets === 1 ? '' : 's'} · ${counts.opps} OPP${counts.opps === 1 ? '' : 's'}`, open: 'buckets' },
    { key: 'buy', label: 'Buy', value: `${counts.portals} portal${counts.portals === 1 ? '' : 's'}`, open: 'portals' },
    { key: 'build', label: 'Build', value: `${counts.proposals} active`, href: `/portal/${tenantSlug}/proposals` },
    { key: 'closeout', label: 'Close out', value: `${counts.tasks} to-do${counts.tasks === 1 ? '' : 's'}`, href: `/portal/${tenantSlug}/processes` },
  ];

  const subCls = SUB_STYLE[account.subscriptionStatus] ?? SUB_STYLE.none;
  // Guards the role control: the last active admin can't be demoted.
  const activeAdmins = members.filter((m) => m.isActive && m.role === 'tenant_admin').length;

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Manage {companyName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Set up and govern the whole lifecycle — subscription, spotlight buckets, your team, proposal portals, and automation.
            </p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${subCls}`}>{account.subscriptionStatus}</span>
        </div>

        {/* The spine */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {spine.map((s, i) => {
            const inner = (
              <>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  <span className="text-gray-300">{i + 1}</span>{s.label}
                </div>
                <p className="text-sm font-semibold text-gray-900 mt-1 capitalize truncate">{s.value}</p>
              </>
            );
            const cardCls = 'text-left rounded-xl border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:shadow-sm transition';
            return s.open ? (
              <button key={s.key} onClick={() => setActive(s.open!)} className={cardCls}>{inner}</button>
            ) : s.href ? (
              <Link key={s.key} href={s.href} className={`block ${cardCls}`}>{inner}</Link>
            ) : (
              <div key={s.key} className="rounded-xl border border-gray-200 bg-white p-3">{inner}</div>
            );
          })}
        </div>

        {/* Quick actions */}
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mt-8 mb-3">Set up</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { key: 'buckets', icon: '▦', title: 'Spotlight buckets', desc: 'Define what to watch on the mirror' },
            { key: 'users', icon: '👥', title: 'Users & collaborators', desc: `${members.length} on the team` },
            { key: 'portals', icon: '🏗', title: 'Proposal portals', desc: 'Buy & set up the build workflow' },
            { key: 'automation', icon: '⚡', title: 'Automation', desc: 'Who gets nudged, on what logic' },
          ].map((c) => (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              className="flex items-start gap-3 text-left rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition"
            >
              <span className="text-xl leading-none" aria-hidden>{c.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">{c.title}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{c.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <IndicatorRail indicators={indicators} activeKey={active} onSelect={(k) => setActive((a) => (a === k ? null : k))} />

      {/* ── Account ── */}
      <Drawer open={active === 'account'} onClose={close} side="right" width="w-[min(92vw,880px)]" ariaLabel="Account & settings">
        <DrawerShell title="Account & settings" onClose={close}>
          <div className="rounded-lg border border-gray-200 bg-white p-4 mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><dt className="text-gray-500 text-xs">Plan</dt><dd className="font-medium capitalize">{account.productTier}</dd></div>
              <div><dt className="text-gray-500 text-xs">Status</dt><dd><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${subCls}`}>{account.subscriptionStatus}</span></dd></div>
              <div><dt className="text-gray-500 text-xs">Member since</dt><dd className="font-medium text-xs">{account.memberSince ?? '—'}</dd></div>
              <div><dt className="text-gray-500 text-xs">Billing email</dt><dd className="font-medium text-xs truncate">{account.tenantInfo?.billingEmail ?? '—'}</dd></div>
            </div>
          </div>
          <BillingPanel
            tenantSlug={tenantSlug}
            subscriptionStatus={account.subscriptionStatus}
            hasStripeCustomer={account.hasStripeCustomer}
            purchases={account.purchases}
            canManageBilling={account.canManageBilling}
          />
          <div className="mt-4">
            <ProfileEditor
              tenantSlug={tenantSlug}
              canEdit={account.canEdit}
              tenantInfo={account.tenantInfo}
              profile={account.profile}
            />
          </div>
        </DrawerShell>
      </Drawer>

      {/* ── Buckets ── */}
      <Drawer open={active === 'buckets'} onClose={close} side="right" width="w-[min(92vw,880px)]" ariaLabel="Spotlight buckets">
        <DrawerShell title="Spotlight buckets" onClose={close}>
          <p className="text-xs text-gray-500 mb-3">
            A bucket is a lens on the always-searchable master-mirror OPP list — its definition, context-matching, and content. Notification logic is global, in Automation.
          </p>
          <SpotlightBuckets tenantSlug={tenantSlug} canEdit />
        </DrawerShell>
      </Drawer>

      {/* ── Users & collaborators ── */}
      <Drawer open={active === 'users'} onClose={close} side="right" width="w-[min(92vw,720px)]" ariaLabel="Users and collaborators">
        <DrawerShell title="Users & collaborators" onClose={close}>
          <TeamInviteForm tenantSlug={tenantSlug} />
          <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600">Name</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600">Role</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((m) => {
                  const badge = ROLE_BADGES[m.role] ?? { label: m.role, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-gray-900">{m.name ?? <span className="text-gray-400 italic">No name</span>}</span>
                        <span className="block text-xs text-gray-500">{m.email}</span>
                      </td>
                      <td className="px-3 py-2.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span></td>
                      <td className="px-3 py-2.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{m.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td className="px-3 py-2.5 text-right">
                        {m.id !== currentUserId
                          ? <TeamMemberActions tenantSlug={tenantSlug} userId={m.id} active={m.isActive} role={m.role} isLastAdmin={m.role === 'tenant_admin' && activeAdmins <= 1} />
                          : <span className="text-xs text-gray-400">You</span>}
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No team members yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Per-surface access (bucket pinning, library editing, workflow actors) is granted in those admins.
            {' '}<Link href={`/portal/${tenantSlug}/team`} className="text-indigo-600 hover:underline">Full team page →</Link>
          </p>
        </DrawerShell>
      </Drawer>

      {/* ── Portals & workflow ── */}
      <Drawer open={active === 'portals'} onClose={close} side="right" width="w-[min(92vw,880px)]" ariaLabel="Proposal portals">
        <DrawerShell title="Proposal portals & workflow" onClose={close}>
          <ProposalPortals tenantSlug={tenantSlug} canManage isExpert={isExpert} />
        </DrawerShell>
      </Drawer>

      {/* ── Automation ── */}
      <Drawer open={active === 'automation'} onClose={close} side="right" width="w-[min(92vw,720px)]" ariaLabel="Automation">
        <DrawerShell title="Automation" onClose={close}>
          <p className="text-xs text-gray-500 mb-3">
            Global, tenant-level rules: who on the team gets ToDos, notifications, and nudges — and on what logic. Not per bucket.
          </p>
          <AutomationPoliciesCard tenantSlug={tenantSlug} />
        </DrawerShell>
      </Drawer>

      {/* ── AI usage ── */}
      <Drawer open={active === 'aiusage'} onClose={close} side="right" width="w-[min(92vw,720px)]" ariaLabel="AI usage">
        <DrawerShell title="AI usage" onClose={close}>
          <AgentUsagePanel tenantSlug={tenantSlug} />
        </DrawerShell>
      </Drawer>
    </div>
  );
}

function DrawerShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
      </div>
      {children}
    </div>
  );
}
