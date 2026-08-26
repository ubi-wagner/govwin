import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { TaskQueue } from '@/components/tasks/task-queue';
import { CommandTabs, type CommandTabInput } from '@/components/command/command-tabs';
import {
  getReviewQueue, getTenantSurfacedTodos, getAdminTabCount, getSystemItems, getAdminTabNewest, getOpsDigest,
  type QueueSection, type TenantTodo, type SystemItem, type OpsDigest,
} from '@/lib/admin/review-queue';
import { getCommandSeen, isNew } from '@/lib/command/seen';
import { hasRoleAtLeast, isRole, requiredRoleForPath, type Role } from '@/lib/rbac';

// The tabbed admin Command Center — the ONE "what needs my attention" console. Four count-badged
// lanes (Opportunities · Admin · Tenant-surfaced · System); each row deep-links into its detail view,
// and the Tenant-surfaced lane descends into a tenant to act. docs/COMMAND_CENTER_DESIGN.md §3.1.
export const dynamic = 'force-dynamic';

const LANE_TONE: Record<QueueSection['tone'], { card: string; pill: string; label: string }> = {
  action: { card: 'border-amber-300 bg-amber-50/40', pill: 'bg-amber-500 text-white', label: 'text-amber-900' },
  progress: { card: 'border-blue-200 bg-blue-50/30', pill: 'bg-blue-500 text-white', label: 'text-blue-900' },
  info: { card: 'border-gray-200 bg-white', pill: 'bg-gray-400 text-white', label: 'text-gray-800' },
};

function EmptyLane({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
      <p className="text-sm text-gray-500">{text}</p>
    </div>
  );
}

// Opportunities lane — the review-queue sections (scout / curation / release / amendments).
function OpportunityLanes({ sections }: { sections: QueueSection[] }) {
  const active = sections.filter((s) => s.count > 0);
  if (active.length === 0) return <EmptyLane text="Your review queue is clear. New scout finds and RFPs land here." />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {active.map((s) => {
        const t = LANE_TONE[s.tone];
        return (
          <section key={s.key} className={`rounded-xl border ${t.card} p-4`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className={`text-sm font-semibold ${t.label}`}>{s.title}</h2>
              <span className={`inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full text-xs font-bold ${t.pill}`}>{s.count}</span>
            </div>
            <ul className="mt-3 divide-y divide-black/5">
              {s.items.map((it) => (
                <li key={it.id}>
                  <Link href={it.href} className="flex items-center justify-between gap-3 min-h-11 py-2 -mx-1 px-1 rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{it.title}</span>
                      {it.subtitle && <span className="block text-xs text-gray-500 truncate">{it.subtitle}</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {it.meta && <span className="text-[11px] text-gray-400 tabular-nums">{it.meta}</span>}
                      <span className="text-gray-300" aria-hidden>›</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {s.count > s.items.length && (
              <Link href={s.href} className="mt-2 inline-block text-xs font-medium text-blue-600 hover:text-blue-800">See all {s.count} →</Link>
            )}
          </section>
        );
      })}
    </div>
  );
}

// Tenant-surfaced lane — cross-tenant to-dos the admin acts on by DESCENDING into the tenant.
function TenantSurfacedList({ items }: { items: TenantTodo[] }) {
  if (items.length === 0) return <EmptyLane text="No tenant to-dos need you right now." />;
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <ul className="divide-y divide-black/5">
        {items.map((it) => (
          <li key={it.id}>
            <Link href={it.href} className="flex items-center justify-between gap-3 min-h-11 py-2 -mx-1 px-1 rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{it.title}</span>
                <span className="block text-xs text-gray-500 truncate">
                  {it.tenantName}{it.dueAt ? ` · due ${new Date(it.dueAt).toLocaleDateString()}` : ''}
                </span>
              </span>
              <span className="text-xs font-semibold text-violet-600 shrink-0">Descend →</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-gray-400">Tapping a row drops you into that company to act (shadow), then returns you here.</p>
    </div>
  );
}

// Ops digest — the daily workforce/pipeline health headline (ai_ops_digest), above the failed-instance
// list. Silent until a digest has run; alerts sorted high→low with a severity dot.
function OpsDigestCard({ digest }: { digest: OpsDigest | null }) {
  if (!digest || (!digest.headline && digest.alerts.length === 0)) return null;
  const high = digest.alerts.filter((a) => a.severity === 'high' || a.severity === 'critical');
  const rest = digest.alerts.filter((a) => a.severity !== 'high' && a.severity !== 'critical');
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 mb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Daily ops digest</span>
        {digest.generatedAt && <span className="text-xs text-indigo-400">{new Date(digest.generatedAt).toLocaleString()}</span>}
      </div>
      {digest.headline && <p className="mt-1.5 text-sm font-medium text-gray-900">{digest.headline}</p>}
      {(high.length > 0 || rest.length > 0) && (
        <ul className="mt-2 space-y-1">
          {[...high, ...rest].slice(0, 6).map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.severity === 'high' || a.severity === 'critical' ? 'bg-red-500' : 'bg-amber-400'}`} aria-hidden />
              <span className="text-gray-700">{[a.label, a.message].filter(Boolean).join(' — ') || 'alert'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// System lane — pipeline instances needing attention (failed).
function SystemList({ items }: { items: SystemItem[] }) {
  if (items.length === 0) return <EmptyLane text="No system issues — the pipeline is healthy. Use the buttons above to open the monitors." />;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <ul className="divide-y divide-black/5">
        {items.map((it) => (
          <li key={it.id}>
            <Link href={it.href} className="flex items-center justify-between gap-3 min-h-11 py-2 -mx-1 px-1 rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{it.title}</span>
                <span className="block text-xs text-gray-500 truncate">{it.subtitle}</span>
              </span>
              <span className="text-gray-300 shrink-0" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function CommandCenterPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const firstName = (session.user.name ?? session.user.email ?? 'there').split(/[\s@]/)[0];
  const userId = (session.user as { id?: string }).id ?? '';
  const su = session.user as { role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;

  const [oppQueue, tenant, adminCount, system, newest, seen, opsDigest] = await Promise.all([
    getReviewQueue().catch((e) => { console.error('[admin/command] opp queue failed:', e); return { sections: [], actionable: 0 }; }),
    getTenantSurfacedTodos().catch((e) => { console.error('[admin/command] tenant todos failed:', e); return { items: [], count: 0 }; }),
    getAdminTabCount().catch((e) => { console.error('[admin/command] admin count failed:', e); return 0; }),
    getSystemItems().catch((e) => { console.error('[admin/command] system items failed:', e); return { items: [], count: 0 }; }),
    getAdminTabNewest().catch((e) => { console.error('[admin/command] newest failed:', e); return { opp: null, admin: null, tenant: null, system: null }; }),
    getCommandSeen(userId, 'admin'),
    getOpsDigest().catch((e) => { console.error('[admin/command] ops digest failed:', e); return null; }),
  ]);

  // "New since you last looked" per lane (mig 179) — the newest lane item vs the per-tab watermark.
  const hasNew = {
    opp: isNew(seen, 'opp', newest.opp),
    admin: isNew(seen, 'admin', newest.admin),
    tenant: isNew(seen, 'tenant', newest.tenant),
    system: isNew(seen, 'system', newest.system),
  };

  const tabs: CommandTabInput[] = ([
    {
      key: 'opp', title: 'Opportunities', tone: 'action', count: oppQueue.actionable, hasNew: hasNew.opp,
      actions: [
        { label: '📤 Upload RFP', href: '/admin/rfp-curation/upload' },
        { label: '➕ New intake', href: '/admin/intake' },
        { label: '🔭 Scout', href: '/admin/sources' },
        { label: '📋 Triage', href: '/admin/rfp-curation' },
      ],
      body: <OpportunityLanes sections={oppQueue.sections} />,
    },
    {
      key: 'admin', title: 'Admin', tone: 'action', count: adminCount, hasNew: hasNew.admin,
      actions: [
        { label: '👤 Applications', href: '/admin/applications' },
        { label: '✍️ Content Studio', href: '/admin/site' },
        { label: '🎁 Comp a portal', href: '/admin/purchases' },
        { label: '🤖 Agents', href: '/admin/agents' },
      ],
      body: <TaskQueue apiBase="/api/admin/tasks" title="Admin actions" emptyText="No admin actions pending." />,
    },
    {
      key: 'tenant', title: 'Tenant', tone: 'shadow', count: tenant.count, hasNew: hasNew.tenant,
      actions: [{ label: '🏢 Jump to company', href: '/admin/tenants' }],
      body: <TenantSurfacedList items={tenant.items} />,
    },
    {
      key: 'system', title: 'System', tone: 'default', count: system.count, hasNew: hasNew.system,
      actions: [
        { label: '🔀 Workflows', href: '/admin/workflows' },
        { label: '⚙️ Automation', href: '/admin/automation' },
        { label: '📡 Events', href: '/admin/events' },
        { label: '❤️ Health', href: '/admin/system' },
      ],
      body: <><OpsDigestCard digest={opsDigest} /><SystemList items={system.items} /></>,
    },
  ] as CommandTabInput[])
    // Drop any action this actor cannot reach. "❤️ Health" (/admin/system) is master_admin-only,
    // so an rfp_admin clicking it hit middleware's deny → redirect('/') and landed on the public
    // marketing site, out of the console entirely. Derived from requiredRoleForPath — the same
    // table middleware enforces — so it stays correct as routes are added (mirrors the sidebar
    // filter in components/admin/admin-nav-data.ts::visibleAdminNav).
    .map((lane) => ({
      ...lane,
      actions: lane.actions.filter((a) => {
        const need = requiredRoleForPath(a.href);
        return need == null || (role != null && hasRoleAtLeast(role, need));
      }),
    }));

  const actionable = oppQueue.actionable + adminCount + tenant.count + system.count;

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Command Center</h1>
        <p className="text-sm text-gray-500 mt-1">
          {actionable > 0
            ? <>Hi {firstName} — <span className="font-semibold text-amber-700">{actionable}</span> open across your lanes.</>
            : <>Hi {firstName} — you&apos;re all caught up. 🎉</>}
        </p>
      </header>
      <CommandTabs tabs={tabs} initialKey="opp" scope="admin" />
    </div>
  );
}
